import { createHash } from 'node:crypto';
import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { resolve } from 'node:path';

import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { backupStreamChunkBytes, maximumBackupContainerBytes } from './container/backupContainerLimits.js';
import { createDeletionBackupExportIdentity, type ExportIdentity } from './deletionBackupReceipt.js';

/** Rechecks the exported bytes without decrypting them or retaining a password. */
export async function readDeletionBackupExportIdentity(
  containerPath: string,
  assertCurrent: () => void,
): Promise<Readonly<ExportIdentity>> {
  const guard = () => assertUpdateJournalAuthority(assertCurrent);
  const assertPath = async () => {
    guard();
    const actual = resolve(await fileSystem.realpath(containerPath));
    guard();
    const expected = resolve(containerPath);
    if ((process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) {
      throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
    }
  };
  guard();
  const selected = await fileSystem.lstat(containerPath, { bigint: true });
  guard();
  assertSameIdentity(selected, selected);
  await assertPath();
  guard();
  const file = await fileSystem.open(containerPath, 'r');
  let firstFailure: { error: unknown } | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  let result: Readonly<ExportIdentity> | undefined;
  try {
    guard();
    const opened = await file.stat({ bigint: true });
    guard();
    assertSameIdentity(selected, opened);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(backupStreamChunkBytes);
    const size = Number(opened.size);
    let position = 0;
    while (position < size) {
      guard();
      const { bytesRead } = await file.read({ buffer, offset: 0,
        length: Math.min(buffer.byteLength, size - position), position });
      guard();
      if (bytesRead === 0) throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    assertSameIdentity(opened, await file.stat({ bigint: true }));
    guard();
    assertSameIdentity(opened, await fileSystem.lstat(containerPath, { bigint: true }));
    guard();
    await assertPath();
    guard();
    result = createDeletionBackupExportIdentity(opened, hash.digest('hex'));
  } catch (error) { firstFailure = { error }; }
  try { await file.close(); }
  catch (error) { cleanupFailure = { error }; }
  if (firstFailure !== undefined) {
    if (cleanupFailure !== undefined) {
      throw new AggregateError([firstFailure.error, cleanupFailure.error],
        'WORKSPACE_DELETE_BACKUP_UNAVAILABLE', { cause: firstFailure.error });
    }
    throw firstFailure.error;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
  guard();
  // A replacement during close cannot inherit the authenticated identity.
  assertSameIdentity(selected, await fileSystem.lstat(containerPath, { bigint: true }));
  guard();
  await assertPath();
  guard();
  if (result === undefined) throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  return result;
}

function assertSameIdentity(expected: BigIntStats, actual: BigIntStats): void {
  if (!actual.isFile() || actual.isSymbolicLink() || actual.size <= 0n || actual.size > maximumBackupContainerBytes ||
      expected.dev !== actual.dev || expected.ino !== actual.ino || expected.size !== actual.size ||
      expected.mtimeNs !== actual.mtimeNs || expected.ctimeNs !== actual.ctimeNs) {
    throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  }
}
