import fs, { type BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type ElectronGenerationReadFailure = Readonly<{
  status: 'missing' | 'invalid' | 'tooLarge' | 'sourceChanged' | 'readFailed';
}>;

// Shared by the two fixed, generation-specific Electron evidence readers.
export function readElectronGenerationFile<T>(input: {
  runRoot: string; artifactsRoot: string; path: string; maximumBytes: number;
  parse(text: string): T;
}): T | ElectronGenerationReadFailure {
  let descriptor: number | undefined;
  try {
    if (dirname(input.path) !== input.artifactsRoot || !Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1) {
      return { status: 'invalid' };
    }
    const directories = captureDirectories(input.runRoot, input.artifactsRoot);
    const unchangedDirectories = () => directories.every(({ path, metadata }) => sameIdentity(metadata, safeDirectory(path)));
    const before = fs.lstatSync(input.path, { bigint: true });
    assertSafeFile(before);
    descriptor = fs.openSync(input.path, fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    assertSafeFile(opened);
    if (!sameIdentity(before, opened) || !unchangedDirectories()) return { status: 'invalid' };
    if (opened.size > BigInt(input.maximumBytes)) return { status: 'tooLarge' };
    const buffer = Buffer.alloc(Number(opened.size));
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(input.path, { bigint: true });
    assertSafeFile(after);
    assertSafeFile(current);
    if (!sameIdentity(opened, after) || !sameIdentity(opened, current) || !unchangedDirectories()) return { status: 'invalid' };
    if (bytes !== buffer.length || !sameContents(before, opened) ||
      !sameContents(opened, after) || !sameContents(after, current)) return { status: 'sourceChanged' };
    return input.parse(buffer.toString('utf8'));
  } catch (error) {
    return Object.freeze({ status: error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? 'missing' : error instanceof UnsafeObservation ? 'invalid' : 'readFailed' });
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Diagnostic failure cannot replace the original failure. */ }
    }
  }
}

class UnsafeObservation extends Error {}

function captureDirectories(runRoot: string, artifactsRoot: string) {
  const comparable = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  for (const path of [runRoot, artifactsRoot]) {
    if (!isAbsolute(path) || path.includes('\0') || comparable(resolve(path)) !== comparable(path)) throw new UnsafeObservation();
  }
  const base = join(fs.realpathSync.native(tmpdir()), 'eky-e2e');
  if (comparable(dirname(runRoot)) !== comparable(base) || !/^run-[A-Za-z0-9_-]+$/u.test(basename(runRoot))) throw new UnsafeObservation();
  const child = relative(runRoot, artifactsRoot);
  if (child === '' || isAbsolute(child) || child.split(sep).includes('..')) throw new UnsafeObservation();
  const paths = [base, runRoot];
  for (const part of child.split(sep)) paths.push(join(paths[paths.length - 1]!, part));
  return paths.map((path) => ({ path, metadata: safeDirectory(path) }));
}

function safeDirectory(path: string): BigIntStats {
  const metadata = fs.lstatSync(path, { bigint: true });
  const canonical = fs.realpathSync.native(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path)) throw new UnsafeObservation();
  return metadata;
}

function assertSafeFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.size < 0n) throw new UnsafeObservation();
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function sameContents(left: BigIntStats, right: BigIntStats): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
