import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import { readOnlyJournalSlots, type ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { parseUpdateJournal, type UpdateJournal } from './updateJournal.js';

export const updateJournalFileName = 'local-update-journal-v1.json';
export const maximumUpdateJournalBytes = 32 * 1024;

export interface UpdateJournalWriteSelection {
  expectedJournal: Readonly<UpdateJournal>;
  assertAuthority?(): void;
}

export interface UpdateJournalClearSelection {
  readonly expectedBytes: Uint8Array;
  assertAuthority(): void;
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

  inspectSlots(): Promise<ReadOnlyJournalSlots<UpdateJournal>> {
    return this.runExclusive(() => this.inspectStoredSlots());
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

  createSelected(journal: Readonly<UpdateJournal>, authority: () => void): Promise<void> {
    const validated = parseUpdateJournal(journal);
    const content = Buffer.from(`${JSON.stringify(validated)}\n`, 'utf8');
    const assertAuthority = () => assertUpdateJournalAuthority(authority);
    if (typeof authority !== 'function' || content.byteLength > maximumUpdateJournalBytes) {
      return Promise.reject(new Error('UPDATE_JOURNAL_CONFLICT'));
    }
    return this.runExclusive(async () => {
      try {
        await this.assertInitialSelection(undefined, undefined, assertAuthority);
        assertAuthority();
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
        assertAuthority();
        await chmod(dirname(this.filePath), 0o700);
        await assertPrivateDirectory(dirname(this.filePath));
        await this.assertInitialSelection(undefined, undefined, assertAuthority);
        assertAuthority();
        const file = await open(this.nextPath, 'wx', 0o600);
        let written: Stats | undefined;
        await settleOwnedFile(file, async () => {
          assertAuthority();
          await file.writeFile(content);
          assertAuthority();
          await file.sync();
          written = await file.stat();
          assertAuthority();
        });
        await this.assertInitialSelection(content, written, assertAuthority);
        assertAuthority();
        await rename(this.nextPath, this.filePath);
        assertAuthority();
        await syncDirectory(dirname(this.filePath), true);
        const actual = await this.inspectStoredSlots();
        assertAuthority();
        if (actual.current === undefined || !content.equals(actual.current.bytes) ||
            actual.next !== undefined || actual.backup !== undefined) {
          throw new Error('UPDATE_JOURNAL_CONFLICT');
        }
      } catch (error) {
        // Admission owns interrupted slots. Never undo a possibly published copy.
        if (error instanceof Error && error.message === 'UPDATE_JOURNAL_CONFLICT') throw error;
        throw new Error('UPDATE_JOURNAL_UNAVAILABLE', { cause: error });
      }
    });
  }

  confirmAbsent(authority: () => void): Promise<void> {
    const assertAuthority = () => assertUpdateJournalAuthority(authority);
    if (typeof authority !== 'function') return Promise.reject(new Error('UPDATE_JOURNAL_CONFLICT'));
    return this.runExclusive(async () => {
      await this.assertInitialSelection(undefined, undefined, assertAuthority);
      try {
        await lstat(dirname(this.filePath));
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
        await this.assertInitialSelection(undefined, undefined, assertAuthority);
        return;
      }
      assertAuthority();
      await assertPrivateDirectory(dirname(this.filePath));
      assertAuthority();
      await syncDirectory(dirname(this.filePath), true);
      await this.assertInitialSelection(undefined, undefined, assertAuthority);
    }).catch(error => { throw selectedMutationError(error); });
  }

  confirmSelected(selection: UpdateJournalClearSelection): Promise<void> {
    if (!(selection.expectedBytes instanceof Uint8Array) ||
        selection.expectedBytes.byteLength < 1 || selection.expectedBytes.byteLength > maximumUpdateJournalBytes ||
        typeof selection.assertAuthority !== 'function') {
      return Promise.reject(new Error('UPDATE_JOURNAL_CONFLICT'));
    }
    const expected = Buffer.from(selection.expectedBytes);
    const authority = selection.assertAuthority;
    const assertAuthority = () => assertUpdateJournalAuthority(authority);
    return this.runExclusive(async () => {
      await this.assertCurrentSelection(expected, assertAuthority);
      await assertPrivateDirectory(dirname(this.filePath));
      assertAuthority();
      await syncDirectory(dirname(this.filePath), true);
      await this.assertCurrentSelection(expected, assertAuthority);
    }).catch(error => { throw selectedMutationError(error); });
  }

  private async assertCurrentSelection(expected: Buffer, assertAuthority: () => void): Promise<void> {
    assertAuthority();
    const before = await lstat(this.filePath);
    assertAuthority();
    const slots = await this.inspectStoredSlots();
    assertAuthority();
    if (slots.current === undefined || slots.next !== undefined || slots.backup !== undefined ||
        !expected.equals(slots.current.bytes)) {
      throw new Error('UPDATE_JOURNAL_CONFLICT');
    }
    const after = await lstat(this.filePath);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 ||
        before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('UPDATE_JOURNAL_CONFLICT');
    }
    assertAuthority();
  }

  private async assertInitialSelection(
    next: Buffer | undefined, identity: Stats | undefined, assertAuthority: () => void,
  ): Promise<void> {
    assertAuthority();
    const slots = await this.inspectStoredSlots();
    assertAuthority();
    if (slots.current !== undefined || slots.backup !== undefined ||
        (next === undefined ? slots.next !== undefined :
          slots.next === undefined || !next.equals(slots.next.bytes))) {
      throw new Error('UPDATE_JOURNAL_CONFLICT');
    }
    if (next !== undefined) {
      const actual = await lstat(this.nextPath);
      assertAuthority();
      if (identity === undefined || !actual.isFile() || actual.isSymbolicLink() || actual.nlink !== 1 ||
          identity.dev !== actual.dev || identity.ino !== actual.ino || identity.size !== actual.size ||
          identity.mtimeMs !== actual.mtimeMs || identity.ctimeMs !== actual.ctimeMs) {
        throw new Error('UPDATE_JOURNAL_CONFLICT');
      }
    }
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

  clearSelected(selection: UpdateJournalClearSelection): Promise<void> {
    if (!(selection.expectedBytes instanceof Uint8Array) ||
        selection.expectedBytes.byteLength < 1 ||
        selection.expectedBytes.byteLength > maximumUpdateJournalBytes ||
        typeof selection.assertAuthority !== 'function') {
      return Promise.reject(new Error('UPDATE_JOURNAL_CONFLICT'));
    }
    const expected = Buffer.from(selection.expectedBytes);
    const authority = selection.assertAuthority;
    const assertAuthority = () => assertUpdateJournalAuthority(authority);
    return this.runExclusive(async () => {
      try {
        await this.assertCurrentSelection(expected, assertAuthority);
        assertAuthority();
        // Only the selected current is owned here. Never force-remove siblings.
        await unlink(this.filePath);
        assertAuthority();
        await syncDirectory(dirname(this.filePath), true);
        assertAuthority();
        const remaining = await this.inspectStoredSlots();
        if (remaining.current !== undefined || remaining.next !== undefined || remaining.backup !== undefined) {
          throw new Error('UPDATE_JOURNAL_CONFLICT');
        }
        assertAuthority();
      } catch (error) {
        if (error instanceof Error && error.message === 'UPDATE_JOURNAL_CONFLICT') throw error;
        throw new Error('UPDATE_JOURNAL_UNAVAILABLE', { cause: error });
      }
    });
  }

  private async inspectStoredSlots(): Promise<ReadOnlyJournalSlots<UpdateJournal>> {
    try {
      return await readOnlyJournalSlots({
        currentPath: this.filePath, nextPath: this.nextPath, backupPath: this.backupPath,
      }, maximumUpdateJournalBytes, parseUpdateJournal);
    } catch (error) {
      throw new Error('UPDATE_JOURNAL_INVALID', { cause: error });
    }
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

async function syncDirectory(path: string, preserveFirstFailure = false): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  if (preserveFirstFailure) return settleOwnedFile(directory, () => directory.sync());
  try { await directory.sync(); } finally { await directory.close(); }
}

async function settleOwnedFile(file: FileHandle, operation: () => Promise<void>): Promise<void> {
  let failure: { error: unknown } | undefined;
  try { await operation(); } catch (error) { failure = { error }; }
  try { await file.close(); } catch (error) {
    if (failure !== undefined) {
      throw new AggregateError([failure.error, error], 'UPDATE_JOURNAL_UNAVAILABLE', { cause: failure.error });
    }
    throw error;
  }
  if (failure !== undefined) throw failure.error;
}

function pathsAreEqual(first: string, second: string): boolean {
  const a = resolve(first);
  const b = resolve(second);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function selectedMutationError(error: unknown): Error {
  return error instanceof Error && (error.message === 'UPDATE_JOURNAL_CONFLICT' || error.message === 'UPDATE_JOURNAL_BUSY')
    ? error : new Error('UPDATE_JOURNAL_UNAVAILABLE', { cause: error });
}
