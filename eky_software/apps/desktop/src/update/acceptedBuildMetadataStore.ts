import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { parseAcceptedBuildMetadata, type AcceptedBuildMetadata } from './acceptedBuildMetadata.js';

export const acceptedBuildMetadataFileName = 'accepted-build-v1.json';
const maximumBytes = 4 * 1024;

export class AcceptedBuildMetadataStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (!isAbsolute(filePath) || filePath.includes('\0') ||
      basename(filePath) !== acceptedBuildMetadataFileName) {
      throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async read(): Promise<Readonly<AcceptedBuildMetadata> | undefined> {
    const current = await readMetadata(this.filePath);
    if (current !== undefined) {
      await this.removeRecoverySlots();
      return current;
    }
    const backup = await readMetadata(this.backupPath);
    if (backup !== undefined) {
      await rename(this.backupPath, this.filePath);
      await rm(this.nextPath, { force: true });
      await syncDirectory(dirname(this.filePath));
      return backup;
    }
    const next = await readMetadata(this.nextPath);
    if (next !== undefined) {
      await rename(this.nextPath, this.filePath);
      await syncDirectory(dirname(this.filePath));
      return next;
    }
    return undefined;
  }

  async write(metadata: Readonly<AcceptedBuildMetadata>): Promise<void> {
    const validated = parseAcceptedBuildMetadata(metadata);
    const directory = dirname(this.filePath);
    let moved = false;
    try {
      await mkdir(directory, { mode: 0o700, recursive: true });
      await chmod(directory, 0o700);
      await assertPrivateDirectory(directory);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const file = await open(this.nextPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(validated)}\n`, 'utf8');
        await file.sync();
      } finally { await file.close(); }
      try { await rename(this.filePath, this.backupPath); moved = true; }
      catch (error) { if (!isNodeError(error) || error.code !== 'ENOENT') throw error; }
      try {
        await rename(this.nextPath, this.filePath);
        await syncDirectory(directory);
      } catch (error) {
        if (moved) await rename(this.backupPath, this.filePath).catch(() => undefined);
        throw error;
      }
      if (moved) { await rm(this.backupPath, { force: true }); await syncDirectory(directory); }
    } catch { throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE'); }
    finally { await rm(this.nextPath, { force: true }).catch(() => undefined); }
  }

  async clear(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    }
    await syncDirectory(dirname(this.filePath));
  }

  private async removeRecoverySlots(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }), rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    }
  }
}

async function readMetadata(path: string): Promise<Readonly<AcceptedBuildMetadata> | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      metadata.size < 1 || metadata.size > maximumBytes) {
      throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    }
    return parseAcceptedBuildMetadata(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  const actual = resolve(await realpath(path));
  const expected = resolve(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    (process.platform === 'win32'
      ? actual.toLowerCase() !== expected.toLowerCase()
      : actual !== expected)) {
    throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
