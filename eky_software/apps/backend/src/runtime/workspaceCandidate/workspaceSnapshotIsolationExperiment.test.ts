import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { constants, promises as fileSystem, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { inspectSqliteProfileConnection } from '../profileSnapshot/inspectSqliteProfileDatabase.js';

const roots: string[] = [];
afterEach(async () => {
  // All SQLite handles in these synthetic cases were actually closed. Simulated
  // missing acknowledgements apply to the experiment, not this test owner.
  for (const root of roots.splice(0)) await fileSystem.rm(root, { recursive: true, force: true });
});

describe('operation-owned snapshot inspection experiment (not production wiring)', () => {
  it('inspects a WAL backup copy, proves closure and removes only its new scratch root', async () => {
    const fixture = await createWalSnapshot();
    const before = await fingerprint(fixture.snapshot);
    const operation = await createInspectionCopy(fixture);
    const database = new Database(operation.databasePath, { readonly: true, fileMustExist: true });
    let closed = false;
    try {
      const inspection = inspectSqliteProfileConnection(database, fixture.migrationsDirectory, 'restoreCompatible');
      expect(inspection.profileId).toMatch(/^[0-9a-f]{64}$/);
      expect(database.pragma('user_version', { simple: true })).toBe(456);
      expect(await fingerprint(operation.databasePath)).toEqual(before);
    } finally {
      database.close();
      closed = !database.open;
    }
    expect(closed).toBe(true);
    const names = await fileSystem.readdir(operation.root);
    expect(names).toContain('inspection.sqlite');
    expect(names).toContain('inspection.sqlite-wal');
    expect((await fileSystem.lstat(operation.databasePath + '-wal')).size).toBe(0);

    await removeOwnedExperimentCopy(operation, closed);

    await expect(fileSystem.lstat(operation.root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fingerprint(fixture.snapshot)).toEqual(before);
    for (const suffix of ['-journal', '-wal', '-shm']) {
      await expect(fileSystem.lstat(fixture.snapshot + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each([
    'unconfirmedClose', 'foreignEntry', 'changedRoot',
    'rollbackJournal', 'nonemptyWal', 'hardLinkedShm',
  ] as const)(
    'preserves the disposable copy and original on %s', async reason => {
      const fixture = await createWalSnapshot();
      const before = await fingerprint(fixture.snapshot);
      const operation = await createInspectionCopy(fixture);
      const database = new Database(operation.databasePath, { readonly: true, fileMustExist: true });
      try { inspectSqliteProfileConnection(database, fixture.migrationsDirectory, 'restoreCompatible'); }
      finally { database.close(); }
      if (reason === 'foreignEntry') await fileSystem.writeFile(join(operation.root, 'unknown.bin'), 'preserve');
      if (reason === 'rollbackJournal') await fileSystem.writeFile(operation.databasePath + '-journal', 'preserve');
      if (reason === 'nonemptyWal') await fileSystem.writeFile(operation.databasePath + '-wal', 'preserve');
      if (reason === 'hardLinkedShm') await fileSystem.link(operation.databasePath + '-shm', join(fixture.root, 'linked-shm'));
      const proof = reason === 'changedRoot'
        ? { ...operation, identity: await fileSystem.lstat(fixture.root) }
        : operation;

      await expect(removeOwnedExperimentCopy(proof, reason !== 'unconfirmedClose')).rejects.toThrow('EXPERIMENT_CLEANUP_UNVERIFIED');

      expect(await fingerprint(operation.databasePath)).toEqual(before);
      expect(await fingerprint(fixture.snapshot)).toEqual(before);
      expect((await fileSystem.lstat(operation.root)).isDirectory()).toBe(true);
      if (reason === 'foreignEntry') expect(await fileSystem.readFile(join(operation.root, 'unknown.bin'), 'utf8')).toBe('preserve');
      if (reason === 'rollbackJournal') expect(await fileSystem.readFile(operation.databasePath + '-journal', 'utf8')).toBe('preserve');
      if (reason === 'nonemptyWal') expect(await fileSystem.readFile(operation.databasePath + '-wal', 'utf8')).toBe('preserve');
      if (reason === 'hardLinkedShm') expect((await fileSystem.lstat(operation.databasePath + '-shm')).nlink).toBe(2);
    },
  );
});

// Deliberately test-local: this does not grant production cleanup authority or
// replace the existing candidate reservation, process-exit and recovery owners.
async function createInspectionCopy(fixture: Awaited<ReturnType<typeof createWalSnapshot>>) {
  const root = await fileSystem.mkdtemp(join(fixture.root, 'inspection-'));
  if (process.platform !== 'win32') await fileSystem.chmod(root, 0o700);
  const identity = await fileSystem.lstat(root);
  const databasePath = join(root, 'inspection.sqlite');
  const before = await fingerprint(fixture.snapshot);
  await fileSystem.copyFile(fixture.snapshot, databasePath, constants.COPYFILE_EXCL);
  expect(await fingerprint(databasePath)).toEqual(before);
  expect((await fileSystem.lstat(databasePath)).nlink).toBe(1);
  return { root, identity, databasePath };
}

async function removeOwnedExperimentCopy(
  owner: { root: string; identity: Stats; databasePath: string },
  closeConfirmed: boolean,
) {
  const current = await fileSystem.lstat(owner.root);
  if (!closeConfirmed || !current.isDirectory() || current.isSymbolicLink() ||
      current.dev !== owner.identity.dev || current.ino !== owner.identity.ino) {
    throw new Error('EXPERIMENT_CLEANUP_UNVERIFIED');
  }
  const names = await fileSystem.readdir(owner.root);
  if (!names.includes('inspection.sqlite') || names.some(name =>
    !['inspection.sqlite', 'inspection.sqlite-wal', 'inspection.sqlite-shm'].includes(name))) {
    throw new Error('EXPERIMENT_CLEANUP_UNVERIFIED');
  }
  for (const name of names) {
    const entry = await fileSystem.lstat(join(owner.root, name));
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 ||
        (name === 'inspection.sqlite-wal' && entry.size !== 0)) {
      throw new Error('EXPERIMENT_CLEANUP_UNVERIFIED');
    }
  }
  await fileSystem.rm(owner.root, { recursive: true });
}

async function fingerprint(path: string) {
  const bytes = await fileSystem.readFile(path);
  return { byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function createWalSnapshot() {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-snapshot-isolation-experiment-'));
  roots.push(root);
  if (process.platform !== 'win32') await fileSystem.chmod(root, 0o700);
  const migrationsDirectory = join(root, 'migrations');
  await fileSystem.mkdir(migrationsDirectory, { mode: 0o700 });
  await fileSystem.writeFile(join(migrationsDirectory, '001_identity.sql'), `CREATE TABLE local_runtime_identity (
    singleton_key TEXT PRIMARY KEY, actor_id TEXT NOT NULL,
    company_id TEXT NOT NULL, installation_id TEXT NOT NULL
  );`);
  const snapshot = join(root, 'profile.sqlite');
  const database = new Database(join(root, 'active.sqlite'));
  try {
    await runMigrations(database, { migrationsDirectory });
    database.prepare('INSERT INTO local_runtime_identity VALUES (?, ?, ?, ?)')
      .run('local-runtime', 'local-owner', 'synthetic-company', 'a'.repeat(32));
    database.pragma('journal_mode = WAL');
    database.pragma('user_version = 456');
    await database.backup(snapshot);
  } finally { database.close(); }
  return { root, snapshot, migrationsDirectory };
}
