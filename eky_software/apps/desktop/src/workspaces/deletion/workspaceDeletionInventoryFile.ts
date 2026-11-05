import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';
const fileIdentityNamespace = 'eky-workspace-deletion-inventory-file-v1';

export interface WorkspaceDeletionInventoryFile {
  stat(): Promise<BigIntStats>;
  read(bytes: Buffer, position: number): Promise<number>;
  write(bytes: Uint8Array, position: number): Promise<number>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export type OpenWorkspaceDeletionInventoryFile = (
  path: string, mode: 'r' | 'wx',
) => Promise<WorkspaceDeletionInventoryFile>;

export const openWorkspaceDeletionInventoryFile: OpenWorkspaceDeletionInventoryFile = async (path, mode) => {
  const file = await open(path, mode, 0o600);
  return {
    stat: () => file.stat({ bigint: true }),
    read: async (bytes, position) => (await file.read(bytes, 0, bytes.byteLength, position)).bytesRead,
    write: async (bytes, position) => (await file.write(bytes, 0, bytes.byteLength, position)).bytesWritten,
    sync: () => file.sync(), close: () => file.close(),
  };
};

export function deletionInventoryPathsEqual(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function readDeletionInventoryDirectoryIdentity(path: string, assertCurrent: () => void): Promise<string> {
  assertCurrent();
  const metadata = await lstat(path, { bigint: true });
  assertCurrent();
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)) return invalidDeletionData(invalidCode);
  const identity = await readWorkspaceProcessReservationIdentity(path);
  assertCurrent();
  const after = await lstat(path, { bigint: true });
  assertCurrent();
  if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== metadata.dev || after.ino !== metadata.ino ||
      (process.platform !== 'win32' && (after.mode & 0o077n) !== 0n)) return invalidDeletionData(invalidCode);
  return identity;
}

export interface WorkspaceDeletionInventoryDirectoryReads {
  identity(path: string, assertCurrent: () => void): Promise<string>;
  names(path: string): Promise<string[]>;
}

export const workspaceDeletionInventoryDirectoryReads: WorkspaceDeletionInventoryDirectoryReads = Object.freeze({
  identity: readDeletionInventoryDirectoryIdentity,
  names: (path: string) => readdir(path),
});

export function assertDeletionInventoryFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.dev < 0n ||
      metadata.ino <= 0n || metadata.size < 0n || metadata.size > BigInt(Number.MAX_SAFE_INTEGER) ||
      (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)) invalidDeletionData(invalidCode);
}

export function deletionInventoryFileIdentity(metadata: BigIntStats): string {
  assertDeletionInventoryFile(metadata);
  return deletionPayloadFileIdentity(metadata);
}

// Stable regular-file encoding only. The caller separately enforces its owner's mode/content rules.
export function deletionPayloadFileIdentity(metadata: BigIntStats): string {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.dev < 0n || metadata.ino <= 0n) {
    return invalidDeletionData(invalidCode);
  }
  return createHash('sha256').update(`${fileIdentityNamespace}:${metadata.dev}:${metadata.ino}`).digest('hex');
}

export function sameDeletionInventoryFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export async function inspectDeletionInventoryFile(path: string, assertCurrent: () => void): Promise<BigIntStats> {
  assertCurrent();
  const before = await lstat(path, { bigint: true });
  assertCurrent();
  assertDeletionInventoryFile(before);
  const canonical = await realpath(path);
  assertCurrent();
  if (!deletionInventoryPathsEqual(canonical, resolve(path))) return invalidDeletionData(invalidCode);
  const after = await lstat(path, { bigint: true });
  assertCurrent();
  assertDeletionInventoryFile(after);
  if (!sameDeletionInventoryFile(before, after)) return invalidDeletionData(invalidCode);
  return after;
}

// A failed read/write still joins close; a later close failure must not replace the first cause.
export async function withDeletionInventoryFile<T>(
  file: WorkspaceDeletionInventoryFile, work: () => Promise<T>, onFailure?: (error: unknown) => void,
): Promise<T> {
  let failure: unknown;
  let failed = false;
  let result!: T;
  try { result = await work(); } catch (error) { failed = true; failure = error; notifyReadFailure(onFailure, error); }
  try { await file.close(); }
  catch (error) {
    notifyReadFailure(onFailure, error);
    if (failed) throw new AggregateError([failure, error], invalidCode);
    throw error;
  }
  if (failed) throw failure;
  return result;
}

function notifyReadFailure(callback: ((error: unknown) => void) | undefined, error: unknown): void {
  try { callback?.(error); } catch { /* Preserve the original failure. */ }
}
