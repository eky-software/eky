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
import { isDeepStrictEqual } from 'node:util';

import { parseUpdateJournal, type UpdateJournal } from './updateJournal.js';

export const updateJournalFileName = 'local-update-journal-v1.json';
export const maximumUpdateJournalBytes = 32 * 1024;

export interface UpdateJournalWriteSelection {
  expectedJournal: Readonly<UpdateJournal>;
  assertAuthority?(): void;
}

export class UpdateJournalStore {
  private readonly backupPath: string;
  private readonly nextPath: string;
  private activeOperation = false;

  constructor(private readonly filePath: string) {
    if (!isAbsolute(filePath) || filePath.includes('\0') ||
      basename(filePath) !== updateJournalFileName) {
      throw new Error('UPDATE_JOURNAL_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  read(): Promise<Readonly<UpdateJournal> | undefined> {
    return this.runExclusive(async () => {
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
    });
  }

  readForLiveOwner(): Promise<Readonly<UpdateJournal> | undefined> {
    return this.runExclusive(async () => {
      // Recovery slots require startup recovery, not live handoff authorization.
      await assertSlotsAbsent([this.backupPath, this.nextPath]);
      return readJournal(this.filePath);
    });
  }

  write(journal: Readonly<UpdateJournal>, selection?: UpdateJournalWriteSelection): Promise<void> {
    const expected = selection === undefined ? undefined : parseUpdateJournal(selection.expectedJournal);
    const authority = selection?.assertAuthority;
    const assertAuthority = () => assertUpdateJournalAuthority(authority);
    return this.runExclusive(async () => {
      const validated = parseUpdateJournal(journal);
      const assertSelected = expected === undefined ? undefined : async (ownedNext: boolean) => {
        assertAuthority();
        await assertSlotsAbsent(ownedNext ? [this.backupPath] : [this.backupPath, this.nextPath]);
        const selected = await readJournal(this.filePath);
        if (!isDeepStrictEqual(selected, expected)) throw new Error('UPDATE_JOURNAL_CONFLICT');
        assertAuthority();
      };
      const current = await readJournal(this.filePath);
      if (current !== undefined &&
        (current.correlationId !== validated.correlationId ||
          validated.revision < current.revision)) {
        throw new Error('UPDATE_JOURNAL_CONFLICT');
      }
      await writeCrashSafe(this.filePath, this.nextPath, this.backupPath,
        `${JSON.stringify(validated)}\n`, assertSelected, assertAuthority);
    });
  }

  clear(): Promise<void> {
    return this.runExclusive(async () => {
      const results = await Promise.allSettled([
        rm(this.filePath, { force: true }),
        rm(this.nextPath, { force: true }),
        rm(this.backupPath, { force: true }),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('UPDATE_JOURNAL_UNAVAILABLE');
      }
      await syncDirectory(dirname(this.filePath));
    });
  }

  private async removeRecoverySlots(): Promise<void> {
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('UPDATE_JOURNAL_UNAVAILABLE');
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new Error('UPDATE_JOURNAL_BUSY');
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }
}

export function assertUpdateJournalAuthority(authority?: () => void): void {
  const result: unknown = authority?.();
  if (result !== undefined) {
    // A rejected async/reentrant assertion must never become an ignored grant.
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('UPDATE_JOURNAL_CONFLICT');
  }
}

async function writeCrashSafe(
  currentPath: string,
  nextPath: string,
  backupPath: string,
  content: string,
  assertSelected?: (ownedNext: boolean) => Promise<void>,
  assertAuthority?: () => void,
): Promise<void> {
  const directoryPath = dirname(currentPath);
  let previousMoved = false;
  let nextCreated = false;
  try {
    await assertSelected?.(false);
    await mkdir(directoryPath, { mode: 0o700, recursive: true });
    await chmod(directoryPath, 0o700);
    await assertPrivateDirectory(directoryPath);
    if (assertSelected === undefined) {
      await rm(nextPath, { force: true });
      await rm(backupPath, { force: true });
    }
    const nextFile = await open(nextPath, 'wx', 0o600);
    nextCreated = true;
    try {
      await nextFile.writeFile(content, 'utf8');
      await nextFile.sync();
    } finally {
      await nextFile.close();
    }
    await chmod(nextPath, 0o600);
    await assertSelected?.(true);
    try {
      assertAuthority?.();
      await rename(currentPath, backupPath);
      previousMoved = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
      if (assertSelected !== undefined) {
        throw new Error('UPDATE_JOURNAL_CONFLICT', { cause: error });
      }
    }
    try {
      assertAuthority?.();
      await rename(nextPath, currentPath);
      await syncDirectory(directoryPath);
    } catch (error) {
      if (previousMoved) {
        try {
          await rename(backupPath, currentPath);
        } catch (restorationError) {
          throw new AggregateError(
            [error, restorationError],
            'UPDATE_JOURNAL_UNAVAILABLE',
          );
        }
      }
      throw error;
    }
    if (previousMoved) {
      assertAuthority?.();
      await rm(backupPath, { force: true });
      await syncDirectory(directoryPath);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'UPDATE_JOURNAL_CONFLICT') {
      throw error;
    }
    throw new Error('UPDATE_JOURNAL_UNAVAILABLE', { cause: error });
  } finally {
    if (assertSelected === undefined || nextCreated) {
      await rm(nextPath, { force: true }).catch(() => undefined);
    }
  }
}

async function assertSlotsAbsent(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try { await lstat(path); }
    catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw new Error('UPDATE_JOURNAL_UNAVAILABLE', { cause: error });
    }
    throw new Error('UPDATE_JOURNAL_CONFLICT');
  }
}

async function readJournal(path: string): Promise<Readonly<UpdateJournal> | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      metadata.size < 1 || metadata.size > maximumUpdateJournalBytes) {
      throw new Error('UPDATE_JOURNAL_INVALID');
    }
    return parseUpdateJournal(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw new Error('UPDATE_JOURNAL_INVALID');
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
    !pathsAreEqual(await realpath(path), path)) {
    throw new Error('UPDATE_JOURNAL_UNAVAILABLE');
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

function pathsAreEqual(first: string, second: string): boolean {
  const a = resolve(first);
  const b = resolve(second);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
