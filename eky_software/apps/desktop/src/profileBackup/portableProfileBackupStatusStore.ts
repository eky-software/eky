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

export const portableProfileBackupStatusFileName =
  'portable-backup-status-v1.json';

const statusFormatVersion = 1;
const maximumStatusBytes = 2_048;

export interface PortableProfileBackupSuccessRecord {
  appVersion: string;
  backupFormatVersion: 1;
  completedAt: string;
  validationStatus: 'validated';
}

interface StoredPortableProfileBackupStatus
  extends PortableProfileBackupSuccessRecord {
  formatVersion: 1;
}

export class PortableProfileBackupStatusStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !== portableProfileBackupStatusFileName
    ) {
      throw new Error('PROFILE_BACKUP_STATUS_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async read(): Promise<PortableProfileBackupSuccessRecord | undefined> {
    const current = await readStatus(this.filePath);
    if (current !== undefined) {
      await this.removeRecoverySlots();
      return current;
    }

    const backup = await readStatus(this.backupPath);
    if (backup !== undefined) {
      await rename(this.backupPath, this.filePath);
      await rm(this.nextPath, { force: true });
      return backup;
    }

    const next = await readStatus(this.nextPath);
    if (next !== undefined) {
      await rename(this.nextPath, this.filePath);
      return next;
    }

    return undefined;
  }

  async write(record: PortableProfileBackupSuccessRecord): Promise<void> {
    const status: StoredPortableProfileBackupStatus = {
      ...record,
      formatVersion: statusFormatVersion,
    };
    if (!isStoredStatus(status)) {
      throw new Error('PROFILE_BACKUP_STATUS_INVALID');
    }

    const directoryPath = dirname(this.filePath);
    let previousMoved = false;
    try {
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await chmod(directoryPath, 0o700);
      await assertPrivateDirectory(directoryPath);
      await rm(this.nextPath, { force: true });
      await rm(this.backupPath, { force: true });
      const nextFile = await open(this.nextPath, 'wx', 0o600);
      try {
        await nextFile.writeFile(`${JSON.stringify(status)}\n`, 'utf8');
        await nextFile.sync();
      } finally {
        await nextFile.close();
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
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'PROFILE_BACKUP_STATUS_INVALID'
      ) {
        throw error;
      }
      throw new Error('PROFILE_BACKUP_STATUS_UNAVAILABLE');
    } finally {
      await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async removeRecoverySlots(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('PROFILE_BACKUP_STATUS_UNAVAILABLE');
    }
  }
}

async function readStatus(
  path: string,
): Promise<PortableProfileBackupSuccessRecord | undefined> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumStatusBytes
    ) {
      throw new Error('PROFILE_BACKUP_STATUS_INVALID');
    }
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isStoredStatus(value)) {
      throw new Error('PROFILE_BACKUP_STATUS_INVALID');
    }
    const { formatVersion: _formatVersion, ...record } = value;
    return record;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error('PROFILE_BACKUP_STATUS_INVALID');
  }
}

function isStoredStatus(
  value: unknown,
): value is StoredPortableProfileBackupStatus {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    'appVersion',
    'backupFormatVersion',
    'completedAt',
    'formatVersion',
    'validationStatus',
  ].sort();
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => keys[index] === key) &&
    value.formatVersion === statusFormatVersion &&
    value.backupFormatVersion === 1 &&
    value.validationStatus === 'validated' &&
    typeof value.appVersion === 'string' &&
    value.appVersion.length >= 1 &&
    value.appVersion.length <= 100 &&
    isIsoDate(value.completedAt)
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
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
    throw new Error('PROFILE_BACKUP_STATUS_UNAVAILABLE');
  }
  if (!pathsAreEqual(await realpath(path), path)) {
    throw new Error('PROFILE_BACKUP_STATUS_UNAVAILABLE');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
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
