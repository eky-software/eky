import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import {
  closeDatabases,
  failMigrationHistoryWrite,
  insert,
  migrate,
  migrationDirectories,
  migrationName,
  oldState,
  openDatabase,
  removeDirectories,
  snapshots,
  temporaryDirectory,
  type Row,
} from './invoiceContentRevisionMigration.fixture.js';
import { bindingState, createBindingDatabase, documentRow, eventRow } from './invoiceContentRevisionMigrationBinding.fixture.js';
import {
  contentFields,
  createSnapshotDatabase,
  header,
  line,
  lineFields,
  liveFields,
  project,
  publish,
  vat,
} from './invoiceContentRevisionMigrationSnapshot.fixture.js';
import { runMigrations } from './runMigrations.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: historical data and atomic migration 039', () => {
  it('classifies every current invoice and line column and copies all legacy values without normalization', async () => {
    const db = await createSnapshotDatabase(false);
    const before = oldState(db);

    expect(contentFields).toHaveLength(64);
    expect(db.prepare<[], { name: string }>('PRAGMA table_info(invoices)').all().map(c => c.name).sort())
      .toEqual(['id', 'company_id', ...contentFields, ...liveFields].sort());
    expect(db.prepare<[], { name: string }>('PRAGMA table_info(invoice_lines)').all().map(c => c.name).sort())
      .toEqual(['id', 'invoice_id', ...lineFields].sort());
    const directory = migrationDirectories().after;
    await runMigrations(db, { migrationsDirectory: directory });
    for (const original of before.invoices as Row[]) {
      const copy = db.prepare<[string], Row>('SELECT * FROM invoice_content_revisions WHERE invoice_id = ?').get(original.id as string)!;

      expect(project(copy, contentFields)).toEqual(project(original, contentFields));
      expect(copy).toMatchObject({
        origin: 'legacySnapshot',
        vat_breakdown_state: 'unavailable',
        company_id: original.company_id,
      });
      expect(liveFields.every(k => !(k in copy))).toBe(true);
    }
    for (const original of before.invoice_lines as Row[]) {
      const copy = db.prepare<[string], Row>('SELECT * FROM invoice_revision_lines WHERE line_id = ?').get(original.id as string)!;

      expect(project(copy, lineFields)).toEqual(project(original, lineFields));
      expect(copy.invoice_id).toBe(original.invoice_id);
    }

    expect(db.prepare('SELECT * FROM invoice_revision_vat_breakdown').all()).toEqual([]);
    expect(db.prepare("SELECT * FROM invoice_current_revisions WHERE invoice_id = 'other'").all()).toEqual([]);
    for (const table of ['invoices', 'invoice_lines'] as const) {
      expect(oldState(db)[table]).toEqual(before[table]);
    }
    for (const table of ['invoice_documents', 'invoice_delivery_events']) {
      const original = before[table] as Row[];
      const after = oldState(db)[table] as Row[];

      expect(original.length).toBeGreaterThan(0);
      expect(after.map(row => project(row, Object.keys(original[0]!)))).toEqual(original);
    }

    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'invoice_legacy_revision_ids'").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 39 });
    const productionHash = createHash('sha256')
      .update(readFileSync(new URL(`../migrations/${migrationName}`, import.meta.url)))
      .digest('hex');

    expect(
      db.prepare('SELECT source_sha256, metadata_origin FROM schema_migration_metadata WHERE migration_name = ?').get(migrationName),
    )
      .toEqual({ source_sha256: productionHash, metadata_origin: 'applied' });
    const after = snapshots(db);
    await runMigrations(db, { migrationsDirectory: directory });

    expect(snapshots(db)).toEqual(after);
  });

  it('rolls back snapshot, bindings and migration metadata together when publication fails', async () => {
    const db = await createSnapshotDatabase(false);
    failMigrationHistoryWrite(db);
    const before = oldState(db);

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after }))
      .rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(oldState(db)).toEqual(before);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'invoice_revision%' OR name = 'invoice_content_revisions'")
        .all(),
    )
      .toEqual([]);
  });

  it('rolls back the entire 039 migration on metadata failure after all business writes', async () => {
    const db = await createSnapshotDatabase(false);
    db.exec(
      `CREATE TRIGGER fail_snapshot_metadata BEFORE INSERT ON schema_migration_metadata
      WHEN NEW.migration_name = '${migrationName}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_METADATA_FAILURE'); END;`,
    );
    const before = oldState(db);
    const oldSchema = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after })).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(oldState(db)).toEqual(before);
    expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(oldSchema);
  });

  it('does not silently lose an orphan old line during backfill joins', async () => {
    const db = await createSnapshotDatabase(false);
    db.pragma('foreign_keys = OFF');
    db.prepare("UPDATE invoice_lines SET invoice_id = 'missing' WHERE id = 'line-3'").run();
    db.pragma('foreign_keys = ON');
    const before = oldState(db);

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after })).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(oldState(db)).toEqual(before);
  });

  it('refuses an old credit referencing a different company instead of losing that binding', async () => {
    const db = await createSnapshotDatabase(false);
    db.prepare("UPDATE invoices SET credited_invoice_id = 'foreign' WHERE id = 'credit'").run();
    const before = oldState(db);

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after })).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(oldState(db)).toEqual(before);
  });

  it('preserves all original values, nulls and unresolved events without rewriting provenance', async () => {
    const db = await createBindingDatabase();
    const before = bindingState(db);
    const catalog = new SqliteInvoiceBackupArtifactCatalog(db, 'legacyDocuments');
    const originalCatalog = await catalog.listAuthoritativeArtifacts();
    const directory = migrationDirectories().after;
    await runMigrations(db, { migrationsDirectory: directory });
    const after = bindingState(db);
    const project = (rows: Row[], original: Row[]) => rows.map(row => Object.fromEntries(
      Object.keys(original[0]!).map(key => [key, row[key]]),
    ));

    expect(before.docs.length).toBeGreaterThan(0);
    expect(before.events.length).toBeGreaterThan(0);
    expect(project(after.docs, before.docs)).toEqual(before.docs);
    expect(project(after.events, before.events)).toEqual(before.events);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.lines).toEqual(before.lines);
    expect(after.events).toEqual(
      expect.arrayContaining(
        [
          expect.objectContaining(
            {
              id: 'event-old-null',
              document_id: null,
              binding_kind: 'legacyOriginal',
              send_mode: 'legacyUnknown',
              revision_id: null,
              document_sha256: null,
              document_size_bytes: null,
            },
          ),
        ],
      ),
    );
    expect(await new SqliteInvoiceBackupArtifactCatalog(db, 'revisionHistory').listAuthoritativeArtifacts()).toEqual(originalCatalog);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(after.migrations).toHaveLength(before.migrations.length + 1);
    expect(after.metadata).toHaveLength(before.metadata.length + 1);
    await runMigrations(db, { migrationsDirectory: directory });

    expect(bindingState(db)).toEqual(after);
  });

  it('rolls back the full 039 migration when migration metadata cannot be written', async () => {
    const db = await createBindingDatabase();
    db.exec(
      `CREATE TRIGGER fail_probe_metadata BEFORE INSERT ON schema_migration_metadata
      WHEN NEW.migration_name = '${migrationName}' BEGIN SELECT RAISE(ABORT, 'PROBE_METADATA_FAILURE'); END;`,
    );
    const before = bindingState(db);

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after })).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(bindingState(db)).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps the separately committed legacy anchor but rolls back every 039 migration business change', async () => {
    const db = await createBindingDatabase();
    failMigrationHistoryWrite(db);
    const before = bindingState(db);
    db.exec('DROP TABLE schema_migration_metadata');

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after }))
      .rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    const after = bindingState(db);
    for (const key of ['docs', 'events', 'invoices', 'lines', 'migrations', 'schema'] as const) {
      expect(after[key]).toEqual(before[key]);
    }

    expect(after.metadata).toHaveLength(38);
    expect(after.metadata.every(row => (row as Row).metadata_origin === 'legacy_baseline')).toBe(true);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('fails closed and preserves the source when a historical non-null document points to a different invoice', async () => {
    const db = await createBindingDatabase();
    db.prepare("UPDATE invoice_delivery_events SET invoice_id = 'invoice-2' WHERE id = 'event-old'").run();
    const before = bindingState(db);

    await expect(runMigrations(db, { migrationsDirectory: migrationDirectories().after })).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
    expect(bindingState(db)).toEqual(before);
  });

  it('migrates an empty production 001..039 chain without inventing business content', async () => {
    const db = openDatabase(':memory:');
    await migrate(db);
    for (const rows of Object.values(snapshots(db))) {
      expect(rows).toEqual([]);
    }

    expect(db.prepare('SELECT * FROM invoice_documents').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM invoice_delivery_events').all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 39 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'invoice_legacy_revision_ids'").all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const before = bindingState(db);
    await migrate(db);

    expect(bindingState(db)).toEqual(before);
  });

  it('persists legacy and newly bound revisions across a real on-disk close and reopen', async () => {
    const legacy = await createBindingDatabase();
    const original = bindingState(legacy);
    const path = join(temporaryDirectory(), 'synthetic.sqlite');
    await legacy.backup(path);
    legacy.close();

    const db = openDatabase(path);

    expect(bindingState(db)).toEqual(original);
    await migrate(db);
    publish(
      db,
      header(db, { id: 'revision-1' }),
      [line({ revision_id: 'revision-1' })],
      [vat({ revision_id: 'revision-1' })],
    );
    insert(db, 'invoice_documents', documentRow());
    insert(db, 'invoice_delivery_events', eventRow({ status: 'succeeded' }));
    db.prepare(
      "UPDATE invoice_current_revisions SET revision_id = 'revision-1' WHERE company_id = 'dev-company' AND invoice_id = 'invoice-1'",
    )
      .run();
    const beforeClose = bindingState(db);
    const published = snapshots(db);

    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();

    const reopened = openDatabase(path);
    await migrate(reopened);

    expect(bindingState(reopened)).toEqual(beforeClose);
    expect(snapshots(reopened)).toEqual(published);
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
    expect(() => reopened.prepare("UPDATE invoice_documents SET file_name = 'changed.pdf' WHERE id = 'doc-new'").run())
      .toThrow('INVOICE_DOCUMENT_IMMUTABLE');
    expect(() => reopened.prepare("UPDATE invoice_content_revisions SET subject = 'changed' WHERE id = 'revision-1'").run())
      .toThrow('REVISION_IMMUTABLE');
    expect(bindingState(reopened)).toEqual(beforeClose);
    expect(snapshots(reopened)).toEqual(published);
  });
});
