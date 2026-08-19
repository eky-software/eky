import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type CrashSafeFileSlot = 'current' | 'next' | 'backup';
export type CrashSafeFileSlotFailure = 'invalid' | 'unavailable';

export class CrashSafeFileSlotError extends Error {
  constructor(readonly failure: CrashSafeFileSlotFailure) {
    super(
      failure === 'invalid'
        ? 'CRASH_SAFE_FILE_SLOT_INVALID'
        : 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE',
    );
    this.name = 'CrashSafeFileSlotError';
  }
}

export interface CrashSafeFileSlotPaths {
  readonly directoryPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
  readonly backupPath: string;
}

export interface CrashSafeFileSlotNextWriter {
  write(bytes: Uint8Array): Promise<number>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface CrashSafeFileSlotFileSystem {
  prepareDirectory(): Promise<void>;
  readSlot(slot: CrashSafeFileSlot): Promise<Uint8Array | undefined>;
  createNextWriter(): Promise<CrashSafeFileSlotNextWriter>;
  moveSlot(
    source: CrashSafeFileSlot,
    destination: CrashSafeFileSlot,
  ): Promise<void>;
  removeSlot(slot: CrashSafeFileSlot): Promise<boolean>;
  syncDirectory(): Promise<void>;
}

export function createNodeCrashSafeFileSlotFileSystem(
  paths: Readonly<CrashSafeFileSlotPaths>,
  maximumBytes: number,
): CrashSafeFileSlotFileSystem {
  assertMaximumBytes(maximumBytes);
  return new NodeCrashSafeFileSlotFileSystem(paths, maximumBytes);
}

class NodeCrashSafeFileSlotFileSystem
  implements CrashSafeFileSlotFileSystem {
  constructor(
    private readonly paths: Readonly<CrashSafeFileSlotPaths>,
    private readonly maximumBytes: number,
  ) {}

  async prepareDirectory(): Promise<void> {
    try {
      await assertRealDirectory(dirname(this.paths.directoryPath), false);
      try {
        await mkdir(this.paths.directoryPath, { mode: 0o700 });
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      }
      if (process.platform !== 'win32') {
        await chmod(this.paths.directoryPath, 0o700);
      }
      await assertRealDirectory(this.paths.directoryPath, true);
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async readSlot(
    slot: CrashSafeFileSlot,
  ): Promise<Uint8Array | undefined> {
    const path = this.pathFor(slot);
    try {
      if (!(await directoryExists(this.paths.directoryPath))) return undefined;
      await assertRealDirectory(this.paths.directoryPath, true);
      const before = await lstat(path);
      assertSafeRegularFile(before, this.maximumBytes, true);
      if (!pathsAreEqual(await realpath(path), path)) {
        throw new CrashSafeFileSlotError('invalid');
      }
      const file = await open(path, 'r');
      try {
        const opened = await file.stat();
        assertSafeRegularFile(opened, this.maximumBytes, true);
        if (!sameOpenedFile(before, opened)) {
          throw new CrashSafeFileSlotError('invalid');
        }
        const bytes = new Uint8Array(opened.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await file.read(
            bytes,
            offset,
            bytes.byteLength - offset,
            offset,
          );
          if (result.bytesRead < 1) {
            throw new CrashSafeFileSlotError('invalid');
          }
          offset += result.bytesRead;
        }
        if (
          (await file.read(new Uint8Array(1), 0, 1, bytes.byteLength))
            .bytesRead !== 0
        ) {
          throw new CrashSafeFileSlotError('invalid');
        }
        const after = await file.stat();
        if (!sameOpenedFile(opened, after) || after.size !== bytes.byteLength) {
          throw new CrashSafeFileSlotError('invalid');
        }
        return bytes;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined;
      throw mapFileSystemError(error, 'invalid');
    }
  }

  async createNextWriter(): Promise<CrashSafeFileSlotNextWriter> {
    try {
      await assertRealDirectory(this.paths.directoryPath, true);
      const file = await open(this.paths.nextPath, 'wx', 0o600);
      if (process.platform !== 'win32') await chmod(this.paths.nextPath, 0o600);
      return new NodeCrashSafeFileSlotNextWriter(file);
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async moveSlot(
    source: CrashSafeFileSlot,
    destination: CrashSafeFileSlot,
  ): Promise<void> {
    const sourcePath = this.pathFor(source);
    const destinationPath = this.pathFor(destination);
    try {
      await assertRealDirectory(this.paths.directoryPath, true);
      await assertSafeSlotForMutation(sourcePath, this.maximumBytes);
      if (await pathExists(destinationPath)) {
        throw new CrashSafeFileSlotError('unavailable');
      }
      await rename(sourcePath, destinationPath);
      await assertSafeSlotForMutation(destinationPath, this.maximumBytes);
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async removeSlot(slot: CrashSafeFileSlot): Promise<boolean> {
    const path = this.pathFor(slot);
    try {
      if (!(await directoryExists(this.paths.directoryPath))) return false;
      await assertRealDirectory(this.paths.directoryPath, true);
      if (!(await pathExists(path))) return false;
      await assertSafeSlotForMutation(path, this.maximumBytes);
      await rm(path);
      return true;
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    try {
      await assertRealDirectory(this.paths.directoryPath, true);
      const directory = await open(this.paths.directoryPath, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  private pathFor(slot: CrashSafeFileSlot): string {
    if (slot === 'current') return this.paths.currentPath;
    if (slot === 'next') return this.paths.nextPath;
    return this.paths.backupPath;
  }
}

class NodeCrashSafeFileSlotNextWriter
  implements CrashSafeFileSlotNextWriter {
  private closed = false;

  constructor(private readonly file: FileHandle) {}

  async write(bytes: Uint8Array): Promise<number> {
    this.assertOpen();
    try {
      return (await this.file.write(bytes, 0, bytes.byteLength, 0)).bytesWritten;
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async sync(): Promise<void> {
    this.assertOpen();
    try {
      await this.file.sync();
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.file.close();
    } catch (error) {
      throw mapFileSystemError(error, 'unavailable');
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new CrashSafeFileSlotError('unavailable');
  }
}

async function assertSafeSlotForMutation(
  path: string,
  maximumBytes: number,
): Promise<void> {
  const metadata = await lstat(path);
  assertSafeRegularFile(metadata, maximumBytes, false);
  if (!pathsAreEqual(await realpath(path), path)) {
    throw new CrashSafeFileSlotError('invalid');
  }
}

function assertSafeRegularFile(
  metadata: Awaited<ReturnType<typeof lstat>>,
  maximumBytes: number,
  enforceByteLimit: boolean,
): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (enforceByteLimit &&
      (metadata.size < 1 || metadata.size > maximumBytes))
  ) {
    throw new CrashSafeFileSlotError('invalid');
  }
}

async function assertRealDirectory(
  path: string,
  requirePrivateMode: boolean,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (requirePrivateMode &&
      process.platform !== 'win32' &&
      (metadata.mode & 0o077) !== 0) ||
    !pathsAreEqual(await realpath(path), path)
  ) {
    throw new CrashSafeFileSlotError('invalid');
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new CrashSafeFileSlotError('invalid');
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function sameOpenedFile(
  first: Awaited<ReturnType<FileHandle['stat']>>,
  second: Awaited<ReturnType<FileHandle['stat']>>,
): boolean {
  const identityMatches =
    first.ino === 0 ||
    second.ino === 0 ||
    (first.dev === second.dev && first.ino === second.ino);
  return (
    identityMatches &&
    first.size === second.size &&
    first.nlink === second.nlink &&
    second.nlink === 1
  );
}

function assertMaximumBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CrashSafeFileSlotError('unavailable');
  }
}

function mapFileSystemError(
  error: unknown,
  fallback: CrashSafeFileSlotFailure,
): CrashSafeFileSlotError {
  return error instanceof CrashSafeFileSlotError
    ? error
    : new CrashSafeFileSlotError(fallback);
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
