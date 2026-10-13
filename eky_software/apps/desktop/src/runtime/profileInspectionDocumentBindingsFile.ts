import { createHash } from 'node:crypto';
import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  decodeProfileInspectionDocumentBindings, encodeProfileInspectionDocumentBindings,
  profileInspectionDocumentBindingsFileName, profileInspectionMaximumCatalogBytes,
  type ProfileInspectionDocumentBinding, type ProfileInspectionDocumentSummary,
} from './profileInspectionDocumentBindings.js';

interface FileReceipt { readonly byteSize: number; readonly sha256: string }

export async function writeProfileInspectionDocumentBindings(
  root: string, documents: readonly ProfileInspectionDocumentBinding[], signal: AbortSignal,
): Promise<FileReceipt> {
  const bytes = encodeProfileInspectionDocumentBindings(documents);
  const before = await inspectRoot(root);
  assertCurrent(signal);
  // Only the generation-owned inspection root and this fixed exclusive leaf.
  await fileSystem.writeFile(join(root, profileInspectionDocumentBindingsFileName), bytes, { flag: 'wx', mode: 0o600, signal });
  assertCurrent(signal);
  assertRootIdentity(before, await inspectRoot(root));
  return Object.freeze({ byteSize: bytes.length, sha256: hash(bytes) });
}

/** Caller invokes this only after the utility port has proved exit and reclaim. */
export async function readProfileInspectionDocumentBindings(
  root: string, receipt: FileReceipt & ProfileInspectionDocumentSummary, signal: AbortSignal,
): Promise<readonly ProfileInspectionDocumentBinding[]> {
  const rootBefore = await inspectRoot(root);
  const path = join(root, profileInspectionDocumentBindingsFileName);
  assertCurrent(signal);
  const before = await fileSystem.lstat(path, { bigint: true });
  assertFile(before, receipt.byteSize);
  if (!samePath(await fileSystem.realpath(path), path)) throw invalid();
  const handle = await fileSystem.open(path, 'r');
  let firstFailure: unknown;
  try {
    assertIdentity(before, await handle.stat({ bigint: true }));
    const bytes = Buffer.alloc(receipt.byteSize);
    let position = 0;
    while (position < bytes.length) {
      assertCurrent(signal);
      const { bytesRead } = await handle.read(bytes, position, Math.min(64 * 1024, bytes.length - position), position);
      assertCurrent(signal);
      if (bytesRead === 0) throw invalid();
      position += bytesRead;
    }
    const after = await fileSystem.lstat(path, { bigint: true });
    assertFile(after, receipt.byteSize);
    assertIdentity(before, after);
    assertIdentity(before, await handle.stat({ bigint: true }));
    if (!samePath(await fileSystem.realpath(path), path) || hash(bytes) !== receipt.sha256) throw invalid();
    assertRootIdentity(rootBefore, await inspectRoot(root));
    assertCurrent(signal);
    return decodeProfileInspectionDocumentBindings(bytes, receipt);
  } catch (error) { firstFailure = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (error) { throw new AggregateError([...(firstFailure === undefined ? [] : [firstFailure]), error], 'PROFILE_INSPECTION_FILE_CLOSE_FAILED'); }
  }
}

async function inspectRoot(root: string): Promise<BigIntStats> {
  if (!isAbsolute(root) || !samePath(resolve(root), root)) throw invalid();
  const before = await fileSystem.lstat(root, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || before.ino <= 0n ||
      (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n) ||
      !samePath(await fileSystem.realpath(root), root)) throw invalid();
  assertRootIdentity(before, await fileSystem.lstat(root, { bigint: true }));
  return before;
}

function assertFile(value: BigIntStats, byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > profileInspectionMaximumCatalogBytes ||
      !value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.ino <= 0n || value.size !== BigInt(byteSize)) throw invalid();
}
function assertRootIdentity(first: BigIntStats, second: BigIntStats): void {
  if (!second.isDirectory() || second.isSymbolicLink() || first.dev !== second.dev || first.ino !== second.ino) throw invalid();
}
function assertIdentity(first: BigIntStats, second: BigIntStats): void {
  if (!second.isFile() || second.isSymbolicLink() || second.nlink !== 1n || first.dev !== second.dev || first.ino !== second.ino ||
      first.size !== second.size || first.mtimeNs !== second.mtimeNs || first.ctimeNs !== second.ctimeNs) throw invalid();
}
function samePath(first: string, second: string): boolean { return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second; }
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function assertCurrent(signal: AbortSignal): void { if (signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT'); }
function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }
