import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profileInspectionNativeContract as contract } from '../../database/connection/profileInspectionNativeContract.js';
import { createProfileInspectionDatabaseFactory } from './createProfileInspectionDatabase.js';
import { profileInspectionSqliteHeapBytes } from './profileInspectionSqlite.js';

vi.mock('better-sqlite3', () => ({ default: vi.fn() }));
const roots: string[] = [];
const opened: Database.Database[] = [];
const sourceId = `2026-01-01 00:00:00 ${'c'.repeat(64)}`;
const compileOptions = ['THREADSAFE=2'];

beforeEach(() => {
  vi.mocked(Database).mockReset();
  vi.mocked(Database).mockImplementation(function (_path, options) {
    let heap = 0;
    let isOpen = true;
    const connection = {
      readonly: options?.readonly === true,
      get open() { return isOpen; },
      close() { isOpen = false; },
      prepare: vi.fn(() => ({ get: () => ({ id: sourceId }) })),
      pragma: vi.fn((name: string) => {
        if (name === 'compile_options') return compileOptions.map(option => ({ compile_options: option }));
        if (name.startsWith('hard_heap_limit = ')) heap = Number(name.split(' = ')[1]);
        const readbacks: Record<string, number> = {
          hard_heap_limit: heap, trusted_schema: 0, query_only: 1,
          mmap_size: 0, cache_size: -2000, temp_store: 2,
        };
        return readbacks[name];
      }),
    } as unknown as Database.Database;
    opened.push(connection);
    return connection;
  });
});
afterEach(async () => {
  for (const database of opened.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function resource() {
  const root = await mkdtemp(join(tmpdir(), 'eky-inspection-factory-'));
  roots.push(root);
  const native = Buffer.alloc(contract.minimumNativeBytes, 1);
  const metadata = {
    schemaVersion: 1, purpose: contract.purpose, packageVersion: contract.packageVersion,
    addonApiVersion: contract.addonApiVersion, sourceIntegrity: contract.sourceIntegrity,
    addonApiIntegrity: contract.addonApiIntegrity, patchIdentity: contract.patchIdentity,
    sourceIdentity: 'a'.repeat(64), patchedSourceIdentity: 'b'.repeat(64),
    platform: process.platform, arch: process.arch, nodeVersion: contract.nodeVersion,
    nodeGypVersion: contract.nodeGypVersion, napiVersion: contract.napiVersion,
    sqliteSourceId: sourceId, compileOptions, nativeSize: native.length,
    nativeSha256: createHash('sha256').update(native).digest('hex'),
  };
  await writeFile(join(root, contract.fileName), native);
  await writeFile(join(root, contract.metadataFileName), JSON.stringify(metadata));
  return { root, metadata };
}

describe('required inspection-only database factory', () => {
  it('uses the canonical native path for every connection and namespaced paths only for SQLite files', async () => {
    const { root } = await resource();
    const factory = await createProfileInspectionDatabaseFactory(root);
    expect(opened).toHaveLength(2);
    expect(opened.every(database => !database.open)).toBe(true);
    const reference = factory.openReference();
    reference.close();
    const target = join(root, 'profile.sqlite');
    const database = factory.openReadonly(target);
    expect(database.readonly).toBe(true);
    database.close();
    for (const [_path, options] of vi.mocked(Database).mock.calls) {
      expect(options?.nativeBinding).toBe(join(root, contract.fileName));
    }
    expect(vi.mocked(Database).mock.calls.at(-1)).toEqual([
      toNamespacedPath(target), { fileMustExist: true, readonly: true, nativeBinding: join(root, contract.fileName) },
    ]);
    expect(vi.mocked(requiredConnection(1).pragma)).toHaveBeenCalledWith(`hard_heap_limit = ${profileInspectionSqliteHeapBytes}`);
  });

  it('rejects missing or incompatible resources before creating any database connection', async () => {
    const { root, metadata } = await resource();
    await writeFile(join(root, contract.metadataFileName), JSON.stringify({ ...metadata, platform: 'unapproved' }));
    await expect(createProfileInspectionDatabaseFactory(root)).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    await expect(createProfileInspectionDatabaseFactory(join(root, 'missing'))).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    expect(Database).not.toHaveBeenCalled();
  });

  it('does not fall back when loading the required native binding fails', async () => {
    const { root } = await resource();
    vi.mocked(Database).mockImplementationOnce(function () { throw new Error('private native loader failure'); });
    await expect(createProfileInspectionDatabaseFactory(root)).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    expect(Database).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Database).mock.calls.at(0)?.[1]?.nativeBinding).toBe(join(root, contract.fileName));
  });

  it('closes the control and does not open an imported database on source mismatch', async () => {
    const { root, metadata } = await resource();
    await writeFile(join(root, contract.metadataFileName), JSON.stringify({
      ...metadata, sqliteSourceId: `2026-01-02 00:00:00 ${'d'.repeat(64)}`,
    }));
    await expect(createProfileInspectionDatabaseFactory(root)).rejects.toThrow(/^PROFILE_INSPECTION_PROTOCOL_INVALID$/);
    expect(Database).toHaveBeenCalledTimes(1);
    expect(requiredConnection(0).open).toBe(false);
  });

  it('closes a readonly connection if mandatory connection limits fail', async () => {
    const { root } = await resource();
    const factory = await createProfileInspectionDatabaseFactory(root);
    const reference = factory.openReference();
    vi.mocked(reference.pragma).mockReturnValue(99);
    vi.mocked(Database).mockImplementationOnce(function () { return reference; });
    expect(() => factory.openReadonly(join(root, 'profile.sqlite'))).toThrow(/^PROFILE_INSPECTION_LIMIT_EXCEEDED$/);
    expect(reference.open).toBe(false);
  });

  it.each(['reference', 'readonly'] as const)('retains the original native memory error when opening %s', async kind => {
    const { root } = await resource();
    const factory = await createProfileInspectionDatabaseFactory(root);
    const failure = Object.assign(new Error('synthetic private allocation detail'), { code: 'SQLITE_NOMEM' });
    vi.mocked(Database).mockImplementationOnce(function () { throw failure; });
    try {
      if (kind === 'reference') factory.openReference();
      else factory.openReadonly(join(root, 'profile.sqlite'));
      expect.unreachable('A failed native open must not return a connection');
    } catch (error) {
      expect(error).toMatchObject(kind === 'reference'
        ? { message: 'PROFILE_INSPECTION_PROTOCOL_INVALID', cause: {
          message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure,
        } }
        : { message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure });
    }
  });

  it('keeps a configuration allocation failure ahead of a later close failure', async () => {
    const { root } = await resource();
    const factory = await createProfileInspectionDatabaseFactory(root);
    const reference = factory.openReference();
    const failure = Object.assign(new Error('synthetic private allocation detail'), { code: 'SQLITE_NOMEM' });
    const cleanupFailure = new Error('synthetic private close detail');
    vi.mocked(reference.pragma).mockImplementation(() => { throw failure; });
    const close = reference.close.bind(reference);
    vi.spyOn(reference, 'close').mockImplementation(() => { close(); throw cleanupFailure; });
    vi.mocked(Database).mockImplementationOnce(function () { return reference; });
    expect(() => factory.openReadonly(join(root, 'profile.sqlite'))).toThrow(expect.objectContaining({
      message: 'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED', errors: [
        expect.objectContaining({ message: 'PROFILE_INSPECTION_LIMIT_EXCEEDED', cause: failure }), cleanupFailure,
      ],
    }));
    expect(reference.open).toBe(false);
  });
});

function requiredConnection(index: number): Database.Database {
  const connection = opened[index];
  if (connection === undefined) throw new Error('INSPECTION_FACTORY_FIXTURE_CONNECTION_MISSING');
  return connection;
}
