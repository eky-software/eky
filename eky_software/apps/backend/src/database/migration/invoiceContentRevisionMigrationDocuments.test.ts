import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDatabases, insert, removeDirectories, snapshots } from './invoiceContentRevisionMigration.fixture.js';
import {
  bindingState,
  createBoundRevisionDatabase,
  documentRow,
  eventRow,
  legacyRevisionId,
} from './invoiceContentRevisionMigrationBinding.fixture.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('invoice content revision migration: document revision and legacy bindings', () => {
  it('allows separate revision documents but only one PDF for each revision', async () => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    insert(
      db,
      'invoice_documents',
      documentRow({ id: 'doc-second', revision_id: 'revision-2', storage_path: 'synthetic/second.pdf' }),
    );

    expect(() => insert(db, 'invoice_documents', documentRow({ id: 'doc-duplicate', storage_path: 'synthetic/duplicate.pdf' })))
      .toThrow();
    expect(db.prepare('SELECT id FROM invoice_documents ORDER BY id').all()).toHaveLength(3);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['invoice_documents', 'invoice_delivery_events'])('rejects hidden rowid replacement bypass in %s', async table => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    const before = bindingState(db);
    const hasRowid = !(db.prepare<[string], { wr: number }>('SELECT wr FROM pragma_table_list WHERE name = ?').get(table)?.wr);
    const targetId = table === 'invoice_documents' ? 'doc-new' : 'event-old';
    const rowid = hasRowid ? db.prepare<[string], { rowid: number }>(`SELECT rowid FROM ${table} WHERE id = ?`).get(targetId)!.rowid : 1;
    const values = table === 'invoice_documents'
      ? documentRow({ id: 'replacement', revision_id: 'revision-2', storage_path: 'synthetic/replacement.pdf' })
      : eventRow({ id: 'replacement' });

    expect(() => insert(db, table, { rowid, ...values }, true)).toThrow();
    expect(bindingState(db)).toEqual(before);
  });

  it.each(
    [
      ['null revision', { revision_id: null }],
      ['foreign company', { company_id: 'other-company' }],
      ['different invoice revision', { revision_id: 'revision-other' }],
      ['foreign revision', { revision_id: 'revision-foreign' }],
      ['legacy unvalidated revision', { revision_id: 'revision-legacy' }],
      ['unexpected source', { source_document_id: 'doc-old' }],
      ['path collision with legacy', { storage_path: 'synthetic/old.pdf' }],
      ['invalid hash', { sha256: 'x'.repeat(64) }],
      ['noninteger size', { size_bytes: 2.5 }],
      ['oversize', { size_bytes: 10485761 }],
      ['new legacy row', { binding_kind: 'legacyOriginal', revision_id: null }],
    ] as const,
  )('rejects invalid document binding: %s', async (_name, override) => {
    const db = await createBoundRevisionDatabase();
    const before = bindingState(db);
    const values = 'revision_id' in override && override.revision_id === 'revision-legacy'
      ? { ...override, revision_id: legacyRevisionId(db) }
      : override;

    expect(() => insert(db, 'invoice_documents', documentRow(values))).toThrow();
    expect(bindingState(db)).toEqual(before);
  });

  it('preserves one verified legacy copy and rejects duplicate copies and copy chains', async () => {
    const db = await createBoundRevisionDatabase();
    const preserved = documentRow({
      id: 'doc-preserved',
      binding_kind: 'preservedLegacy',
      revision_id: null,
      source_document_id: 'doc-old',
    });
    insert(db, 'invoice_documents', preserved);
    insert(
      db,
      'invoice_delivery_events',
      eventRow({ binding_kind: 'preservedLegacy', document_id: 'doc-preserved', revision_id: null }),
    );
    for (const override of [{ source_document_id: 'doc-preserved' }, {}]) {
      expect(() => insert(
        db,
        'invoice_documents',
        {
          ...preserved,
          id: 'another-copy',
          storage_path: 'synthetic/another.pdf',
          ...override,
        },
      ))
        .toThrow();
    }

    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(
    [
      ['null source', { source_document_id: null }],
      ['revision source', { source_document_id: 'doc-new' }],
      ['self source', { source_document_id: 'doc-preserved' }],
      ['wrong invoice', { invoice_id: 'invoice-2' }],
      ['wrong company', { company_id: 'other-company' }],
      ['wrong hash', { sha256: 'b'.repeat(64) }],
      ['wrong size', { size_bytes: 65 }],
    ] as const,
  )('rejects preserved source mismatch without a duplicate-copy conflict: %s', async (_name, override) => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    const before = bindingState(db);

    expect(() => insert(
      db,
      'invoice_documents',
      documentRow(
        {
          id: 'doc-preserved',
          storage_path: 'synthetic/preserved.pdf',
          binding_kind: 'preservedLegacy',
          revision_id: null,
          source_document_id: 'doc-old',
          ...override,
        },
      ),
    ))
      .toThrow();
    expect(bindingState(db)).toEqual(before);
  });

  it('allows current revision changes only within the same invoice and company', async () => {
    const db = await createBoundRevisionDatabase();
    const before = snapshots(db);
    db.prepare(
      "UPDATE invoice_current_revisions SET revision_id = 'revision-1' WHERE company_id = 'dev-company' AND invoice_id = 'invoice-1'",
    )
      .run();
    db.prepare(
      "UPDATE invoice_current_revisions SET revision_id = 'revision-2' WHERE company_id = 'dev-company' AND invoice_id = 'invoice-1'",
    )
      .run();
    for (const id of ['revision-other', 'revision-foreign', 'missing']) {
      expect(() => db.prepare(
        "UPDATE invoice_current_revisions SET revision_id = ? WHERE company_id = 'dev-company' AND invoice_id = 'invoice-1'",
      )
        .run(id))
        .toThrow();
    }
    db.prepare('DELETE FROM invoice_current_revisions').run();

    expect(db.prepare('SELECT id FROM invoice_content_revisions').all()).toHaveLength(7);
    expect(snapshots(db).invoice_content_revisions).toEqual(before.invoice_content_revisions);
    expect(snapshots(db).invoice_revision_lines).toEqual(before.invoice_revision_lines);
    expect(snapshots(db).invoice_revision_vat_breakdown).toEqual(before.invoice_revision_vat_breakdown);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects preservedLegacy self-test mode and OR REPLACE on the preserved-source key', async () => {
    const db = await createBoundRevisionDatabase();
    const preserved = documentRow({
      id: 'doc-preserved',
      binding_kind: 'preservedLegacy',
      revision_id: null,
      source_document_id: 'doc-old',
    });
    insert(db, 'invoice_documents', preserved);
    const before = bindingState(db);

    expect(() => insert(
      db,
      'invoice_delivery_events',
      eventRow(
        {
          binding_kind: 'preservedLegacy',
          document_id: 'doc-preserved',
          revision_id: null,
          send_mode: 'smtpTest',
        },
      ),
    ))
      .toThrow(/CHECK constraint failed/);
    expect(() => insert(db, 'invoice_documents', { ...preserved, id: 'replacement', storage_path: 'synthetic/replaced.pdf' }, true))
      .toThrow('INVOICE_DOCUMENT_IMMUTABLE');
    expect(bindingState(db)).toEqual(before);
  });

  it.each(
    [
      { revision_id: 'revision-2', storage_path: 'synthetic/replaced.pdf' },
      { id: 'doc-replacement', storage_path: 'synthetic/replaced.pdf' },
    ],
  )('rejects INSERT OR REPLACE across document ID or revision unique keys: %j', async (override) => {
    const db = await createBoundRevisionDatabase();
    insert(db, 'invoice_documents', documentRow());
    const beforeDocument = bindingState(db);

    expect(() => insert(db, 'invoice_documents', documentRow(override), true)).toThrow();
    expect(bindingState(db)).toEqual(beforeDocument);
  });

});
