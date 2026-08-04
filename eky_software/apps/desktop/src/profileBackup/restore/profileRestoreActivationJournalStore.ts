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

import {
  parseProfileRestoreActivationJournal,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';

export const profileRestoreActivationJournalFileName =
  'profile-restore-activation-journal-v1.json';

const maximumJournalBytes = 64 * 1024;

export class ProfileRestoreActivationJournalStore {
  private readonly backupPath: string;
  private readonly nextPath: string;

  constructor(private readonly filePath: string) {
    if (
      !isAbsolute(filePath) ||
      filePath.includes('\0') ||
      basename(filePath) !==
        profileRestoreActivationJournalFileName
    ) {
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  async clear(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.filePath, { force: true }),
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    }
    await syncDirectory(dirname(this.filePath));
  }

  async read(): Promise<
    ProfileRestoreActivationJournal | undefined
  > {
    const current = await readJournal(this.filePath);
    if (current !== undefined) {
      await this.removeRecoverySlots();
      return current;
    }

    const backup = await readJournal(this.backupPath);
    if (backup !== undefined) {
      await rename(this.backupPath, this.filePath);
      await rm(this.nextPath, { force: true });
      await syncDirectory(dirname(this.filePath));
      return backup;
    }

    const next = await readJournal(this.nextPath);
    if (next !== undefined) {
      await rename(this.nextPath, this.filePath);
      await syncDirectory(dirname(this.filePath));
      return next;
    }

    return undefined;
  }

  async write(journal: ProfileRestoreActivationJournal): Promise<void> {
    if (parseProfileRestoreActivationJournal(journal) === undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
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
        await nextFile.writeFile(
          `${JSON.stringify(journal)}\n`,
          'utf8',
        );
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
        await syncDirectory(directoryPath);
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
        await syncDirectory(directoryPath);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'PROFILE_RESTORE_JOURNAL_INVALID'
      ) {
        throw error;
      }
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
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
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    }
  }
}

async function readJournal(
  path: string,
): Promise<ProfileRestoreActivationJournal | undefined> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumJournalBytes
    ) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    }
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const journal = parseProfileRestoreActivationJournal(parsed);
    if (journal === undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    }
    return journal;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
  }
  if (!pathsAreEqual(await realpath(path), path)) {
    throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
