import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMigrationSchemaReferences } from '../../database/migration/migrationSchemaReference.js';
import { createHistorical038Schema } from '../../database/migration/migrationSchemaHistory.fixture.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import { runMigrations } from '../../database/migration/runMigrations.js';
import { createInvoiceReadModelTestDatabase, insertInvoiceClone } from '../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import { createProfileBackupIdentity } from './inspectSqliteProfileDatabase.js';
import * as nativeFactory from './createProfileInspectionDatabase.js';
import { runColdOriginalProfileInspection, runColdProfileInspection,
  type ColdOriginalProfileInspectionOperation, type ColdProfileInspectionOperation } from './runColdProfileInspection.js';

const migrationsDirectory = resolve(fileURLToPath(new URL('../../database/migrations/', import.meta.url)));
const roots: string[] = [];
const opened: Database.Database[] = [];

afterEach(async () => {
  for (const database of opened.splice(0)) if (database.open) database.close();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('phase-selected cold restore content inspection', () => {
  it.each([
    ['staged', 'staged'], ['active', 'staged'], ['staged', 'active'], ['active', 'active'],
  ] as const)('uses the selected %s database and %s PDFs without a portable catalog', async (databaseSlot, documentsSlot) => {
    const fixture = await createFixture({ databaseSlot, documentsSlot });
    const result = await runColdProfileInspection(fixture.input, fixture.control);
    expect(result).toEqual({ artifactCount: 1, artifactTotalByteSize: fixture.pdf.length,
      documentBindings: { byteSize: 34, sha256: 'f'.repeat(64) },
      artifactIdentity: 'e'.repeat(64), databaseHealth: 'healthy', profileId: createProfileBackupIdentity('dev-company'),
      migrationChainIdentity: expect.stringMatching(/^[a-f0-9]{64}$/), migrationPolicy: 'restoreCompatible',
      databaseSlot, documentsSlot, database: { byteSize: fixture.bytes.length, sha256: hash(fixture.bytes) } });
    expect(result).not.toHaveProperty('artifactCatalog');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.database)).toBe(true);
    expect(Object.isFrozen(result.documentBindings)).toBe(true);
    expect(fixture.writeDocumentBindings).toHaveBeenCalledWith(fixture.artifactIdentity.mock.calls[0]![0]);
    expect(fixture.openReadonly).toHaveBeenCalledExactlyOnceWith(join(fixture.input.inspectionRoot, 'profile.sqlite'));
    expect(opened.every(database => !database.open)).toBe(true);
    expect(fixture.artifactIdentity).toHaveBeenCalledExactlyOnceWith([{
      byteSize: fixture.pdf.length, sha256: hash(fixture.pdf), storagePath: 'dev-company/invoice-1/document.pdf',
      logicalPath: `artifacts/invoicing/invoice-documents/${hash(Buffer.from('document-1'))}.pdf`,
    }]);
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
    expect(await readFile(fixture.pdfPath)).toEqual(fixture.pdf);
    expect(await readdir(fixture.operationRoot)).not.toContain('snapshot-catalog-v1.json');
  });

  it('preserves the approved metadata-less 038 schema and bytes', async () => {
    const fixture = await createFixture({ historical: true });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).resolves.toMatchObject({
      artifactCount: 0, migrationPolicy: 'restoreCompatible', profileId: createProfileBackupIdentity('dev-company'),
      database: { sha256: hash(fixture.bytes) },
    });
    const copy = new Database(join(fixture.input.inspectionRoot, 'profile.sqlite'), { readonly: true });
    try {
      expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migration_metadata'").get()).toBeUndefined();
      expect(copy.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 38 });
    } finally { copy.close(); }
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it('rejects a misplaced active database rather than adopting a runtime-less path', async () => {
    const fixture = await createFixture({ databaseSlot: 'active', documentsSlot: 'active' });
    const misplaced = join(fixture.input.workspaceRoot, 'data', 'eky.sqlite');
    await mkdir(dirname(misplaced), { mode: 0o700 });
    await rename(fixture.databasePath, misplaced);
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect(await readFile(misplaced)).toEqual(fixture.bytes);
  });

  it('attests schema before reading the invoice catalog and keeps the source untouched', async () => {
    const fixture = await createFixture({ extraSchema: true });
    const catalog = vi.spyOn(SqliteInvoiceBackupArtifactCatalog.prototype, 'listAuthoritativeArtifacts');
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SCHEMA_UNSUPPORTED');
    expect(catalog).not.toHaveBeenCalled();
    expect(opened.every(database => !database.open)).toBe(true);
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it.each(['profile.sqlite-wal', 'profile.sqlite-shm', 'profile.sqlite-journal'])
    ('retains and rejects an unknown source sidecar %s before opening SQLite', async name => {
      const fixture = await createFixture();
      const sidecar = join(fixture.operationRoot, name);
      await writeFile(sidecar, 'retained evidence');
      await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
      expect(fixture.openReadonly).not.toHaveBeenCalled();
      expect(await readFile(sidecar, 'utf8')).toBe('retained evidence');
    });

  it('rejects a hardlinked database without opening or deleting either source', async () => {
    const fixture = await createFixture();
    const retained = join(fixture.root, 'retained.sqlite');
    await link(fixture.databasePath, retained);
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect(await readFile(retained)).toEqual(fixture.bytes);
  });

  it.each(['changed', 'missing', 'hardlink', 'notPdf'] as const)
    ('rejects %s selected PDF bytes and retains the database', async mutation => {
      const fixture = await createFixture();
      if (mutation === 'missing') await rm(fixture.pdfPath);
      else if (mutation === 'hardlink') await link(fixture.pdfPath, join(fixture.root, 'retained.pdf'));
      else if (mutation === 'notPdf') await writeFile(fixture.pdfPath, Buffer.alloc(fixture.pdf.length, 65));
      else await writeFile(fixture.pdfPath, '%PDF-1.7 changed');
      await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
      expect(opened.every(database => !database.open)).toBe(true);
      expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
    });

  it('rejects a linked document directory rather than reading a different root', async () => {
    const fixture = await createFixture();
    const retained = `${fixture.documentsRoot}-retained`;
    await rename(fixture.documentsRoot, retained);
    await symlink(retained, fixture.documentsRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect(await readFile(join(retained, 'dev-company', 'invoice-1', 'document.pdf'))).toEqual(fixture.pdf);
  });

  it('never overwrites an occupied inspection copy directory', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.input.inspectionRoot, 'foreign'), 'retain');
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect(await readdir(fixture.input.inspectionRoot)).toEqual(['foreign']);
  });

  it.each(['database', 'copy', 'pdf', 'root'] as const)
    ('rejects a changed %s after the readonly connection has closed', async target => {
      const fixture = await createFixture();
      let mutated = false;
      fixture.assertOwned.mockImplementation(async () => {
        if (mutated || opened.length === 0 || opened.some(database => database.open)) return;
        mutated = true;
        if (target === 'root') {
          await rename(fixture.documentsRoot, `${fixture.documentsRoot}-retained`);
          await mkdir(fixture.documentsRoot, { mode: 0o700 });
        } else await writeFile(target === 'database' ? fixture.databasePath : target === 'copy'
          ? join(fixture.input.inspectionRoot, 'profile.sqlite') : fixture.pdfPath, 'changed after close');
      });
      await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
      expect(mutated).toBe(true);
      expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    });

  it('keeps the first schema cause separate from a later native close failure', async () => {
    const fixture = await createFixture({ extraSchema: true, closeFailure: true });
    const error = await runColdProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe('PROFILE_INSPECTION_DATABASE_CLOSE_FAILED');
    expect(error.errors.map((cause: Error) => cause.message)).toEqual(['PROFILE_SCHEMA_UNSUPPORTED', 'synthetic-close-failure']);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it.each(['schema', 'integrity', 'catalog'] as const)('keeps the cold %s memory failure ahead of native close failure', async phase => {
    const fixture = await createFixture({ closeFailure: true });
    const failure = new Database.SqliteError('synthetic private allocation detail', 'SQLITE_NOMEM');
    const open = fixture.openReadonly.getMockImplementation()!;
    const injected = vi.fn(() => { throw failure; });
    fixture.openReadonly.mockImplementation(path => {
      const connection = open(path);
      if (phase === 'schema' || phase === 'catalog') {
        const prepare = connection.prepare.bind(connection);
        vi.spyOn(connection, 'prepare').mockImplementation(sql =>
          sql.includes(phase === 'schema' ? 'FROM main.sqlite_schema' : 'AS artifact_count') ? injected() : prepare(sql));
      } else {
        const pragma = connection.pragma.bind(connection);
        vi.spyOn(connection, 'pragma').mockImplementation((sql, options) =>
          sql === 'integrity_check' ? injected() : pragma(sql, options));
      }
      return connection;
    });
    const error: unknown = await runColdProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(injected).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({ message: 'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED', errors: [
      { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure }, { message: 'synthetic-close-failure' },
    ] });
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    expect(fixture.writeDocumentBindings).not.toHaveBeenCalled();
    expect(opened.every(connection => !connection.open)).toBe(true);
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it.each(['forward', 'original', 'originalCloseFailure'] as const)
    ('preserves the catalog memory failure through the %s cold entrypoint', async kind => {
      const fixture = kind === 'forward' ? await createFixture()
        : await createOriginalFixture({ closeFailure: kind === 'originalCloseFailure' });
      const failure = new Database.SqliteError('synthetic private catalog detail', 'SQLITE_NOMEM');
      const injected = vi.fn(() => { throw failure; });
      const open = fixture.openReadonly.getMockImplementation()!;
      fixture.openReadonly.mockImplementation(path => {
        const connection = open(path);
        const prepare = connection.prepare.bind(connection);
        vi.spyOn(connection, 'prepare').mockImplementation(sql => sql.includes('AS artifact_count') ? injected() : prepare(sql));
        return connection;
      });
      const error: unknown = await (fixture.input.kind === 'inspectColdRestoreContent'
        ? runColdProfileInspection(fixture.input, fixture.control)
        : runColdOriginalProfileInspection(fixture.input, fixture.control)).catch(error => error);
      expect(injected).toHaveBeenCalledOnce();
      const classified = { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure };
      expect(error).toMatchObject(kind === 'originalCloseFailure'
        ? { message: 'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED', errors: [classified, { message: 'synthetic-close-failure' }] }
        : classified);
      expect(fixture.artifactIdentity).not.toHaveBeenCalled();
      expect(fixture.writeDocumentBindings).not.toHaveBeenCalled();
      expect(opened.every(database => !database.open)).toBe(true);
      expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
      expect(await readFile(fixture.pdfPath)).toEqual(fixture.pdf);
    });

  it('does not report success when only native close fails', async () => {
    const fixture = await createFixture({ closeFailure: true });
    const error = await runColdProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((cause: Error) => cause.message)).toEqual(['synthetic-close-failure']);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
  });

  it('retains cancellation before the separate close failure', async () => {
    const fixture = await createFixture({ closeFailure: true });
    fixture.assertOwned.mockImplementation(async () => {
      if (opened.length !== 0) fixture.cancellation.abort();
    });
    const error = await runColdProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((cause: Error) => cause.message)).toEqual(['PROFILE_INSPECTION_TIMEOUT', 'synthetic-close-failure']);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
  });

  it.each(['database', 'pdf'] as const)('rejects a %s change in the final awaited authority check', async target => {
    const fixture = await createFixture();
    let assertionsAfterClose = 0;
    let changed = false;
    fixture.assertOwned.mockImplementation(async () => {
      if (opened.length === 0 || opened.some(database => database.open)) return;
      if (++assertionsAfterClose === 3) {
        await writeFile(target === 'database' ? fixture.databasePath : fixture.pdfPath, 'late change');
        changed = true;
      }
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(changed).toBe(true);
  });

  it('rejects a transient copy replacement in the last pre-open authority check', async () => {
    const fixture = await createFixture({ historical: true });
    const copyPath = join(fixture.input.inspectionRoot, 'profile.sqlite');
    const replacementPath = join(fixture.root, 'replacement.sqlite');
    const retainedPath = join(fixture.root, 'retained.sqlite');
    await copyFile(fixture.databasePath, replacementPath);
    const replacement = new Database(replacementPath);
    try {
      replacement.prepare("UPDATE local_runtime_identity SET company_id = 'other-company'").run();
    } finally { replacement.close(); }
    let replaced = false;
    let restored = false;
    fixture.assertOwned.mockImplementation(async () => {
      if (!replaced && opened.length === 0 && await readFile(copyPath).catch(() => null) !== null) {
        await rename(copyPath, retainedPath);
        await rename(replacementPath, copyPath);
        replaced = true;
      } else if (replaced && !restored && opened.some(database => database.open)) {
        await rename(copyPath, replacementPath);
        await rename(retainedPath, copyPath);
        restored = true;
      }
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it('rejects a first PDF change in a later final-loop authority check', async () => {
    const fixture = await createFixture({ secondPdf: true });
    let assertionsAfterClose = 0;
    let changed = false;
    fixture.assertOwned.mockImplementation(async () => {
      if (opened.length === 0 || opened.some(database => database.open)) return;
      if (++assertionsAfterClose === 4) {
        await writeFile(fixture.pdfPath, 'late change to the first PDF');
        changed = true;
      }
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
  });

  it('does not publish success when document binding delivery fails', async () => {
    const fixture = await createFixture();
    fixture.writeDocumentBindings.mockRejectedValue(new Error('synthetic-binding-write'));
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow('synthetic-binding-write');
    expect(opened.every(database => !database.open)).toBe(true);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it('rebinds source bytes after document binding output and freezes the selection', async () => {
    const fixture = await createFixture();
    fixture.writeDocumentBindings.mockImplementation(async artifacts => {
      expect(Object.isFrozen(artifacts)).toBe(true);
      expect(artifacts.every(Object.isFrozen)).toBe(true);
      expect(opened.every(database => !database.open)).toBe(true);
      await writeFile(fixture.pdfPath, 'changed during binding output');
      return { byteSize: 34, sha256: 'f'.repeat(64) };
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
  });

  it('captures the selected sources before the first awaited authority check', async () => {
    const fixture = await createFixture();
    fixture.assertOwned.mockImplementationOnce(async () => {
      fixture.input.databaseSlot = 'active';
      fixture.input.documentsSlot = 'active';
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).resolves.toMatchObject({
      databaseSlot: 'staged', documentsSlot: 'staged', database: { sha256: hash(fixture.bytes) },
    });
  });

  it.each(['cancel', 'lostOwner'] as const)('cannot report success after %s', async target => {
    const fixture = await createFixture();
    fixture.assertOwned.mockImplementation(async () => {
      if (opened.length === 0) return;
      if (target === 'cancel') fixture.cancellation.abort();
      else throw new Error('synthetic-lost-owner');
    });
    await expect(runColdProfileInspection(fixture.input, fixture.control)).rejects.toThrow(
      target === 'cancel' ? 'PROFILE_INSPECTION_TIMEOUT' : 'synthetic-lost-owner');
    expect(opened.every(database => !database.open)).toBe(true);
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it('rejects protocol or fixed slot violations before native loading', async () => {
    const fixture = await createFixture();
    for (const input of [
      { ...fixture.input, kind: 'inspect' }, { ...fixture.input, operationId: '../other' },
      { ...fixture.input, databaseSlot: 'rollback' }, { ...fixture.input, documentsSlot: 'portable' },
      { ...fixture.input, workspaceRoot: 'relative' }, { ...fixture.input, inspectionRoot: fixture.operationRoot },
      { ...fixture.input, nativeResourceRoot: undefined },
    ]) await expect(runColdProfileInspection(input as ColdProfileInspectionOperation, fixture.control))
      .rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.factory).not.toHaveBeenCalled();
  });
});

describe('original cold restore content inspection', () => {
  it.each([
    ['profileRestore', 'active', 'active'],
    ['profileRestore', 'active', 'rollback'],
    ['profileRestore', 'rollback', 'active'],
    ['profileRestore', 'rollback', 'rollback'],
    ['workspaceReplacement', 'active', 'active'],
    ['workspaceReplacement', 'active', 'rollback'],
    ['workspaceReplacement', 'rollback', 'active'],
    ['workspaceReplacement', 'rollback', 'rollback'],
  ] as const)('uses the fixed %s original layout with %s DB and %s PDFs', async (layout, databaseSlot, documentsSlot) => {
    const fixture = await createOriginalFixture({ layout, databaseSlot, documentsSlot });
    const result = await runColdOriginalProfileInspection(fixture.input, fixture.control);
    expect(result).toMatchObject({ sourceRole: 'original', layout, databaseSlot, documentsSlot,
      databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', artifactCount: 1,
      database: { sha256: hash(fixture.bytes) } });
    expect(result).not.toHaveProperty('artifactCatalog');
    expect(fixture.openReadonly).toHaveBeenCalledExactlyOnceWith(join(fixture.input.inspectionRoot, 'profile.sqlite'));
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
    expect(await readFile(fixture.pdfPath)).toEqual(fixture.pdf);
  });

  it.each(['active', 'rollback', 'absent'] as const)('does not inspect or create a DB for absent original with %s documents', async documentsSlot => {
    const fixture = await createOriginalFixture({ databaseSlot: 'absent', documentsSlot });
    const catalog = vi.spyOn(SqliteInvoiceBackupArtifactCatalog.prototype, 'listAuthoritativeArtifacts');
    const result = await runColdOriginalProfileInspection(fixture.input, fixture.control);
    expect(result).toEqual({ sourceRole: 'original', layout: 'profileRestore', databaseSlot: 'absent', documentsSlot });
    expect(fixture.factory).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    expect(fixture.writeDocumentBindings).not.toHaveBeenCalled();
    expect(await readdir(fixture.input.inspectionRoot)).toEqual([]);
    if (documentsSlot !== 'absent') expect(await readFile(fixture.pdfPath)).toEqual(fixture.pdf);
  });

  it('does not misread a retained active target as a journal-proven absent original', async () => {
    const fixture = await createOriginalFixture({ databaseSlot: 'absent', documentsSlot: 'absent' });
    const active = join(fixture.input.workspaceRoot, 'runtime', 'data', 'eky.sqlite');
    await mkdir(dirname(active), { recursive: true, mode: 0o700 });
    await writeFile(active, 'retained target, not an original database');
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).resolves.toHaveProperty('databaseSlot', 'absent');
    expect(fixture.factory).not.toHaveBeenCalled();
    expect(await readFile(active, 'utf8')).toBe('retained target, not an original database');
  });

  it.each(['active', 'rollback'] as const)('rejects missing expected %s DB instead of inventing absence', async databaseSlot => {
    const fixture = await createOriginalFixture({ databaseSlot });
    await rm(fixture.databasePath);
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(fixture.openReadonly).not.toHaveBeenCalled();
  });

  it('admits historical 038 with absent documents only after attesting an empty catalog', async () => {
    const fixture = await createOriginalFixture({ historical: true, documentsSlot: 'absent' });
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).resolves.toMatchObject({
      databaseHealth: 'healthy', documentsSlot: 'absent', artifactCount: 0, artifactTotalByteSize: 0,
    });
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it('rejects absent documents when the original catalog requires a PDF', async () => {
    const fixture = await createOriginalFixture({ documentsSlot: 'absent' });
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    expect(opened.every(database => !database.open)).toBe(true);
    expect(fixture.writeDocumentBindings).not.toHaveBeenCalled();
  });

  it('attests original schema before catalog SQL and retains the first reason across close failure', async () => {
    const fixture = await createOriginalFixture({ extraSchema: true, closeFailure: true });
    const catalog = vi.spyOn(SqliteInvoiceBackupArtifactCatalog.prototype, 'listAuthoritativeArtifacts');
    const error = await runColdOriginalProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((cause: Error) => cause.message)).toEqual(['PROFILE_SCHEMA_UNSUPPORTED', 'synthetic-close-failure']);
    expect(catalog).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath)).toEqual(fixture.bytes);
  });

  it.each(['database', 'pdf'] as const)('rejects changed original %s after the owned binding output', async target => {
    const fixture = await createOriginalFixture();
    fixture.writeDocumentBindings.mockImplementationOnce(async () => {
      await writeFile(target === 'database' ? fixture.databasePath : fixture.pdfPath, 'changed original bytes');
      return { byteSize: 34, sha256: 'f'.repeat(64) };
    });
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).rejects.toThrow();
    expect(fixture.artifactIdentity).not.toHaveBeenCalled();
  });

  it('rejects a wrong anchor/layout or a forward slot before native loading', async () => {
    const fixture = await createOriginalFixture();
    for (const input of [
      { ...fixture.input, anchorRoot: fixture.operationRoot }, { ...fixture.input, layout: 'workspaceReplacement' },
      { ...fixture.input, databaseSlot: 'staged' }, { ...fixture.input, documentsSlot: 'staged' },
      { ...fixture.input, kind: 'inspectColdRestoreContent' },
    ]) await expect(runColdOriginalProfileInspection(input as ColdOriginalProfileInspectionOperation, fixture.control))
      .rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.factory).not.toHaveBeenCalled();
  });

  it('keeps cancellation fail-closed even for absent DB', async () => {
    const fixture = await createOriginalFixture({ databaseSlot: 'absent', documentsSlot: 'absent' });
    fixture.assertOwned.mockImplementationOnce(async () => { fixture.cancellation.abort(); });
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(fixture.factory).not.toHaveBeenCalled();
  });

  it('rejects a replaced anchor after the absence-selection authority await', async () => {
    const fixture = await createOriginalFixture({ databaseSlot: 'absent', documentsSlot: 'absent' });
    fixture.assertOwned.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
      await rename(fixture.input.anchorRoot, `${fixture.input.anchorRoot}-retained`);
      await mkdir(fixture.input.anchorRoot, { mode: 0o700 });
    });
    await expect(runColdOriginalProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.factory).not.toHaveBeenCalled();
  });
});

async function createOriginalFixture(options: {
  layout?: 'profileRestore' | 'workspaceReplacement'; databaseSlot?: 'active' | 'rollback' | 'absent';
  documentsSlot?: 'active' | 'rollback' | 'absent'; historical?: boolean; extraSchema?: boolean; closeFailure?: boolean;
} = {}) {
  const fixture = await createFixture({ historical: options.historical ?? false,
    extraSchema: options.extraSchema ?? false, closeFailure: options.closeFailure ?? false });
  const layout = options.layout ?? 'profileRestore';
  const workspaceRoot = layout === 'profileRestore' ? fixture.input.workspaceRoot : join(fixture.root, 'workspaces', randomUUID());
  const failedRoot = layout === 'profileRestore' ? join(workspaceRoot, 'runtime', 'failed-profile-restores')
    : join(fixture.root, 'workspace-replacement-operations', 'activation', 'failed');
  const rollbackRoot = layout === 'profileRestore' ? join(workspaceRoot, 'runtime', 'profile-restore-rollback')
    : join(fixture.root, 'workspace-replacement-operations', 'activation', 'rollback');
  const anchorRoot = join(failedRoot, fixture.input.operationId);
  const rollbackOperationRoot = join(rollbackRoot, fixture.input.operationId);
  const inspectionRoot = join(failedRoot, `profile-inspection-${randomUUID()}`);
  const databaseSlot = options.databaseSlot ?? 'rollback';
  const documentsSlot = options.documentsSlot ?? 'rollback';
  const databasePath = databaseSlot === 'active' ? join(workspaceRoot, 'runtime', 'data', 'eky.sqlite')
    : join(rollbackOperationRoot, 'data', 'eky.sqlite');
  const documentsRoot = documentsSlot === 'active' ? join(workspaceRoot, 'runtime', 'storage', 'invoices')
    : join(rollbackOperationRoot, 'storage', 'invoices');
  for (const root of [workspaceRoot, anchorRoot, inspectionRoot]) await mkdir(root, { recursive: true, mode: 0o700 });
  if (databaseSlot !== 'absent') {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
    await rename(fixture.databasePath, databasePath);
  }
  if (documentsSlot !== 'absent') {
    await mkdir(dirname(documentsRoot), { recursive: true, mode: 0o700 });
    await rename(fixture.documentsRoot, documentsRoot);
  }
  return { ...fixture, databasePath, documentsRoot, pdfPath: join(documentsRoot, 'dev-company', 'invoice-1', 'document.pdf'),
    input: { kind: 'inspectColdRestoreOriginal' as const, operationId: fixture.input.operationId, anchorRoot, inspectionRoot,
      workspaceRoot, layout, databaseSlot, documentsSlot, migrationsDirectory, nativeResourceRoot: fixture.input.nativeResourceRoot } };
}

async function createFixture(options: {
  databaseSlot?: 'active' | 'staged'; documentsSlot?: 'active' | 'staged';
  historical?: boolean; extraSchema?: boolean; closeFailure?: boolean; secondPdf?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-content-'));
  roots.push(root);
  const workspaceRoot = join(root, 'workspace');
  const stagingRoot = join(root, 'staging');
  const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId);
  const inspectionRoot = join(stagingRoot, `profile-inspection-${randomUUID()}`);
  const databaseSlot = options.databaseSlot ?? 'staged';
  const documentsSlot = options.documentsSlot ?? 'staged';
  const databasePath = databaseSlot === 'active' ? join(workspaceRoot, 'runtime', 'data', 'eky.sqlite') : join(operationRoot, 'profile.sqlite');
  const documentsRoot = documentsSlot === 'active' ? join(workspaceRoot, 'runtime', 'storage', 'invoices')
    : join(operationRoot, 'activation', 'storage', 'invoices');
  for (const path of [workspaceRoot, operationRoot, inspectionRoot, dirname(databasePath), documentsRoot]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const pdf = Buffer.from('%PDF-1.7\nsynthetic cold invoice\n');
  const pdfPath = join(documentsRoot, 'dev-company', 'invoice-1', 'document.pdf');
  const prefixDirectory = join(root, 'through-038');
  await mkdir(prefixDirectory, { mode: 0o700 });
  for (const name of (await readdir(migrationsDirectory)).filter(name => /^\d{3}_.*\.sql$/.test(name) && name < '039_')) {
    await copyFile(join(migrationsDirectory, name), join(prefixDirectory, name));
  }
  const database = options.historical ? new Database(':memory:') : await createInvoiceReadModelTestDatabase(prefixDirectory);
  try {
    if (options.historical) createHistorical038Schema(database, readMigrationManifest(migrationsDirectory), false);
    database.prepare("UPDATE local_runtime_identity SET installation_id = ?, company_id = 'dev-company', actor_id = 'local-owner' WHERE singleton_key = 'local-runtime'")
      .run('a'.repeat(32));
    if (!options.historical) {
      database.prepare(`INSERT INTO invoice_documents
        (id, company_id, invoice_id, document_type, file_name, storage_path, mime_type, sha256, size_bytes, created_at)
        VALUES ('document-1', 'dev-company', 'invoice-1', 'approved_invoice_pdf', 'invoice.pdf',
          'dev-company/invoice-1/document.pdf', 'application/pdf', ?, ?, '2026-08-04')`).run(hash(pdf), pdf.length);
      await mkdir(dirname(pdfPath), { recursive: true, mode: 0o700 });
      await writeFile(pdfPath, pdf);
      if (options.secondPdf) {
        insertInvoiceClone(database, { id: 'invoice-2', sourceDraftId: 'draft-2', invoiceKind: 'standard',
          creditedInvoiceId: null, invoiceNumber: '202602', status: 'approved', totalGrossCents: 0,
          invoiceDate: '2026-08-04' });
        database.prepare(`INSERT INTO invoice_documents
          (id, company_id, invoice_id, document_type, file_name, storage_path, mime_type, sha256, size_bytes, created_at)
          VALUES ('document-2', 'dev-company', 'invoice-2', 'approved_invoice_pdf', 'invoice-2.pdf',
            'dev-company/invoice-2/document.pdf', 'application/pdf', ?, ?, '2026-08-04')`).run(hash(pdf), pdf.length);
        const secondPdfPath = join(documentsRoot, 'dev-company', 'invoice-2', 'document.pdf');
        await mkdir(dirname(secondPdfPath), { recursive: true, mode: 0o700 });
        await writeFile(secondPdfPath, pdf);
      }
      // The real migration owns the legacy document/revision binding.
      await runMigrations(database, { migrationsDirectory });
    }
    if (options.extraSchema) database.exec('CREATE VIEW untrusted_cold_view AS SELECT 1');
    await database.backup(databasePath);
  } finally { database.close(); }
  const openReference = () => new Database(':memory:');
  const openReadonly = vi.fn((path: string) => {
    const connection = new Database(path, { readonly: true, fileMustExist: true });
    opened.push(connection);
    if (options.closeFailure) {
      const close = connection.close.bind(connection);
      vi.spyOn(connection, 'close').mockImplementation(() => { close(); throw new Error('synthetic-close-failure'); });
    }
    return connection;
  });
  // Unit substitution only; the existing real utility owns native budget proof.
  const factory = vi.spyOn(nativeFactory, 'createProfileInspectionDatabaseFactory').mockResolvedValue({
    openReadonly, openReference, schemaReferences: createMigrationSchemaReferences(openReference),
  });
  const cancellation = new AbortController();
  const assertOwned = vi.fn(async () => {});
  const artifactIdentity = vi.fn((_artifacts: readonly import('./validateProfileArtifactCatalog.js').ValidatedProfileArtifact[]) => 'e'.repeat(64));
  const writeDocumentBindings = vi.fn(async (_artifacts: readonly import('./validateProfileArtifactCatalog.js').ValidatedProfileArtifact[]) =>
    ({ byteSize: 34, sha256: 'f'.repeat(64) }));
  return { root, operationRoot, databasePath, documentsRoot, pdfPath, pdf,
    bytes: await readFile(databasePath), openReadonly, factory, cancellation, assertOwned, artifactIdentity, writeDocumentBindings,
    input: { kind: 'inspectColdRestoreContent' as const, operationId, stagingRoot, inspectionRoot, workspaceRoot,
      databaseSlot, documentsSlot, migrationsDirectory, nativeResourceRoot: join(root, 'native') },
    control: { signal: cancellation.signal, assertOwned, createArtifactIdentity: artifactIdentity, writeDocumentBindings } };
}

function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
