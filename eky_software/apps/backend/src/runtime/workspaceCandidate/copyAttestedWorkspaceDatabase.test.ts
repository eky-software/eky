import Database from 'better-sqlite3';
import { constants, promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { inspectSqliteProfileDatabase } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { assertCopiedWorkspaceDatabaseUnchanged, copyAttestedWorkspaceDatabase } from './copyAttestedWorkspaceDatabase.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fileSystem.rm(root, { recursive: true, force: true });
});

describe('copyAttestedWorkspaceDatabase', () => {
  it('accepts the closed output of SQLite backup while the source uses WAL', async () => {
    const input = await createFixture();
    const snapshot = input.sourcePath + '.snapshot';
    const activeDatabase = new Database(input.sourcePath);
    try {
      activeDatabase.pragma('journal_mode = WAL');
      activeDatabase.pragma('user_version = 456');
      await activeDatabase.backup(snapshot);
      const receipt = await copyAttestedWorkspaceDatabase({ ...input, sourcePath: snapshot });
      await expect(assertCopiedWorkspaceDatabaseUnchanged(input.destinationPath, receipt)).resolves.toBeUndefined();
      const copy = new Database(input.destinationPath, { readonly: true, fileMustExist: true });
      try { expect(copy.pragma('user_version', { simple: true })).toBe(456); }
      finally { copy.close(); }
    } finally { activeDatabase.close(); }
  });

  it('copies independent bytes and binds the destination to the inspected source', async () => {
    const input = await createFixture();
    const before = await fileSystem.readFile(input.sourcePath);
    const receipt = await copyAttestedWorkspaceDatabase(input);
    await expect(assertCopiedWorkspaceDatabaseUnchanged(input.destinationPath, receipt)).resolves.toBeUndefined();
    expect(await fileSystem.readFile(input.destinationPath)).toEqual(before);
    expect((await fileSystem.lstat(input.destinationPath)).nlink).toBe(1);
    await fileSystem.writeFile(input.sourcePath, Buffer.alloc(before.length));
    expect(await fileSystem.readFile(input.destinationPath)).toEqual(before);
    await fileSystem.writeFile(input.destinationPath, Buffer.alloc(before.length));
    await expect(assertCopiedWorkspaceDatabaseUnchanged(input.destinationPath, receipt)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
  });

  it('detects same-size corruption of the actual destination bytes', async () => {
    const input = await createFixture();
    const originalOpen = fileSystem.open;
    const changed = vi.fn();
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] === input.destinationPath) {
        const originalSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          // Change user_version, retaining valid SQLite and exactly the same length.
          await handle.write(Buffer.from([0, 0, 0, 123]), 0, 4, 60);
          changed();
          await originalSync();
        });
      }
      return handle;
    });
    await expect(copyAttestedWorkspaceDatabase(input)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    expect(changed).toHaveBeenCalledOnce();
    expect((await fileSystem.lstat(input.destinationPath)).size).toBe((await fileSystem.lstat(input.sourcePath)).size);
  });

  it('requires the exact inspected bytes before creating the migration destination', async () => {
    const input = await createFixture();
    const receipt = await copyAttestedWorkspaceDatabase(input);
    const changed = new Database(input.sourcePath);
    try { changed.pragma('user_version = 42'); }
    finally { changed.close(); }
    const destinationPath = input.destinationPath + '.migration';
    await expect(copyAttestedWorkspaceDatabase({ ...input, destinationPath, expectedBytes: receipt }))
      .rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    await expect(fileSystem.lstat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite or delete an exclusive-create collision', async () => {
    const input = await createFixture();
    const before = Buffer.from('other operation');
    await fileSystem.writeFile(input.destinationPath, before);
    await expect(copyAttestedWorkspaceDatabase(input)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fileSystem.readFile(input.destinationPath)).toEqual(before);
  });

  it('closes descriptors but retains its empty copy on cancellation', async () => {
    const input = await createFixture();
    const controller = new AbortController();
    const originalOpen = fileSystem.open;
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const originalClose = handle.close.bind(handle);
      const closed = vi.fn();
      closes.push(closed);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await originalClose(); closed(); });
      if (args[0] === input.destinationPath) controller.abort();
      return handle;
    });
    await expect(copyAttestedWorkspaceDatabase({ ...input, signal: controller.signal })).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
    expect(closes).toHaveLength(2);
    for (const closed of closes) expect(closed).toHaveBeenCalledOnce();
    expect((await fileSystem.lstat(input.destinationPath)).size).toBe(0);
  });

  it('preserves the partial copy and first error when closure cannot be confirmed', async () => {
    const input = await createFixture();
    const controller = new AbortController();
    const originalOpen = fileSystem.open;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] === input.destinationPath) {
        const originalClose = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          await originalClose();
          throw new Error('synthetic close failure');
        });
        controller.abort();
      }
      return handle;
    });
    const outcome = await copyAttestedWorkspaceDatabase({ ...input, signal: controller.signal }).catch(error => error as unknown);
    expect(outcome).toBeInstanceOf(AggregateError);
    expect((outcome as AggregateError).errors.map((error: Error) => error.message))
      .toEqual(['WORKSPACE_CANDIDATE_OPERATION_CANCELLED', 'synthetic close failure']);
    expect((await fileSystem.lstat(input.destinationPath)).size).toBe(0);
  });

  it.each(['sourcePath', 'destinationPath'] as const)(
    'rejects sidecars at %s without deleting their evidence', async key => {
      const input = await createFixture();
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const sidecar = input[key] + suffix;
        const bytes = Buffer.from('synthetic sidecar');
        await fileSystem.writeFile(sidecar, bytes);
        await expect(copyAttestedWorkspaceDatabase(input)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
        expect(await fileSystem.readFile(sidecar)).toEqual(bytes);
        await expect(fileSystem.lstat(input.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await fileSystem.unlink(sidecar);
      }
    },
  );

  it('rejects a newly introduced sidecar before reusing the copy', async () => {
    const input = await createFixture();
    const receipt = await copyAttestedWorkspaceDatabase(input);
    await fileSystem.writeFile(input.destinationPath + '-journal', 'synthetic journal');
    await expect(assertCopiedWorkspaceDatabaseUnchanged(input.destinationPath, receipt)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
    expect(await fileSystem.readFile(input.destinationPath)).toEqual(await fileSystem.readFile(input.sourcePath));
  });

  it('rejects linked sources and leaves both names untouched', async () => {
    const input = await createFixture();
    const alias = input.sourcePath + '.alias';
    await fileSystem.link(input.sourcePath, alias);
    await expect(copyAttestedWorkspaceDatabase(input)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
    expect((await fileSystem.lstat(alias)).nlink).toBe(2);
    await expect(fileSystem.lstat(input.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains a failed empty copy and unknown neighboring evidence after a zero-progress write', async () => {
    const input = await createFixture();
    const foreignPath = input.destinationPath + '.unknown';
    await fileSystem.writeFile(foreignPath, 'retain this evidence');
    const originalOpen = fileSystem.open;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] === input.destinationPath && typeof args[1] === 'number' && (args[1] & constants.O_EXCL) !== 0) {
        vi.spyOn(handle, 'write').mockResolvedValue({ buffer: '', bytesWritten: 0 });
      }
      return handle;
    });
    await expect(copyAttestedWorkspaceDatabase(input)).rejects.toThrow('WORKSPACE_CANDIDATE_DATABASE_INVALID');
    expect((await fileSystem.lstat(input.destinationPath)).size).toBe(0);
    expect(await fileSystem.readFile(foreignPath, 'utf8')).toBe('retain this evidence');
  });
});

async function createFixture() {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-attested-copy-'));
  roots.push(root);
  if (process.platform !== 'win32') await fileSystem.chmod(root, 0o700);
  const migrationsDirectory = join(root, 'migrations');
  await fileSystem.mkdir(migrationsDirectory, { mode: 0o700 });
  await fileSystem.writeFile(join(migrationsDirectory, '001_identity.sql'), `
CREATE TABLE local_runtime_identity (
  singleton_key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  installation_id TEXT NOT NULL
);`);
  const sourcePath = join(root, 'source.sqlite');
  const database = new Database(sourcePath);
  try {
    await runMigrations(database, { migrationsDirectory });
    database.prepare('INSERT INTO local_runtime_identity VALUES (?, ?, ?, ?)')
      .run('local-runtime', 'local-owner', 'synthetic-company', 'a'.repeat(32));
  } finally { database.close(); }
  const inspection = inspectSqliteProfileDatabase(sourcePath, migrationsDirectory);
  return {
    sourcePath, destinationPath: join(root, 'candidate.sqlite'), migrationsDirectory,
    expectedProfileId: inspection.profileId,
    expectedMigrationChainIdentity: inspection.migrationChainIdentity,
  };
}
