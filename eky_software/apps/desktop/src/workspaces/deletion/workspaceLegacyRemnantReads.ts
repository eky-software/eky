import type { BigIntStats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { deletionInventoryPathsEqual, deletionPayloadFileIdentity, sameDeletionInventoryFile } from './workspaceDeletionInventoryFile.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';

export type WorkspaceLegacyEntryIdentity = Readonly<{ kind: 'directory' | 'file'; identity: string }>;

// The legacy runtime is an installation parent; only its 13 named children are company payloads.
export async function readWorkspaceLegacyRuntimeIdentity(path: string, assertCurrent: () => void): Promise<string | null> {
  const result = await readIdentity(path, assertCurrent, false, true);
  return result?.identity ?? null;
}

export const readWorkspaceLegacyEntryIdentity = (path: string, assertCurrent: () => void) =>
  readIdentity(path, assertCurrent, true, false);

async function readIdentity(path: string, assertCurrent: () => void, privateDirectory: boolean, directoryOnly: boolean)
  : Promise<WorkspaceLegacyEntryIdentity | null> {
  assertCurrent();
  let before: BigIntStats;
  try { before = await lstat(path, { bigint: true }); }
  catch (error) {
    assertCurrent();
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
  assertCurrent();
  const kind = validate(before, privateDirectory, directoryOnly);
  const canonical = await realpath(path);
  assertCurrent();
  if (!deletionInventoryPathsEqual(canonical, resolve(path))) return invalidDeletionData(invalidCode);
  const after = await lstat(path, { bigint: true });
  assertCurrent();
  if (validate(after, privateDirectory, directoryOnly) !== kind || before.dev !== after.dev || before.ino !== after.ino ||
      (kind === 'file' && !sameDeletionInventoryFile(before, after))) return invalidDeletionData(invalidCode);
  return Object.freeze({ kind, identity: kind === 'directory'
    ? createWorkspaceProcessReservationIdentity(after) : deletionPayloadFileIdentity(after) });
}

function validate(metadata: BigIntStats, privateDirectory: boolean, directoryOnly: boolean) {
  if (metadata.isSymbolicLink() || metadata.dev < 0n || metadata.ino <= 0n) return invalidDeletionData(invalidCode);
  if (metadata.isDirectory()) {
    if (privateDirectory && process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n) return invalidDeletionData(invalidCode);
    return 'directory' as const;
  }
  // The existing adoption owner permits non-private regular-file modes, but never hardlinks or special files.
  if (directoryOnly || !metadata.isFile() || metadata.nlink !== 1n) return invalidDeletionData(invalidCode);
  return 'file' as const;
}
