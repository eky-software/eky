import { createHash } from 'node:crypto';
import { promises as fileSystem, type BigIntStats } from 'node:fs';

export interface ProfileInspectionFileBinding {
  readonly identity: string;
  readonly byteSize: number;
  readonly sha256: string;
}

/** The opened handle and the selected path must still identify the same bytes. */
export async function bindProfileInspectionFile(
  path: string,
  maximumBytes: number,
  signal: AbortSignal,
  prefix?: Buffer,
): Promise<ProfileInspectionFileBinding> {
  assertNotCancelled(signal);
  const before = await fileSystem.lstat(path, { bigint: true });
  assertRegularFile(before, maximumBytes);
  if (!sameProfileInspectionPath(await fileSystem.realpath(path), path)) throw invalid();
  const handle = await fileSystem.open(path, 'r');
  let failure: unknown;
  try {
    const opened = await handle.stat({ bigint: true });
    assertRegularFile(opened, maximumBytes);
    if (fileIdentity(before) !== fileIdentity(opened)) throw invalid();
    const hash = createHash('sha256');
    let bytes = 0;
    let signature = Buffer.alloc(0);
    const buffer = Buffer.alloc(64 * 1024);
    // Explicit positioned reads keep ownership of the handle through final fstat.
    while (true) {
      assertNotCancelled(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes);
      assertNotCancelled(signal);
      if (bytesRead === 0) break;
      const content = buffer.subarray(0, bytesRead);
      if (prefix !== undefined && signature.length < prefix.length) {
        signature = Buffer.concat([signature, content.subarray(0, prefix.length - signature.length)]);
      }
      bytes += bytesRead;
      if (bytes > maximumBytes || bytes > Number(before.size)) throw invalid();
      hash.update(content);
    }
    assertNotCancelled(signal);
    const [after, finalHandle] = await Promise.all([
      fileSystem.lstat(path, { bigint: true }), handle.stat({ bigint: true }),
    ]);
    assertRegularFile(after, maximumBytes);
    assertRegularFile(finalHandle, maximumBytes);
    if (fileIdentity(before) !== fileIdentity(after) || fileIdentity(before) !== fileIdentity(finalHandle) ||
        bytes !== Number(before.size) || !sameProfileInspectionPath(await fileSystem.realpath(path), path) ||
        (prefix !== undefined && !signature.equals(prefix))) throw invalid();
    return Object.freeze({ identity: fileIdentity(before), byteSize: bytes, sha256: hash.digest('hex') });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { await handle.close(); }
    catch (error) {
      throw new AggregateError([...(failure === undefined ? [] : [failure]), error],
        'PROFILE_INSPECTION_FILE_CLOSE_FAILED');
    }
  }
}

export async function inspectProfileInspectionRoot(path: string): Promise<string> {
  const before = await fileSystem.lstat(path, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || before.ino <= 0n ||
      (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n) ||
      !sameProfileInspectionPath(await fileSystem.realpath(path), path)) throw invalid();
  const after = await fileSystem.lstat(path, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) throw invalid();
  return `${before.dev}:${before.ino}`;
}

export function sameProfileInspectionBinding(
  first: ProfileInspectionFileBinding,
  second: ProfileInspectionFileBinding,
): boolean {
  return first.identity === second.identity && first.byteSize === second.byteSize && first.sha256 === second.sha256;
}

export function sameProfileInspectionPath(first: string, second: string): boolean {
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function fileIdentity(metadata: BigIntStats): string {
  return `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeNs}`;
}

function assertRegularFile(metadata: BigIntStats, maximumBytes: number): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.ino <= 0n ||
      metadata.size < 1n || metadata.size > BigInt(maximumBytes)) throw invalid();
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
}

function invalid(): Error { return new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED'); }
