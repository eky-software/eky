import { createHash } from 'node:crypto';
import { constants, promises as fileSystem, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  resolveAbsoluteWorkspaceCandidatePath,
  validatePrivateWorkspaceDirectory,
  workspaceCandidatePathsAreEqual,
} from './workspaceCandidatePathPolicy.js';

export interface CopiedWorkspaceDatabaseReceipt {
  readonly byteSize: number;
  readonly sha256: string;
  readonly identity: Readonly<Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>>;
}

// Byte transport only. SQLite admission uses a separately owned disposable copy.
export async function copyAttestedWorkspaceDatabase(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly expectedBytes?: Readonly<Pick<CopiedWorkspaceDatabaseReceipt, 'byteSize' | 'sha256'>>;
  readonly signal?: AbortSignal;
}): Promise<Readonly<CopiedWorkspaceDatabaseReceipt>> {
  const handles: FileHandle[] = [];
  let failure: unknown;
  try {
    throwIfCancelled(input.signal);
    const sourceMetadata = await inspectFile(input.sourcePath);
    await assertNoSidecars(input.sourcePath);
    await assertNoSidecars(input.destinationPath);
    const source = await fileSystem.open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    handles.push(source);
    assertSameFile(sourceMetadata, await source.stat());
    const expected = await hashFile(source, sourceMetadata.size, input.signal);
    if (input.expectedBytes !== undefined &&
        (sourceMetadata.size !== input.expectedBytes.byteSize || expected !== input.expectedBytes.sha256)) {
      throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    }
    assertSameFile(sourceMetadata, await inspectFile(input.sourcePath));
    await assertNoSidecars(input.sourcePath);
    throwIfCancelled(input.signal);

    const destinationParent = dirname(input.destinationPath);
    await fileSystem.mkdir(destinationParent, { mode: 0o700, recursive: true });
    if (process.platform !== 'win32') await fileSystem.chmod(destinationParent, 0o700);
    await validatePrivateWorkspaceDirectory(destinationParent);
    const destination = await fileSystem.open(
      input.destinationPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600,
    );
    handles.push(destination);
    const copiedHash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < sourceMetadata.size) {
      throwIfCancelled(input.signal);
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, sourceMetadata.size - position), position);
      if (bytesRead === 0) throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
      let written = 0;
      while (written < bytesRead) {
        throwIfCancelled(input.signal);
        const { bytesWritten } = await destination.write(buffer, written, bytesRead - written, position + written);
        if (bytesWritten < 1) throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
        written += bytesWritten;
      }
      copiedHash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (copiedHash.digest('hex') !== expected) throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    assertSameFile(sourceMetadata, await source.stat());
    assertSameFile(sourceMetadata, await inspectFile(input.sourcePath));
    await assertNoSidecars(input.sourcePath);
    await destination.sync();
    const destinationMetadata = await destination.stat();
    if (destinationMetadata.size !== sourceMetadata.size ||
        await hashFile(destination, sourceMetadata.size, input.signal) !== expected) {
      throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    }
    assertSameFile(destinationMetadata, await inspectFile(input.destinationPath));
    await assertNoSidecars(input.destinationPath);
    throwIfCancelled(input.signal);
    return Object.freeze({ byteSize: sourceMetadata.size, sha256: expected, identity: fileIdentity(destinationMetadata) });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const results = await Promise.allSettled(handles.map(handle => handle.close()));
    const closeErrors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (closeErrors.length > 0) {
      throw new AggregateError([...(failure === undefined ? [] : [failure]), ...closeErrors], 'WORKSPACE_CANDIDATE_DATABASE_CLOSE_FAILED');
    }
    // Retain failed copies. Only main can prove child exit and cleanup ownership.
  }
}

export async function assertCopiedWorkspaceDatabaseUnchanged(
  path: string,
  receipt: Readonly<CopiedWorkspaceDatabaseReceipt>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal);
  assertSameFile(receipt.identity, await inspectFile(path));
  await assertNoSidecars(path);
  const file = await fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assertSameFile(receipt.identity, await file.stat());
    if (await hashFile(file, receipt.byteSize, signal) !== receipt.sha256) {
      throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    }
    assertSameFile(receipt.identity, await file.stat());
    assertSameFile(receipt.identity, await inspectFile(path));
    await assertNoSidecars(path);
    throwIfCancelled(signal);
  } finally { await file.close(); }
}

async function inspectFile(path: string): Promise<Stats> {
  resolveAbsoluteWorkspaceCandidatePath(path);
  const metadata = await fileSystem.lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      !Number.isSafeInteger(metadata.size) || metadata.size < 1 ||
      !workspaceCandidatePathsAreEqual(await fileSystem.realpath(path), path)) {
    throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
  }
  return metadata;
}

async function assertNoSidecars(path: string): Promise<void> {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { await fileSystem.lstat(path + suffix); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('WORKSPACE_CANDIDATE_DATABASE_INVALID');
  }
}

async function hashFile(file: FileHandle, expectedSize: number, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    throwIfCancelled(signal);
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, expectedSize - position + 1), position);
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > expectedSize) throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
    hash.update(buffer.subarray(0, bytesRead));
  }
  if (position !== expectedSize) throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
  return hash.digest('hex');
}

function fileIdentity(metadata: Stats): CopiedWorkspaceDatabaseReceipt['identity'] {
  return Object.freeze({ dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs });
}

function assertSameFile(expected: CopiedWorkspaceDatabaseReceipt['identity'], actual: Stats): void {
  if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== expected.dev || actual.ino !== expected.ino ||
      actual.size !== expected.size || actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs) {
    throw new Error('WORKSPACE_CANDIDATE_DATABASE_CHANGED');
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
}
