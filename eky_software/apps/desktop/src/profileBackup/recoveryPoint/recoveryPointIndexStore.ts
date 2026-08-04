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

const indexFileName = 'recovery-points-v1.json';
const indexFormatVersion = 1;
const maximumIndexBytes = 1_048_576;
const maximumPointCount = 1_000;
const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RecoveryPointKind =
  | 'daily'
  | 'manual'
  | 'monthly'
  | 'preRestore'
  | 'preUpdate'
  | 'weekly';

export interface RecoveryPointIndexEntry {
  artifactId: string;
  byteSize: number;
  createdAt: string;
  kind: RecoveryPointKind;
  state: 'validatedGood';
  validatedAt: string;
}

export interface RecoveryPointIndex {
  formatVersion: 1;
  points: readonly RecoveryPointIndexEntry[];
  revision: number;
}

export class RecoveryPointIndexError extends Error {
  constructor(
    readonly code:
      | 'RECOVERY_POINT_INDEX_INVALID'
      | 'RECOVERY_POINT_INDEX_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'RecoveryPointIndexError';
  }
}

export class RecoveryPointIndexStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !== indexFileName
    ) {
      throw new RecoveryPointIndexError(
        'RECOVERY_POINT_INDEX_UNAVAILABLE',
      );
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async read(): Promise<RecoveryPointIndex> {
    const current = await readIndex(this.filePath);
    if (current !== null) {
      await this.removeRecoveryFiles();
      return current;
    }
    const backup = await readIndex(this.backupPath);
    if (backup !== null) {
      await rename(this.backupPath, this.filePath).catch(() => {
        throw new RecoveryPointIndexError(
          'RECOVERY_POINT_INDEX_UNAVAILABLE',
        );
      });
      await rm(this.nextPath, { force: true }).catch(() => undefined);
      return backup;
    }
    const next = await readIndex(this.nextPath);
    if (next !== null) {
      await rename(this.nextPath, this.filePath).catch(() => {
        throw new RecoveryPointIndexError(
          'RECOVERY_POINT_INDEX_UNAVAILABLE',
        );
      });
      return next;
    }
    return {
      formatVersion: indexFormatVersion,
      points: [],
      revision: 0,
    };
  }

  async write(index: RecoveryPointIndex): Promise<void> {
    validateIndex(index);
    const directoryPath = dirname(this.filePath);
    let previousMoved = false;

    try {
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertPrivateDirectory(directoryPath);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const file = await open(this.nextPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(index)}\n`, 'utf8');
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
      throw new RecoveryPointIndexError(
        'RECOVERY_POINT_INDEX_UNAVAILABLE',
      );
    } finally {
      await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async removeRecoveryFiles(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new RecoveryPointIndexError(
        'RECOVERY_POINT_INDEX_UNAVAILABLE',
      );
    }
  }
}

async function readIndex(
  path: string,
): Promise<RecoveryPointIndex | null> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumIndexBytes
    ) {
      throw new RecoveryPointIndexError(
        'RECOVERY_POINT_INDEX_INVALID',
      );
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    validateIndex(value);
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    if (error instanceof RecoveryPointIndexError) {
      throw error;
    }
    throw new RecoveryPointIndexError(
      'RECOVERY_POINT_INDEX_INVALID',
    );
  }
}

function validateIndex(
  value: unknown,
): asserts value is RecoveryPointIndex {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['formatVersion', 'points', 'revision']) ||
    value.formatVersion !== indexFormatVersion ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.points) ||
    value.points.length > maximumPointCount
  ) {
    throw new RecoveryPointIndexError(
      'RECOVERY_POINT_INDEX_INVALID',
    );
  }
  const artifactIds = new Set<string>();
  for (const point of value.points) {
    if (
      !isRecord(point) ||
      !hasExactKeys(point, [
        'artifactId',
        'byteSize',
        'createdAt',
        'kind',
        'state',
        'validatedAt',
      ]) ||
      typeof point.artifactId !== 'string' ||
      !artifactIdPattern.test(point.artifactId) ||
      artifactIds.has(point.artifactId) ||
      !Number.isSafeInteger(point.byteSize) ||
      (point.byteSize as number) < 1 ||
      !isIsoDate(point.createdAt) ||
      !isRecoveryPointKind(point.kind) ||
      point.state !== 'validatedGood' ||
      !isIsoDate(point.validatedAt)
    ) {
      throw new RecoveryPointIndexError(
        'RECOVERY_POINT_INDEX_INVALID',
      );
    }
    artifactIds.add(point.artifactId);
  }
}

function isRecoveryPointKind(
  value: unknown,
): value is RecoveryPointKind {
  return (
    value === 'daily' ||
    value === 'manual' ||
    value === 'monthly' ||
    value === 'preRestore' ||
    value === 'preUpdate' ||
    value === 'weekly'
  );
}

function isIsoDate(value: unknown): value is string {
  const milliseconds =
    typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 30 &&
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new RecoveryPointIndexError(
      'RECOVERY_POINT_INDEX_UNAVAILABLE',
    );
  }
  const real = await realpath(path);
  if (!pathsAreEqual(real, path)) {
    throw new RecoveryPointIndexError(
      'RECOVERY_POINT_INDEX_UNAVAILABLE',
    );
  }
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

export const recoveryPointIndexFileName = indexFileName;
