import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const markerFileName = 'clean-shutdown-v1.json';
const markerFormatVersion = 1;
const maximumMarkerBytes = 1_024;

interface CleanShutdownMarker {
  completedAt: string;
  formatVersion: 1;
}

export class RecoveryPointCleanShutdownMarker {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !== markerFileName
    ) {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async consume(): Promise<'clean' | 'unclean'> {
    try {
      const marker =
        (await readMarker(this.filePath)) ??
        (await readMarker(this.backupPath)) ??
        (await readMarker(this.nextPath));
      await this.clear();
      return marker === undefined ? 'unclean' : 'clean';
    } catch {
      await this.clear().catch(() => undefined);
      return 'unclean';
    }
  }

  async markClean(completedAt: string): Promise<void> {
    if (!isIsoDate(completedAt)) {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_INVALID');
    }
    const directoryPath = dirname(this.filePath);
    const marker: CleanShutdownMarker = {
      completedAt,
      formatVersion: markerFormatVersion,
    };
    let previousMoved = false;

    try {
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertPrivateDirectory(directoryPath);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const file = await open(this.nextPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(marker)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await chmod(this.nextPath, 0o600);
      try {
        await rename(this.filePath, this.backupPath);
        previousMoved = true;
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      try {
        await rename(this.nextPath, this.filePath);
      } catch (error) {
        if (previousMoved) {
          await rename(this.backupPath, this.filePath).catch(
            () => undefined,
          );
        }
        throw error;
      }
      if (previousMoved) {
        await rm(this.backupPath, { force: true });
      }
    } catch {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_UNAVAILABLE');
    } finally {
      await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async clear(): Promise<void> {
    const removals = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (removals.some(({ status }) => status === 'rejected')) {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_UNAVAILABLE');
    }
  }
}

async function readMarker(
  path: string,
): Promise<CleanShutdownMarker | undefined> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumMarkerBytes
    ) {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_INVALID');
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ['completedAt', 'formatVersion']) ||
      value.formatVersion !== markerFormatVersion ||
      !isIsoDate(value.completedAt)
    ) {
      throw new Error('RECOVERY_SHUTDOWN_MARKER_INVALID');
    }
    return value as unknown as CleanShutdownMarker;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('RECOVERY_SHUTDOWN_MARKER_UNAVAILABLE');
  }
  if (!pathsAreEqual(await realpath(path), path)) {
    throw new Error('RECOVERY_SHUTDOWN_MARKER_UNAVAILABLE');
  }
}

function isIsoDate(value: unknown): value is string {
  const milliseconds =
    typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return (
    typeof value === 'string' &&
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected]
      .sort()
      .every((key, index) => actual[index] === key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export const recoveryPointCleanShutdownMarkerFileName =
  markerFileName;
