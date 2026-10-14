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
  assertProfileRestoreActivationJournalMatches,
  captureProfileRestoreActivationJournal,
  parseProfileRestoreActivationJournal,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';

export const profileRestoreActivationJournalFileName =
  'profile-restore-activation-journal-v1.json';

const maximumJournalBytes = 64 * 1024;

interface ProfileRestoreJournalSelectionAuthority {
  readonly previous: Readonly<ProfileRestoreActivationJournal>;
  assertCurrent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
}

export type ProfileRestoreJournalWriteAuthority = ProfileRestoreJournalSelectionAuthority & (
  | { readonly kind?: 'combined'; readonly assertContent?: never }
  | {
    readonly kind: 'separateContent';
    assertContent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
  }
);

export interface ProfileRestoreJournalCreateAuthority {
  readonly previous: undefined;
  assertAbsent(): Promise<void>;
  assertCurrent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
}

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

  async clear(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority?: () => Promise<void>,
  ): Promise<void> {
    if (expected !== undefined) {
      const captured = captureProfileRestoreActivationJournal(expected);
      // Keep the authoritative current slot until every lower slot is removed.
      for (const path of [this.nextPath, this.backupPath, this.filePath]) {
        await assertAuthority?.();
        assertProfileRestoreActivationJournalMatches(captured, await this.peek());
        await assertAuthority?.();
        await rm(path, { force: true });
      }
      await syncDirectory(dirname(this.filePath));
      return;
    }
    if (assertAuthority !== undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    }
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

  /** Selects an operation before cold admission, without granting repair authority. */
  async peek(): Promise<Readonly<ProfileRestoreActivationJournal> | undefined> {
    const selected = await this.selectJournal();
    return selected === undefined ? undefined : Object.freeze(selected.journal);
  }

  async read(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority?: () => Promise<void>,
  ): Promise<
    ProfileRestoreActivationJournal | undefined
  > {
    const captured = expected === undefined
      ? undefined
      : captureProfileRestoreActivationJournal(expected);
    const selected = await this.selectJournal();
    if (captured !== undefined) {
      if (selected === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_REQUIRED');
      assertProfileRestoreActivationJournalMatches(captured, selected?.journal);
    }
    await assertAuthority?.();
    if (selected === undefined) return undefined;
    if (selected.path === this.filePath) {
      await this.removeRecoverySlots(assertAuthority);
      return selected.journal;
    }

    await rename(selected.path, this.filePath);
    if (selected.path === this.backupPath) {
      await this.removePresentRecoverySlot(this.nextPath, assertAuthority);
    }
    await syncDirectory(dirname(this.filePath));
    return selected.journal;
  }

  async write(
    journal: ProfileRestoreActivationJournal,
    authority?: ProfileRestoreJournalWriteAuthority | ProfileRestoreJournalCreateAuthority,
  ): Promise<void> {
    if (parseProfileRestoreActivationJournal(journal) === undefined) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    }

    const directoryPath = dirname(this.filePath);
    let previousMoved = false;
    let nextCreated = false;
    const next = captureProfileRestoreActivationJournal(journal);
    const previous = authority?.previous === undefined ? undefined
      : captureProfileRestoreActivationJournal(authority.previous);
    const contentAuthority = authority !== undefined && 'kind' in authority && authority.kind === 'separateContent'
      ? authority : undefined;
    const assertBefore = () => authority === undefined ? undefined
      : authority.previous === undefined ? authority.assertAbsent()
      : authority.assertCurrent(previous!);
    const assertContent = async (expected: Readonly<ProfileRestoreActivationJournal>) => {
      if (contentAuthority === undefined) return;
      await contentAuthority.assertCurrent(expected);
      await contentAuthority.assertContent(expected);
      await contentAuthority.assertCurrent(expected);
    };
    const assertSelected = async () => {
      await assertBefore();
      if (authority === undefined) return;
      if (previousMoved) {
        assertProfileRestoreActivationJournalMatches(previous!, await readJournal(this.backupPath));
        await assertSlotsAbsent([this.filePath]);
      } else {
        if (previous === undefined) await assertSlotsAbsent([this.filePath]);
        else assertProfileRestoreActivationJournalMatches(previous, await readJournal(this.filePath));
        await assertSlotsAbsent([this.backupPath]);
      }
      if (!nextCreated) await assertSlotsAbsent([this.nextPath]);
      await assertBefore();
    };
    try {
      if (authority !== undefined && 'kind' in authority &&
          authority.kind !== undefined && authority.kind !== 'combined' && authority.kind !== 'separateContent') {
        throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      }
      if (contentAuthority !== undefined && (previous === undefined || typeof contentAuthority.assertContent !== 'function')) {
        throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      }
      if (authority !== undefined && previous === undefined &&
          (next.phase !== 'prepared' || next.revision !== 0)) {
        throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      }
      await assertSelected();
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertBefore();
      await chmod(directoryPath, 0o700);
      await assertPrivateDirectory(directoryPath);
      await assertSelected();
      if (authority === undefined) {
        await rm(this.nextPath, { force: true });
        await rm(this.backupPath, { force: true });
      }

      // Pending-slot preparation retains selection checks; content is checked before publication.
      await assertSelected();
      if (contentAuthority !== undefined) {
        await assertSelected();
      }
      const nextFile = await open(this.nextPath, 'wx', 0o600);
      nextCreated = true;
      let writeFailure: unknown;
      try {
        const createdNext = previous === undefined ? undefined : await nextFile.stat({ bigint: true });
        await assertBefore();
        if (contentAuthority !== undefined) {
          await assertBefore();
        }
        if (createdNext !== undefined) {
          const openedNext = await nextFile.stat({ bigint: true });
          const selectedNext = await lstat(this.nextPath, { bigint: true });
          if (!createdNext.isFile() || createdNext.size !== 0n || createdNext.nlink !== 1n ||
              !openedNext.isFile() || openedNext.size !== 0n || openedNext.nlink !== 1n ||
              !selectedNext.isFile() || selectedNext.isSymbolicLink() || selectedNext.size !== 0n || selectedNext.nlink !== 1n ||
              openedNext.dev !== createdNext.dev || openedNext.ino !== createdNext.ino ||
              selectedNext.dev !== createdNext.dev || selectedNext.ino !== createdNext.ino) {
            throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
          }
          await assertBefore();
        }
        await nextFile.writeFile(
          `${JSON.stringify(next)}\n`,
          'utf8',
        );
        await nextFile.sync();
      } catch (error) {
        writeFailure = error;
        throw error;
      } finally {
        try { await nextFile.close(); }
        catch (error) {
          throw new AggregateError([...(writeFailure === undefined ? [] : [writeFailure]), error], 'PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
        }
      }
      await assertBefore();
      await chmod(this.nextPath, 0o600);

      await assertSelected();
      if (authority !== undefined) {
        assertProfileRestoreActivationJournalMatches(next, await readJournal(this.nextPath));
        await assertSelected();
      }
      if (authority === undefined || previous !== undefined) {
        try {
          await assertBefore();
          if (contentAuthority !== undefined) {
            await assertSelected();
          }
          await rename(this.filePath, this.backupPath);
          previousMoved = true;
        } catch (error) {
          if (authority !== undefined || !isNodeError(error) || error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      try {
        await assertSelected();
        if (authority !== undefined) {
          assertProfileRestoreActivationJournalMatches(next, await readJournal(this.nextPath));
          await assertSelected();
        }
        if (contentAuthority !== undefined) {
          await assertContent(previous!);
          await assertSelected();
          assertProfileRestoreActivationJournalMatches(next, await readJournal(this.nextPath));
          await assertBefore();
        }
        await rename(this.nextPath, this.filePath);
        await syncDirectory(directoryPath);
      } catch (error) {
        if (previousMoved && authority === undefined) {
          await rename(this.backupPath, this.filePath).catch(
            () => undefined,
          );
        }
        throw error;
      }

      if (authority !== undefined) {
        await authority.assertCurrent(next);
        assertProfileRestoreActivationJournalMatches(next, await readJournal(this.filePath));
        if (previousMoved) assertProfileRestoreActivationJournalMatches(previous!, await readJournal(this.backupPath));
        await authority.assertCurrent(next);
      }
      if (previousMoved) {
        if (contentAuthority !== undefined) await assertContent(next);
        if (authority !== undefined) {
          assertProfileRestoreActivationJournalMatches(next, await readJournal(this.filePath));
          assertProfileRestoreActivationJournalMatches(previous!, await readJournal(this.backupPath));
          await authority.assertCurrent(next);
          await assertSlotsAbsent([this.nextPath]);
          await authority.assertCurrent(next);
        }
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
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE', { cause: error });
    } finally {
      if (authority === undefined) await rm(this.nextPath, { force: true }).catch(() => undefined);
    }
  }

  private async removeRecoverySlots(assertAuthority?: () => Promise<void>): Promise<void> {
    if (assertAuthority !== undefined) {
      for (const path of [this.nextPath, this.backupPath]) {
        await this.removePresentRecoverySlot(path, assertAuthority);
      }
      return;
    }
    const results = await Promise.allSettled([
      rm(this.nextPath, { force: true }),
      rm(this.backupPath, { force: true }),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    }
  }

  private async removePresentRecoverySlot(path: string, assertAuthority?: () => Promise<void>): Promise<void> {
    if (assertAuthority !== undefined) {
      try { await lstat(path); }
      catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return;
        throw error;
      }
      await assertAuthority();
    }
    await rm(path, { force: true });
  }

  private async selectJournal(): Promise<{
    readonly journal: ProfileRestoreActivationJournal;
    readonly path: string;
  } | undefined> {
    for (const path of [this.filePath, this.backupPath, this.nextPath]) {
      const journal = await readJournal(path);
      if (journal !== undefined) return { journal, path };
    }
    return undefined;
  }
}

async function assertSlotsAbsent(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try { await lstat(path); }
    catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
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
