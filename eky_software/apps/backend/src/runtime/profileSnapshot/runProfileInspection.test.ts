import { createHash, randomUUID } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import { createHistorical038Schema } from '../../database/migration/migrationSchemaHistory.fixture.js';
import { createMigrationSchemaReferences } from '../../database/migration/migrationSchemaReference.js';
import * as nativeFactory from './createProfileInspectionDatabase.js';
import { runProfileInspection } from './runProfileInspection.js';

const roots: string[] = [];
const migrationsDirectory = resolve(fileURLToPath(new URL('../../database/migrations/', import.meta.url)));

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('fixed profile inspection operation', () => {
  it('binds actual database and catalog bytes and closes the single readonly connection', async () => {
    const fixture = await createFixture();
    const before = await stat(fixture.databasePath);
    const result = await runProfileInspection(fixture.input, fixture.control);
    expect(result).toMatchObject({
      databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', artifactCount: 0, artifactTotalByteSize: 0,
      artifactIdentity: 'e'.repeat(64),
      profileId: expect.stringMatching(/^[a-f0-9]{64}$/), migrationChainIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      database: { byteSize: before.size, sha256: hash(fixture.databaseBytes) },
      artifactCatalog: { byteSize: fixture.catalogBytes.length, sha256: hash(fixture.catalogBytes) },
    });
    expect(fixture.openReadonly).toHaveBeenCalledOnce();
    expect(fixture.openReadonly).toHaveBeenCalledWith(join(fixture.input.inspectionRoot, 'profile.sqlite'));
    expect(fixture.opened[0]?.open).toBe(false);
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
    expect((await stat(fixture.databasePath)).mtimeMs).toBe(before.mtimeMs);
    expect(fixture.assertOwned).toHaveBeenCalledTimes(6);
    expect(fixture.createArtifactIdentity).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('prepares activation from that same single inspection without an active connection', async () => {
    const fixture = await createFixture();
    await expect(runProfileInspection({ ...fixture.input, kind: 'prepareRestoreActivation' }, fixture.control))
      .resolves.toMatchObject({ database: { sha256: hash(fixture.databaseBytes) }, artifactCount: 0,
        artifactIdentity: 'e'.repeat(64) });
    expect(fixture.createArtifactIdentity).toHaveBeenCalledExactlyOnceWith([]);
    expect(fixture.openReadonly).toHaveBeenCalledOnce();
    expect(fixture.opened[0]?.open).toBe(false);
    expect((await stat(join(fixture.operationRoot, 'activation', 'storage', 'invoices'))).isDirectory()).toBe(true);
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix', 'restoreCompatible'] as const)
    ('accepts the current complete schema under the explicit %s policy', async migrationPolicy => {
      const fixture = await createFixture();
      await expect(runProfileInspection({ ...fixture.input, migrationPolicy }, fixture.control))
        .resolves.toMatchObject({ migrationPolicy, database: { sha256: hash(fixture.databaseBytes) } });
      expect(fixture.openReadonly).toHaveBeenCalledOnce();
      expect(fixture.opened.every(connection => !connection.open)).toBe(true);
    });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix', 'restoreCompatible'] as const)
    ('retains the existing historical-prefix rule under %s', async migrationPolicy => {
      const fixture = await createFixture({ history: 'prefix' });
      const task = runProfileInspection({ ...fixture.input, migrationPolicy }, fixture.control);
      if (migrationPolicy === 'exactCurrentManifest') await expect(task).rejects.toMatchObject({
        message: 'PROFILE_SNAPSHOT_VALIDATION_FAILED', cause: { message: 'PROFILE_SNAPSHOT_MIGRATIONS_INVALID' },
      });
      else await expect(task).resolves.toMatchObject({ migrationPolicy, database: { sha256: hash(fixture.databaseBytes) } });
      expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
      expect(fixture.opened.every(connection => !connection.open)).toBe(true);
    });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix', 'restoreCompatible'] as const)
    ('never broadens published legacy 038 without metadata into the %s source policy', async migrationPolicy => {
      const fixture = await createFixture({ history: 'legacy038' });
      const task = runProfileInspection({ ...fixture.input, migrationPolicy }, fixture.control);
      if (migrationPolicy === 'restoreCompatible') await expect(task).resolves.toMatchObject({ migrationPolicy, artifactCount: 0 });
      else await expect(task).rejects.toMatchObject({
        message: 'PROFILE_SNAPSHOT_VALIDATION_FAILED', cause: { message: 'MIGRATION_HISTORY_INVALID' },
      });
      expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
      expect(fixture.opened.every(connection => !connection.open)).toBe(true);
    });

  it('rejects a changed committed schema and retains the staged source', async () => {
    const fixture = await createFixture();
    const database = new Database(fixture.databasePath);
    try { database.exec('CREATE VIEW unexpected_import_view AS SELECT 1'); }
    finally { database.close(); }
    const before = await readFile(fixture.databasePath);
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SCHEMA_UNSUPPORTED');
    expect((await readFile(fixture.databasePath)).equals(before)).toBe(true);
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it('cannot fall back when the delivered native factory is unavailable', async () => {
    const fixture = await createFixture();
    fixture.factory.mockRejectedValueOnce(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
  });

  it.each([
    'schemaPrepare', 'schemaRead', 'historyRead', 'metadataRead',
    'integrity', 'foreignKey', 'identity',
    'catalogPrepare', 'catalogCount', 'catalogDocuments',
  ] as const)('retains the native memory cause at %s without issuing a receipt', async phase => {
    const fixture = await createFixture();
    const failure = new Database.SqliteError('synthetic private memory detail', 'SQLITE_NOMEM');
    const open = fixture.openReadonly.getMockImplementation()!;
    const injected = vi.fn(() => { throw failure; });
    fixture.openReadonly.mockImplementation(path => {
      const connection = open(path);
      if (phase === 'integrity') {
        const pragma = connection.pragma.bind(connection);
        vi.spyOn(connection, 'pragma').mockImplementation((sql, options) =>
          sql === 'integrity_check' ? injected() : pragma(sql, options));
      } else {
        const prepare = connection.prepare.bind(connection);
        const target = phase.startsWith('schema') ? 'FROM main.sqlite_schema'
          : phase === 'historyRead' ? 'FROM main.schema_migrations '
            : phase === 'metadataRead' ? 'FROM main.schema_migration_metadata'
              : phase === 'foreignKey' ? 'PRAGMA foreign_key_check'
                : phase === 'catalogDocuments' ? 'AS document_id'
                  : phase.startsWith('catalog') ? 'AS artifact_count' : 'FROM local_runtime_identity';
        vi.spyOn(connection, 'prepare').mockImplementation(sql => {
          if (sql.includes(target) && (phase === 'schemaPrepare' || phase === 'catalogPrepare')) return injected();
          const statement = prepare(sql);
          if (sql.includes(target)) vi.spyOn(statement,
            phase === 'foreignKey' || phase === 'identity' || phase === 'catalogCount' ? 'get' : 'all').mockImplementation(injected);
          return statement;
        });
      }
      return connection;
    });
    const error: unknown = await runProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(injected).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
      cause: { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure } });
    expect(fixture.createArtifactIdentity).not.toHaveBeenCalled();
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
  });

  it.each(['inspect', 'prepareRestoreActivation'] as const)
    ('retains the legacy catalog memory cause during %s before activation or a receipt', async kind => {
      const fixture = await createFixture({ history: 'legacy038' });
      const failure = new Database.SqliteError('synthetic private catalog detail', 'SQLITE_NOMEM');
      const injected = vi.fn(() => { throw failure; });
      const open = fixture.openReadonly.getMockImplementation()!;
      fixture.openReadonly.mockImplementation(path => {
        const connection = open(path);
        const prepare = connection.prepare.bind(connection);
        vi.spyOn(connection, 'prepare').mockImplementation(sql => sql.includes('AS artifact_count') ? injected() : prepare(sql));
        return connection;
      });
      const error: unknown = await runProfileInspection({ ...fixture.input, kind }, fixture.control).catch(error => error);
      expect(injected).toHaveBeenCalledOnce();
      const classified = { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure };
      expect(error).toMatchObject({ message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: kind === 'inspect' ? classified
        : { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: classified } });
      expect(fixture.createArtifactIdentity).not.toHaveBeenCalled();
      expect(await readdir(fixture.operationRoot)).not.toContain('activation');
      expect(fixture.opened.every(connection => !connection.open)).toBe(true);
      expect(await readFile(fixture.databasePath)).toEqual(fixture.databaseBytes);
    });

  it.each(['integrity', 'catalog'] as const)('keeps %s memory rejection first when closing the rejected inspection also fails', async phase => {
    const fixture = await createFixture();
    const failure = new Database.SqliteError('synthetic private memory detail', 'SQLITE_NOMEM');
    const cleanupFailure = new Error('synthetic private close detail');
    const open = fixture.openReadonly.getMockImplementation()!;
    fixture.openReadonly.mockImplementation(path => {
      const connection = open(path);
      if (phase === 'catalog') {
        const prepare = connection.prepare.bind(connection);
        vi.spyOn(connection, 'prepare').mockImplementation(sql => {
          if (sql.includes('AS artifact_count')) throw failure;
          return prepare(sql);
        });
      } else {
        const pragma = connection.pragma.bind(connection);
        vi.spyOn(connection, 'pragma').mockImplementation((sql, options) => {
          if (sql === 'integrity_check') throw failure;
          return pragma(sql, options);
        });
      }
      const close = connection.close.bind(connection);
      vi.spyOn(connection, 'close').mockImplementation(() => { close(); throw cleanupFailure; });
      return connection;
    });
    const error: unknown = await runProfileInspection(fixture.input, fixture.control).catch(error => error);
    expect(error).toMatchObject({ message: 'PROFILE_SNAPSHOT_VALIDATION_FAILED',
      cause: { message: 'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED', errors: [
        { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure }, cleanupFailure,
      ] } });
    expect(fixture.createArtifactIdentity).not.toHaveBeenCalled();
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
  });

  it('rejects a malformed artifact identity from the fixed utility control', async () => {
    const fixture = await createFixture();
    fixture.createArtifactIdentity.mockReturnValueOnce('invalid');
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it.each(['healthy', 'untrusted'] as const)('emits no receipt and preserves the first %s cause when database close fails', async schema => {
    const fixture = await createFixture();
    if (schema === 'untrusted') {
      const database = new Database(fixture.databasePath);
      try { database.exec('CREATE VIEW unexpected_close_view AS SELECT 1'); }
      finally { database.close(); }
    }
    const before = await readFile(fixture.databasePath);
    const open = fixture.openReadonly.getMockImplementation()!;
    fixture.openReadonly.mockImplementation(path => {
      const connection = open(path);
      const close = connection.close.bind(connection);
      vi.spyOn(connection, 'close').mockImplementation(() => { close(); throw new Error('private close detail'); });
      return connection;
    });
    const error: unknown = await runProfileInspection(fixture.input, fixture.control).catch(failure => failure as unknown);
    expect(error).toBeInstanceOf(Error);
    const closeFailure = (error as Error).cause as AggregateError;
    expect(closeFailure).toBeInstanceOf(AggregateError);
    expect(closeFailure.errors.map((failure: Error) => failure.message)).toEqual(schema === 'healthy'
      ? ['private close detail'] : ['PROFILE_SCHEMA_UNSUPPORTED', 'private close detail']);
    expect((await readFile(fixture.databasePath)).equals(before)).toBe(true);
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it('does not read the imported database after ownership is lost', async () => {
    const fixture = await createFixture();
    fixture.assertOwned.mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error('synthetic owner lost'));
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('synthetic owner lost');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
  });

  it.each(['catalog', 'database'] as const)('rejects %s replacement after inspection even when the new bytes are identical', async (target) => {
    const fixture = await createFixture();
    let assertions = 0;
    fixture.assertOwned.mockImplementation(async () => {
      if (++assertions !== 5) return;
      const path = target === 'database' ? fixture.databasePath : fixture.catalogPath;
      const bytes = await readFile(path);
      await rename(path, path + '.retained');
      await writeFile(path, bytes);
    });
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect((await stat((target === 'database' ? fixture.databasePath : fixture.catalogPath) + '.retained')).isFile()).toBe(true);
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it('rejects changed catalog bytes before emitting a successful receipt', async () => {
    const fixture = await createFixture();
    let assertions = 0;
    fixture.assertOwned.mockImplementation(async () => {
      if (++assertions === 5) await writeFile(fixture.catalogPath, '{ "formatVersion":1,"artifacts":[] }');
    });
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it('does not initialize the native budget after cancellation', async () => {
    const fixture = await createFixture();
    fixture.cancellation.abort();
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(fixture.factory).not.toHaveBeenCalled();
    expect(fixture.openReadonly).not.toHaveBeenCalled();
  });

  it('retains files and emits no receipt when cancellation arrives after inspection', async () => {
    const fixture = await createFixture();
    let assertions = 0;
    fixture.assertOwned.mockImplementation(async () => { if (++assertions === 5) fixture.cancellation.abort(); });
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it('rejects a hard-linked staged database before opening SQLite', async () => {
    const fixture = await createFixture();
    await link(fixture.databasePath, join(fixture.root, 'retained-source.sqlite'));
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
  });

  it('rejects a forged operation or deployment before loading the native resource', async () => {
    const fixture = await createFixture();
    for (const input of [
      { ...fixture.input, operationId: '../other' },
      { ...fixture.input, kind: 'readActiveDatabase' as 'inspect' },
      { ...fixture.input, stagingRoot: 'relative' },
      { ...fixture.input, inspectionRoot: fixture.operationRoot },
      { ...fixture.input, inspectionRoot: undefined as unknown as string },
      { ...fixture.input, migrationPolicy: 'skipSchema' as 'restoreCompatible' },
      { ...fixture.input, migrationPolicy: undefined as unknown as 'restoreCompatible' },
    ]) await expect(runProfileInspection(input, fixture.control)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(fixture.factory).not.toHaveBeenCalled();
  });

  it('inspects unchanged WAL backup bytes only in the independently owned copy', async () => {
    const fixture = await createFixture({ wal: true });
    const initialNames = await readdir(fixture.operationRoot);
    await expect(runProfileInspection(fixture.input, fixture.control)).resolves.toMatchObject({
      database: { sha256: hash(fixture.databaseBytes), byteSize: fixture.databaseBytes.length },
    });
    expect(await readdir(fixture.operationRoot)).toEqual(initialNames);
    expect(fixture.databaseBytes[18]).toBe(2);
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
    expect((await readFile(join(fixture.input.inspectionRoot, 'profile.sqlite'))).equals(fixture.databaseBytes)).toBe(true);
    expect(await readdir(fixture.input.inspectionRoot)).toEqual(['profile.sqlite', 'profile.sqlite-shm', 'profile.sqlite-wal']);
    expect((await stat(join(fixture.input.inspectionRoot, 'profile.sqlite-wal'))).size).toBe(0);
    expect(fixture.opened.every(connection => !connection.open)).toBe(true);
  });

  it.each(['profile.sqlite-wal', 'profile.sqlite-shm', 'profile.sqlite-journal'])
    ('does not remove or accept a preexisting source sidecar %s', async name => {
      const fixture = await createFixture({ wal: true });
      const path = join(fixture.operationRoot, name);
      await writeFile(path, 'retain unknown source');
      await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
      expect(await readFile(path, 'utf8')).toBe('retain unknown source');
      expect(fixture.openReadonly).not.toHaveBeenCalled();
      expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
    });

  it('never overwrites existing contents of the proposed copy root', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.input.inspectionRoot, 'foreign'), 'retain');
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(await readdir(fixture.input.inspectionRoot)).toEqual(['foreign']);
    expect(await readFile(join(fixture.input.inspectionRoot, 'foreign'), 'utf8')).toBe('retain');
    expect(fixture.openReadonly).not.toHaveBeenCalled();
  });

  it('rejects changes to the copied bytes after the readonly inspection', async () => {
    const fixture = await createFixture();
    let assertions = 0;
    fixture.assertOwned.mockImplementation(async () => {
      if (++assertions === 5) await writeFile(join(fixture.input.inspectionRoot, 'profile.sqlite'), 'changed copy');
    });
    await expect(runProfileInspection(fixture.input, fixture.control)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect((await readFile(fixture.databasePath)).equals(fixture.databaseBytes)).toBe(true);
    expect(await readFile(join(fixture.input.inspectionRoot, 'profile.sqlite'), 'utf8')).toBe('changed copy');
  });
});

async function createFixture(options: { history?: 'prefix' | 'legacy038'; wal?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-fixed-inspection-'));
  roots.push(root);
  const stagingRoot = join(root, 'staging');
  const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId);
  await mkdir(operationRoot, { recursive: true, mode: 0o700 });
  const inspectionRoot = join(stagingRoot, `profile-inspection-${randomUUID()}`);
  await mkdir(inspectionRoot, { mode: 0o700 });
  const databasePath = join(operationRoot, 'profile.sqlite');
  const catalogPath = join(operationRoot, 'snapshot-catalog-v1.json');
  const database = new Database(options.wal ? join(root, 'wal-source.sqlite') : databasePath);
  try {
    if (options.wal) database.pragma('journal_mode = WAL');
    if (options.history === 'legacy038') createHistorical038Schema(database, readMigrationManifest(migrationsDirectory), false);
    else await runMigrations(database, { migrationsDirectory });
    database.prepare('UPDATE local_runtime_identity SET installation_id = ?, company_id = ?, actor_id = ? WHERE singleton_key = ?')
      .run('a'.repeat(32), 'synthetic-inspection', 'local-owner', 'local-runtime');
    if (options.wal) await database.backup(databasePath);
  } finally { database.close(); }
  let expectedMigrationsDirectory = migrationsDirectory;
  if (options.history === 'prefix') {
    expectedMigrationsDirectory = join(root, 'expected-migrations');
    await cp(migrationsDirectory, expectedMigrationsDirectory, { recursive: true });
    const nextOrdinal = String(readMigrationManifest(migrationsDirectory).length + 1).padStart(3, '0');
    await writeFile(join(expectedMigrationsDirectory, `${nextOrdinal}_future_inspection_policy.sql`),
      'CREATE TABLE future_inspection_policy (id TEXT PRIMARY KEY);', 'utf8');
  }
  const catalogBytes = Buffer.from(JSON.stringify({ formatVersion: 1, artifacts: [] }));
  await writeFile(catalogPath, catalogBytes);
  const opened: Database.Database[] = [];
  const openReference = () => new Database(':memory:');
  const openReadonly = vi.fn((path: string) => {
    const connection = new Database(path, { readonly: true, fileMustExist: true });
    opened.push(connection);
    return connection;
  });
  // Unit-only substitution; real native provenance/budget is tested in a utility.
  const factory = vi.spyOn(nativeFactory, 'createProfileInspectionDatabaseFactory').mockResolvedValue({
    openReadonly, openReference, schemaReferences: createMigrationSchemaReferences(openReference),
  });
  const assertOwned = vi.fn(async () => {});
  const cancellation = new AbortController();
  const createArtifactIdentity = vi.fn(() => 'e'.repeat(64));
  return { root, operationRoot, databasePath, catalogPath, catalogBytes,
    databaseBytes: await readFile(databasePath), openReadonly, opened, factory, assertOwned, cancellation, createArtifactIdentity,
    input: { kind: 'inspect' as const, migrationPolicy: 'restoreCompatible' as const, operationId, stagingRoot, inspectionRoot,
      migrationsDirectory: expectedMigrationsDirectory, nativeResourceRoot: join(root, 'native') },
    control: { signal: cancellation.signal, assertOwned, createArtifactIdentity } };
}

function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
