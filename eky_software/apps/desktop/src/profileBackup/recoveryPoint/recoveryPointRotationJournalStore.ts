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

const journalFileName = 'recovery-rotation-journal-v1.json';
const journalFormatVersion = 1;
const maximumJournalBytes = 256 * 1024;
const maximumArtifactCount = 1_000;
const artifactIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecoveryPointRotationJournal {
  formatVersion: 1;
  pendingArtifactIds: readonly string[];
  revision: number;
}

export class RecoveryPointRotationJournalStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !== journalFileName
    ) {
      throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async clear(): Promise<void> {
    const removals = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (removals.some(({ status }) => status === 'rejected')) {
      throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
    }
  }

  async read(): Promise<RecoveryPointRotationJournal | undefined> {
    const current = await readJournal(this.filePath);
    if (current !== undefined) {
      await this.removeRecoveryFiles();
      return current;
    }
    const backup = await readJournal(this.backupPath);
    if (backup !== undefined) {
      await rename(this.backupPath, this.filePath).catch(() => {
        throw new Error(
          'RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE',
        );
      });
      await rm(this.nextPath, { force: true }).catch(() => undefined);
      return backup;
    }
    const next = await readJournal(this.nextPath);
    if (next !== undefined) {
      await rename(this.nextPath, this.filePath).catch(() => {
        throw new Error(
          'RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE',
        );
      });
      return next;
    }
    return undefined;
  }

  async write(journal: RecoveryPointRotationJournal): Promise<void> {
    validateJournal(journal);
    const directoryPath = dirname(this.filePath);
    let previousMoved = false;
    try {
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertPrivateDirectory(directoryPath);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const file = await open(this.nextPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(journal)}\n`, 'utf8');
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
      throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
    } finally {
      await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async removeRecoveryFiles(): Promise<void> {
    const removals = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (removals.some(({ status }) => status === 'rejected')) {
      throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
    }
  }
}

async function readJournal(
  path: string,
): Promise<RecoveryPointRotationJournal | undefined> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumJournalBytes
    ) {
      throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_INVALID');
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    validateJournal(value);
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_INVALID');
  }
}

function validateJournal(
  value: unknown,
): asserts value is RecoveryPointRotationJournal {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'formatVersion',
      'pendingArtifactIds',
      'revision',
    ]) ||
    value.formatVersion !== journalFormatVersion ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.pendingArtifactIds) ||
    value.pendingArtifactIds.length < 1 ||
    value.pendingArtifactIds.length > maximumArtifactCount ||
    value.pendingArtifactIds.some(
      (id) => typeof id !== 'string' || !artifactIdPattern.test(id),
    ) ||
    new Set(value.pendingArtifactIds).size !==
      value.pendingArtifactIds.length
  ) {
    throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_INVALID');
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
  }
  if (!pathsAreEqual(await realpath(path), path)) {
    throw new Error('RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE');
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

export const recoveryPointRotationJournalFileName =
  journalFileName;
