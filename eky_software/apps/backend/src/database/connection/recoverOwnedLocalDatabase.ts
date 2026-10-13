import Database from 'better-sqlite3';
import type { BigIntStats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export interface OwnedLocalDatabaseRecovery {
  readonly signal: AbortSignal;
  assertOwnedDatabase(databaseFilePath: string): Promise<void>;
}

/** SQLite alone rolls back the journal; no schema or business SQL runs here. */
export async function recoverOwnedLocalDatabase(
  databaseFilePath: string,
  authority: OwnedLocalDatabaseRecovery,
): Promise<boolean> {
  if (!isAbsolute(databaseFilePath) || databaseFilePath.includes('\0')) fail();
  const path = resolve(databaseFilePath);
  await assertOwned(authority, path);
  const databaseBefore = await readFileBinding(path);
  const journalBefore = await readFileBinding(path + '-journal');
  if (journalBefore === undefined) {
    await assertOwned(authority, path);
    return false;
  }
  if (databaseBefore === undefined || databaseBefore.size === 0n) fail();
  // A rollback journal is not authority to recover a different WAL installation.
  if (await readFileBinding(path + '-wal') !== undefined
    || await readFileBinding(path + '-shm') !== undefined) fail();
  const parentBefore = await readDirectoryBinding(dirname(path));
  await assertOwned(authority, path);
  assertSameFile(databaseBefore, await readFileBinding(path), true);
  assertSameFile(journalBefore, await readFileBinding(path + '-journal'), true);
  assertSameFile(parentBefore, await readDirectoryBinding(dirname(path)), false);
  throwIfCancelled(authority);

  let database: Database.Database | undefined;
  let failure: unknown;
  try {
    database = new Database(path, { fileMustExist: true, timeout: 0 });
    database.pragma('trusted_schema = OFF');
    database.pragma('query_only = ON');
    database.pragma('main.schema_version', { simple: true });
  } catch (error) { failure = error; }
  try { database?.close(); }
  catch (error) {
    failure = failure === undefined ? error : new AggregateError(
      [failure, error], 'LOCAL_DATABASE_RECOVERY_FAILED', { cause: failure },
    );
  }
  if (failure !== undefined) {
    throw new Error('LOCAL_DATABASE_RECOVERY_FAILED', { cause: failure });
  }
  assertSameFile(databaseBefore, await readFileBinding(path), false);
  assertSameFile(parentBefore, await readDirectoryBinding(dirname(path)), false);
  await assertOwned(authority, path);
  return true;
}

async function assertOwned(authority: OwnedLocalDatabaseRecovery, path: string): Promise<void> {
  throwIfCancelled(authority);
  await authority.assertOwnedDatabase(path);
  throwIfCancelled(authority);
}

function throwIfCancelled(authority: OwnedLocalDatabaseRecovery): void {
  if (authority.signal.aborted) fail();
}

async function readFileBinding(path: string): Promise<BigIntStats | undefined> {
  let metadata: BigIntStats;
  try { metadata = await lstat(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n
    || metadata.ino <= 0n || !pathsEqual(path, await realpath(path))) fail();
  return metadata;
}

async function readDirectoryBinding(path: string): Promise<BigIntStats> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino <= 0n
    || !pathsEqual(path, await realpath(path))) fail();
  return metadata;
}

function assertSameFile(before: BigIntStats, after: BigIntStats | undefined, compareContent: boolean): void {
  if (after === undefined || before.dev !== after.dev || before.ino !== after.ino
    || (compareContent && (before.size !== after.size || before.mtimeNs !== after.mtimeNs))) fail();
}

function pathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function fail(): never { throw new Error('LOCAL_DATABASE_RECOVERY_FAILED'); }
