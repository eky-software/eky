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
  assertProfileRestoreActivationJournalStep,
  captureProfileRestoreActivationJournal,
  parseProfileRestoreActivationJournal,
  type ProfileRestoreActivationJournal,
} from './profileRestoreActivationJournal.js';
import { assertSynchronousProfileRestoreMutationAuthority } from './profileRestoreMutationAuthority.js';
import { CrashSafeByteSlotStore, type CrashSafeByteSlotSelection, type ObservedRecoveryAuthority } from '../../workspaces/persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../../workspaces/persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../../workspaces/persistence/readOnlyJournalSlots.js';
import { captureWorkspaceRemnantBinding } from '../../workspaces/deletion/workspaceRemnantBindingCodec.js';

export const profileRestoreActivationJournalFileName =
  'profile-restore-activation-journal-v1.json';

const maximumJournalBytes = 64 * 1024;

interface ProfileRestoreJournalSelectionAuthority {
  readonly previous: Readonly<ProfileRestoreActivationJournal>;
  assertCurrent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
  readonly assertMutationCurrent?: () => void;
  readonly writeContext?: {
    assertReadCurrent(journal: Readonly<ProfileRestoreActivationJournal>): Promise<void>;
    assertMutationCurrent(): void;
  };
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
  readonly assertMutationCurrent?: () => void;
}

export class ProfileRestoreActivationJournalStore {
  private readonly backupPath: string;
  private readonly nextPath: string;
  private readonly deletionFileSystem: CrashSafeFileSlotFileSystem;
  private deletionSlotAccess = false;

  constructor(private readonly filePath: string, deletionFileSystem?: CrashSafeFileSlotFileSystem) {
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
    this.deletionFileSystem = deletionFileSystem ?? createNodeCrashSafeFileSlotFileSystem({
      directoryPath: dirname(filePath), currentPath: filePath, backupPath: this.backupPath, nextPath: this.nextPath,
    }, maximumJournalBytes);
  }

  // Non-repairing evidence for the bound deletion owner; normal recovery remains unchanged.
  inspectDeletionSlots(assertAuthority: () => void): Promise<ReadOnlyJournalSlots<ProfileRestoreActivationJournal>> {
    return this.withDeletionSlotAccess(async () => {
      const slots: Record<'current' | 'backup' | 'next', ReadOnlyJournalSlots<ProfileRestoreActivationJournal>['current']> = {
        current: undefined, backup: undefined, next: undefined,
      };
      const check = () => assertSynchronousProfileRestoreMutationAuthority(assertAuthority);
      for (const slot of ['current', 'backup', 'next'] as const) {
        check(); let identity: CrashSafeFileSlotIdentity | undefined;
        const bytes = await this.deletionFileSystem.readSlot(slot, value => { identity = value; });
        check();
        if (bytes !== undefined) {
          if (identity === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
          slots[slot] = Object.freeze({ bytes: Uint8Array.from(bytes), identity: Object.freeze({ ...identity }),
            value: parseDeletionJournalBytes(bytes) });
        }
      }
      return Object.freeze(slots);
    });
  }

  // Source selection only; neither this observation nor its identities grant repair authority.
  inspectRecoverySelection(assertAuthority: () => void) {
    return this.withDeletionSlotAccess(async () => {
      const check = () => assertSynchronousProfileRestoreMutationAuthority(assertAuthority);
      const selection = await new CrashSafeByteSlotStore(this.deletionFileSystem).inspectRecoverySelection(check);
      const value = selection.bytes === undefined ? undefined
        : Object.freeze(parseJournalSource(Buffer.from(selection.bytes).toString('utf8')));
      check();
      return Object.freeze({ ...selection, value });
    });
  }

  clearAfterDeletionPurged(bindingValue: unknown, selection: CrashSafeByteSlotSelection & ObservedRecoveryAuthority & {
    assertDeletionPurged(): Promise<void>;
  }): Promise<void> {
    return this.withDeletionSlotAccess(async () => {
      const { expectedSlots: slots, expectedIdentities: identities } = captureProfileRestoreActivationDeletionSlots(bindingValue, selection);
      const check = selection.assertAuthority.bind(selection), external = selection.assertExternalSelection.bind(selection);
      const purged = selection.assertDeletionPurged.bind(selection), uncertain = selection.onUncertain.bind(selection);
      let failed = false;
      let firstFailure: unknown;
      const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
      const assertAuthority = () => {
        if (failed) throw firstFailure;
        try { assertSynchronousProfileRestoreMutationAuthority(check); } catch (error) { throw retain(error); }
      };
      const assertExternalSelection = async () => {
        try { assertAuthority(); await external(); assertAuthority(); await purged(); assertAuthority(); await external(); assertAuthority(); }
        catch (error) { throw retain(error); }
      };
      try { await new CrashSafeByteSlotStore(this.deletionFileSystem).clearSelected({
        expectedSlots: slots, expectedIdentities: identities, assertAuthority, assertExternalSelection,
      }); assertAuthority(); }
      catch (error) {
        const original = failed ? firstFailure : error;
        try { const result: unknown = uncertain(original); if (result !== undefined) void Promise.resolve(result).catch(() => undefined); }
        catch { /* Keep the first cleanup failure. */ }
        throw original;
      }
    });
  }

  private async withDeletionSlotAccess<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.deletionSlotAccess) throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
    this.deletionSlotAccess = true;
    try { return await work(); } finally { this.deletionSlotAccess = false; }
  }

  async clear(
    expected?: Readonly<ProfileRestoreActivationJournal>,
    assertAuthority?: () => Promise<void>,
    assertMutationCurrent?: () => void,
  ): Promise<void> {
    if (assertMutationCurrent !== undefined && (expected === undefined || typeof assertAuthority !== 'function' ||
        typeof assertMutationCurrent !== 'function')) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    if (expected !== undefined) {
      const captured = captureProfileRestoreActivationJournal(expected);
      // Keep the authoritative current slot until every lower slot is removed.
      for (const path of [this.nextPath, this.backupPath, this.filePath]) {
        await assertAuthority?.();
        assertProfileRestoreActivationJournalMatches(captured, await this.peek());
        await assertAuthority?.();
        if (assertMutationCurrent !== undefined) assertSynchronousProfileRestoreMutationAuthority(assertMutationCurrent);
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
    assertMutationCurrent?: () => void,
  ): Promise<
    ProfileRestoreActivationJournal | undefined
  > {
    if (assertMutationCurrent !== undefined && (expected === undefined || typeof assertAuthority !== 'function' ||
        typeof assertMutationCurrent !== 'function')) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
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
      await this.removeRecoverySlots(assertAuthority, assertMutationCurrent);
      return selected.journal;
    }

    if (assertMutationCurrent !== undefined) assertSynchronousProfileRestoreMutationAuthority(assertMutationCurrent);
    await rename(selected.path, this.filePath);
    if (selected.path === this.backupPath) {
      await this.removePresentRecoverySlot(this.nextPath, assertAuthority, assertMutationCurrent);
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

    const suppliedContext = authority !== undefined && 'writeContext' in authority ? authority.writeContext : undefined;
    const suppliedMutation = authority !== undefined && 'assertMutationCurrent' in authority ? authority.assertMutationCurrent : undefined;
    if (suppliedMutation !== undefined && (typeof suppliedMutation !== 'function' || authority === undefined ||
        typeof authority.assertCurrent !== 'function')) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    const assertLiveMutation = suppliedMutation?.bind(authority);
    if (suppliedContext !== undefined && (authority === undefined || !('kind' in authority) ||
        (authority.kind !== 'separateContent' && authority.kind !== 'combined') ||
        (authority.kind === 'combined' && (suppliedMutation === undefined || authority.assertContent !== undefined)) ||
        authority.previous === undefined || suppliedContext === null ||
        typeof suppliedContext.assertReadCurrent !== 'function' || typeof suppliedContext.assertMutationCurrent !== 'function')) {
      throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    }
    // Capture the optional port and callbacks before any asynchronous work.
    const writeContext = suppliedContext === undefined ? undefined : Object.freeze({
      assertReadCurrent: suppliedContext.assertReadCurrent.bind(suppliedContext),
      assertMutationCurrent: suppliedContext.assertMutationCurrent.bind(suppliedContext),
    });
    if (assertLiveMutation !== undefined && authority?.previous === undefined) {
      const supplied = authority as ProfileRestoreJournalCreateAuthority;
      if (typeof supplied.assertAbsent !== 'function' ||
          ('kind' in supplied && supplied.kind !== undefined && supplied.kind !== 'combined')) {
        throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      }
      authority = Object.freeze({ previous: undefined,
        assertAbsent: supplied.assertAbsent.bind(supplied),
        assertCurrent: supplied.assertCurrent.bind(supplied),
      });
    } else if (writeContext !== undefined || assertLiveMutation !== undefined) {
      const supplied = authority as ProfileRestoreJournalWriteAuthority;
      if (typeof supplied.assertCurrent !== 'function' ||
          (supplied.kind === 'separateContent' && typeof supplied.assertContent !== 'function')) {
        throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      }
      authority = Object.freeze({ previous: captureProfileRestoreActivationJournal(supplied.previous),
        assertCurrent: supplied.assertCurrent.bind(supplied),
        ...(supplied.kind === 'separateContent' ? { kind: 'separateContent' as const,
          assertContent: supplied.assertContent.bind(supplied) }
          : supplied.kind === undefined ? {} : { kind: supplied.kind }),
        ...(writeContext === undefined ? {} : { writeContext }),
      });
    }
    const directoryPath = dirname(this.filePath);
    let previousMoved = false;
    let nextCreated = false;
    let nextWritten = false;
    let published = false;
    const next = captureProfileRestoreActivationJournal(journal);
    const previous = authority?.previous === undefined ? undefined
      : captureProfileRestoreActivationJournal(authority.previous);
    const contentAuthority = authority !== undefined && 'kind' in authority && authority.kind === 'separateContent'
      ? authority : undefined;
    const assertBefore = () => writeContext !== undefined ? writeContext.assertReadCurrent(previous!)
      : authority === undefined ? undefined
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
    const assertMutation = async (checkOpenedNext?: () => Promise<void>) => {
      if (writeContext === undefined) return;
      await authority!.assertCurrent(published ? next : previous!);
      if (published) {
        assertProfileRestoreActivationJournalMatches(next, await readJournal(this.filePath));
        assertProfileRestoreActivationJournalMatches(previous!, await readJournal(this.backupPath));
        await assertSlotsAbsent([this.nextPath]);
      } else {
        await assertSelected();
        if (nextWritten) assertProfileRestoreActivationJournalMatches(next, await readJournal(this.nextPath));
        else if (nextCreated) {
          if (checkOpenedNext === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
          await checkOpenedNext();
        }
      }
    };
    const assertMutationCurrent = () => {
      if (writeContext !== undefined) assertSynchronousProfileRestoreMutationAuthority(writeContext.assertMutationCurrent);
      if (assertLiveMutation !== undefined) assertSynchronousProfileRestoreMutationAuthority(assertLiveMutation);
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
      if (writeContext !== undefined) await assertMutation();
      assertMutationCurrent();
      await mkdir(directoryPath, { mode: 0o700, recursive: true });
      await assertBefore();
      if (writeContext !== undefined) await assertMutation();
      assertMutationCurrent();
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
      if (writeContext !== undefined) await assertMutation();
      assertMutationCurrent();
      const nextFile = await open(this.nextPath, 'wx', 0o600);
      nextCreated = true;
      let writeFailure: unknown;
      try {
        const createdNext = previous === undefined ? undefined : await nextFile.stat({ bigint: true });
        await assertBefore();
        if (contentAuthority !== undefined) {
          await assertBefore();
        }
        const assertOpenedNext = async () => {
          if (createdNext === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
          const openedNext = await nextFile.stat({ bigint: true });
          const selectedNext = await lstat(this.nextPath, { bigint: true });
          if (!createdNext.isFile() || createdNext.size !== 0n || createdNext.nlink !== 1n ||
              !openedNext.isFile() || openedNext.size !== 0n || openedNext.nlink !== 1n ||
              !selectedNext.isFile() || selectedNext.isSymbolicLink() || selectedNext.size !== 0n || selectedNext.nlink !== 1n ||
              openedNext.dev !== createdNext.dev || openedNext.ino !== createdNext.ino ||
              selectedNext.dev !== createdNext.dev || selectedNext.ino !== createdNext.ino) {
            throw new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE');
          }
        };
        if (createdNext !== undefined) {
          await assertOpenedNext();
          await assertBefore();
        }
        if (writeContext !== undefined) await assertMutation(assertOpenedNext);
        assertMutationCurrent();
        await nextFile.writeFile(
          `${JSON.stringify(next)}\n`,
          'utf8',
        );
        await nextFile.sync();
        nextWritten = true;
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
      if (writeContext !== undefined) await assertMutation();
      assertMutationCurrent();
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
          if (writeContext !== undefined) await assertMutation();
          assertMutationCurrent();
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
        if (writeContext !== undefined) await assertMutation();
        assertMutationCurrent();
        await rename(this.nextPath, this.filePath);
        published = true;
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
        if (writeContext !== undefined) await assertMutation();
        assertMutationCurrent();
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

  private async removeRecoverySlots(assertAuthority?: () => Promise<void>, assertMutationCurrent?: () => void): Promise<void> {
    if (assertAuthority !== undefined) {
      for (const path of [this.nextPath, this.backupPath]) {
        await this.removePresentRecoverySlot(path, assertAuthority, assertMutationCurrent);
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

  private async removePresentRecoverySlot(path: string, assertAuthority?: () => Promise<void>, assertMutationCurrent?: () => void): Promise<void> {
    if (assertAuthority !== undefined) {
      try { await lstat(path); }
      catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') return;
        throw error;
      }
      await assertAuthority();
    }
    if (assertMutationCurrent !== undefined) assertSynchronousProfileRestoreMutationAuthority(assertMutationCurrent);
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

// Operation/phase relationships only; this journal does not encode company or lineage.
export function captureProfileRestoreActivationDeletionSlots(
  bindingValue: unknown, selection: Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>,
) {
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner !== 'workspaceReplacement' && binding.owner !== 'workspaceActivationMigration') {
    throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
  }
  const slots: Record<'current' | 'backup' | 'next', Uint8Array | undefined> = { current: undefined, backup: undefined, next: undefined };
  const identities: Record<'current' | 'backup' | 'next', Readonly<CrashSafeFileSlotIdentity> | undefined> = {
    current: undefined, backup: undefined, next: undefined,
  };
  let previous: Readonly<ProfileRestoreActivationJournal> | undefined;
  let count = 0;
  for (const slot of ['backup', 'current', 'next'] as const) {
    const supplied = selection.expectedSlots[slot];
    if (supplied === undefined) {
      if (selection.expectedIdentities[slot] !== undefined) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
      continue;
    }
    if (!(supplied instanceof Uint8Array)) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    const bytes = Uint8Array.from(supplied), value = parseDeletionJournalBytes(bytes), identity = selection.expectedIdentities[slot];
    if (identity === undefined || value.operationId !== binding.operationId) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
    if (previous !== undefined) assertProfileRestoreActivationJournalStep(previous, value);
    previous = value; slots[slot] = bytes; identities[slot] = Object.freeze({ ...identity });
    count++;
  }
  if (count > 2) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
  return { expectedSlots: slots, expectedIdentities: identities };
}

function parseDeletionJournalBytes(bytes: Uint8Array): Readonly<ProfileRestoreActivationJournal> {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return captureProfileRestoreActivationJournal(JSON.parse(source));
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
    return parseJournalSource(await readFile(path, 'utf8'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
  }
}

function parseJournalSource(source: string): ProfileRestoreActivationJournal {
  const parsed: unknown = JSON.parse(source);
  const journal = parseProfileRestoreActivationJournal(parsed);
  if (journal === undefined) throw new Error('PROFILE_RESTORE_JOURNAL_INVALID');
  return journal;
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
