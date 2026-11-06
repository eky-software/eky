import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedBackupPayload } from './backupContainerReader.js';
import { extractBackupPayload } from './extractBackupPayload.js';

const roots: string[] = [];
afterEach(async ({ task }) => {
  vi.restoreAllMocks();
  const selected = roots.splice(0);
  if (task.result?.state !== 'pass') return;
  for (const root of selected) await rm(root, { recursive: true, force: true });
});

describe('partial backup extraction cleanup authority', () => {
  it.each([
    ['destination', 'resolve'], ['destination', 'reject'],
    ['source', 'resolve'], ['source', 'reject'],
  ] as const)('joins the guarded %s close before failed cleanup: %s', async (target, outcome) => {
    const fixture = await createCloseFixture();
    const primary = new Error('SYNTHETIC_SYNC_FAILED');
    const closeError = new Error('SYNTHETIC_CLOSE_FAILED');
    const entered = deferred();
    const closing = deferred();
    const open = fileSystem.open.bind(fileSystem);
    const removals = vi.spyOn(fileSystem, 'rm');
    const assertCleanupCurrent = vi.fn(() => {});
    let temporaryPath = '';
    let closeCalls = 0;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const destination = args[1] === 'wx';
      if (destination) {
        temporaryPath = String(args[0]);
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(primary);
      }
      if ((target === 'destination') === destination) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closeCalls++;
          entered.resolve();
          await closing.promise;
          await close();
          if (outcome === 'reject') throw closeError;
        });
      }
      return handle;
    });
    let settled = false;
    const task = extractBackupPayload({ ...fixture.input, assertCleanupCurrent })
      .catch((error: unknown) => error).finally(() => { settled = true; });
    try {
      await Promise.race([entered.promise, task.then(() => { throw new Error('CLOSE_NOT_REACHED'); })]);
      expect(settled).toBe(false);
      expect(removals).not.toHaveBeenCalled();
      expect(assertCleanupCurrent).not.toHaveBeenCalled();
      expect(await readFile(temporaryPath)).toEqual(fixture.database);
    } finally {
      closing.resolve();
      await task;
    }
    const error = await task;
    expect(closeCalls).toBe(1);
    if (outcome === 'reject') {
      expect(error).toMatchObject({ cleanupStatus: 'unverified', cause: { errors: [primary, closeError] } });
      expect(removals).not.toHaveBeenCalled();
      expect(await readFile(temporaryPath)).toEqual(fixture.database);
    } else {
      expect(error).toBe(primary);
      expect(removals).toHaveBeenCalledExactlyOnceWith(fixture.input.operationRoot, { force: true, recursive: true });
      await expect(readdir(fixture.input.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(fixture.input.payloadPath)).toEqual(fixture.payload);
  });

  it('retains a failed-link temporary file until the guarded source close settles', async () => {
    const fixture = await createCloseFixture();
    const primary = new Error('SYNTHETIC_LINK_FAILED');
    const closeError = new Error('SYNTHETIC_SOURCE_CLOSE_FAILED');
    const entered = deferred();
    const closing = deferred();
    const open = fileSystem.open.bind(fileSystem);
    const removals = vi.spyOn(fileSystem, 'rm');
    vi.spyOn(fileSystem, 'link').mockRejectedValueOnce(primary);
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === 'r') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          entered.resolve();
          await closing.promise;
          await close();
          throw closeError;
        });
      }
      return handle;
    });
    const task = extractBackupPayload({ ...fixture.input, assertCleanupCurrent: () => {} })
      .catch((error: unknown) => error);
    try {
      await Promise.race([entered.promise, task.then(() => { throw new Error('CLOSE_NOT_REACHED'); })]);
      expect(removals).not.toHaveBeenCalled();
    } finally { closing.resolve(); await task; }
    expect(await task).toMatchObject({ cleanupStatus: 'unverified', cause: { errors: [primary, closeError] } });
    expect(removals).not.toHaveBeenCalled();
    const files = await readdir(fixture.input.operationRoot);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.next$/);
    expect(await readFile(join(fixture.input.operationRoot, files[0]!))).toEqual(fixture.database);
  });

  it.each(['ordinary', 'sync', 'async', 'failedLink'] as const)(
    'preserves failed extraction only when cleanup is denied: %s', async (mode) => {
    const denied = mode !== 'ordinary';
    const root = await mkdtemp(join(tmpdir(), 'eky-extract-owner-'));
    roots.push(root);
    const payloadPath = join(root, 'payload');
    const operationRoot = join(root, 'operation');
    const database = Buffer.from('synthetic database');
    const catalog = Buffer.from('{"artifacts":[]}');
    const linkFailure = new Error('SYNTHETIC_LINK_FAILED');
    if (mode === 'failedLink') vi.spyOn(fileSystem, 'link').mockRejectedValueOnce(linkFailure);
    await writeFile(payloadPath, Buffer.concat([database, catalog]));
    const parsedPayload: ParsedBackupPayload = {
      manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: 0n, entries: [],
        profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64) },
      entries: [
        { type: 'manifest', logicalPath: 'manifest.bin', contentOffset: 0n, contentLength: 0n, sha256: '0'.repeat(64) },
        { type: 'database', logicalPath: 'profile.sqlite', contentOffset: 0n,
          contentLength: BigInt(database.length), sha256: createHash('sha256').update(database).digest('hex') },
        { type: 'artifactCatalog', logicalPath: 'snapshot-catalog-v1.json', contentOffset: BigInt(database.length),
          contentLength: BigInt(catalog.length), sha256: '0'.repeat(64) },
      ],
    };
    const assertCleanupCurrent = mode === 'async'
      ? async () => { throw new Error('SYNTHETIC_OWNER_LOST'); }
      : () => { throw new Error('SYNTHETIC_OWNER_LOST'); };
    const error = await extractBackupPayload({ operationRoot, parsedPayload, payloadPath,
      ...(denied ? { assertCleanupCurrent } : {}),
    }).catch(error => error);
    if (mode === 'failedLink') {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors[0]).toBe(linkFailure);
      const files = await readdir(operationRoot);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/\.next$/);
      expect(await readFile(join(operationRoot, files[0]!))).toEqual(database);
    } else if (denied) {
      expect(error).toMatchObject({ message: 'BACKUP_ENTRY_CHECKSUM_INVALID' });
      expect(await readFile(join(operationRoot, 'profile.sqlite'))).toEqual(database);
      expect((await readdir(operationRoot)).some(name => name.endsWith('.next'))).toBe(true);
    } else {
      expect(error).toMatchObject({ message: 'BACKUP_ENTRY_CHECKSUM_INVALID' });
      await expect(readdir(operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(payloadPath)).toEqual(Buffer.concat([database, catalog]));
  });
});

async function createCloseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-extract-close-'));
  roots.push(root);
  const database = Buffer.from('synthetic database');
  const catalog = Buffer.from('{"artifacts":[]}');
  const payload = Buffer.concat([database, catalog]);
  const payloadPath = join(root, 'payload');
  await writeFile(payloadPath, payload);
  const parsedPayload: ParsedBackupPayload = {
    manifest: { appVersion: '0.2.81', createdAtEpochMilliseconds: 0n, entries: [],
      profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64) },
    entries: [
      { type: 'manifest', logicalPath: 'manifest.bin', contentOffset: 0n, contentLength: 0n, sha256: '0'.repeat(64) },
      { type: 'database', logicalPath: 'profile.sqlite', contentOffset: 0n,
        contentLength: BigInt(database.length), sha256: createHash('sha256').update(database).digest('hex') },
      { type: 'artifactCatalog', logicalPath: 'snapshot-catalog-v1.json', contentOffset: BigInt(database.length),
        contentLength: BigInt(catalog.length), sha256: createHash('sha256').update(catalog).digest('hex') },
    ],
  };
  return { database, payload, input: { operationRoot: join(root, 'operation'), parsedPayload, payloadPath } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
