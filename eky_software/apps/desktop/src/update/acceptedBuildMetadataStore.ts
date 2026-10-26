import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { readOnlyJournalSlots, type ReadOnlyJournalSlotRecord, type ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { CrashSafeByteSlotStore, type CrashSafeByteSlotSelection } from '../workspaces/persistence/crashSafeByteSlotStore.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import { parseVersionedAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';

export const acceptedBuildMetadataFileName = 'accepted-build-v1.json';
const maximumBytes = 4 * 1024;

export interface AcceptedBuildMetadataSelection {
  readonly expectedBytes: Uint8Array | undefined;
  assertAuthority(): void;
}

export interface AcceptedBuildMetadataPublication {
  readonly selected: ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata>;
  assertAuthority(): void;
  assertExternalSelection(): Promise<void>;
}

type SelectedSlots = Record<'current' | 'next' | 'backup', Buffer | undefined>;

export class AcceptedBuildMetadataStore {
  private readonly backupPath: string;
  private readonly nextPath: string;
  private activeOperation = false;

  constructor(private readonly filePath: string) {
    if (!isAbsolute(filePath) || filePath.includes('\0') ||
      basename(filePath) !== acceptedBuildMetadataFileName) {
      throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    }
    this.backupPath = `${filePath}.backup`;
    this.nextPath = `${filePath}.next`;
  }

  inspectSlots(): Promise<ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>> {
    return this.runExclusive(() => this.inspectStoredSlots());
  }

  // Observation only. V1 owns its interrupted unselected write; any complete
  // v2 slot instead requires joint admission before the repairing reader.
  inspectStartup(): Promise<Readonly<{ mode: 'legacy' }> | Readonly<{
    mode: 'scoped'; slots: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  }>> {
    return this.runExclusive(async () => {
      const fileSystem = createNodeCrashSafeFileSlotFileSystem({ directoryPath: dirname(this.filePath),
        currentPath: this.filePath, nextPath: this.nextPath, backupPath: this.backupPath }, maximumBytes);
      const slots: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlotRecord<VersionedAcceptedBuildMetadata> | undefined> = {
        current: undefined, next: undefined, backup: undefined,
      };
      let selected: 'current' | 'backup' | 'next' | undefined;
      let failure: unknown;
      for (const slot of ['current', 'backup', 'next'] as const) {
        let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
        const bytes = await fileSystem.readSlot(slot, value => { identity = value; }, 'allowEmptyObservation');
        if (bytes === undefined) continue;
        selected ??= slot;
        try {
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          assertNoDuplicateWorkspaceRegistryKeys(source);
          const value = parseVersionedAcceptedBuildMetadata(JSON.parse(source));
          if (identity === undefined) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
          slots[slot] = Object.freeze({ bytes, value, identity });
        } catch (error) { failure ??= error; }
      }
      const hasScoped = Object.values(slots).some(slot => slot?.value.formatVersion === 2);
      if (!hasScoped && (selected === undefined || slots[selected]?.value.formatVersion === 1)) {
        return Object.freeze({ mode: 'legacy' });
      }
      if (failure !== undefined) throw new Error('ACCEPTED_BUILD_METADATA_INVALID', { cause: failure });
      return Object.freeze({ mode: 'scoped', slots: Object.freeze(slots) });
    });
  }

  private async inspectStoredSlots(): Promise<ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>> {
    try {
      return await readOnlyJournalSlots<VersionedAcceptedBuildMetadata>({
        currentPath: this.filePath, nextPath: this.nextPath, backupPath: this.backupPath,
      }, maximumBytes, parseVersionedAcceptedBuildMetadata, { includeIdentity: true });
    } catch (error) {
      throw new Error('ACCEPTED_BUILD_METADATA_INVALID', { cause: error });
    }
  }

  read(): Promise<VersionedAcceptedBuildMetadata | undefined> {
    return this.runExclusive(() => this.readStored());
  }

  // The installation owner admits the joint state before requesting recovery.
  // The shared byte store renews exact slot identities and external authority.
  recoverSelected(selection: CrashSafeByteSlotSelection): Promise<Readonly<CrashSafeFileSlotIdentity>> {
    return this.runExclusive(async () => {
      try {
        for (const bytes of Object.values(selection.expectedSlots)) {
          if (bytes === undefined) continue;
          if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
          const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          assertNoDuplicateWorkspaceRegistryKeys(source);
          parseVersionedAcceptedBuildMetadata(JSON.parse(source));
        }
        const byteStore = new CrashSafeByteSlotStore(createNodeCrashSafeFileSlotFileSystem({
          directoryPath: dirname(this.filePath), currentPath: this.filePath,
          nextPath: this.nextPath, backupPath: this.backupPath,
        }, maximumBytes));
        return await byteStore.recoverSelected(selection);
      } catch (error) { throw selectedMutationError(error); }
    });
  }

  private async readStored(): Promise<VersionedAcceptedBuildMetadata | undefined> {
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

  async write(metadata: VersionedAcceptedBuildMetadata, selection?: AcceptedBuildMetadataSelection): Promise<void> {
    const validated = parseVersionedAcceptedBuildMetadata(metadata);
    const captured = selection === undefined ? undefined : captureSelection(selection);
    return this.runExclusive(() => captured === undefined
      ? this.writeStored(validated)
      : this.writeSelected(validated, captured));
  }

  async publishSelected(
    metadata: VersionedAcceptedBuildMetadata,
    publication: AcceptedBuildMetadataPublication,
  ): Promise<Readonly<CrashSafeFileSlotIdentity>> {
    const validated = parseVersionedAcceptedBuildMetadata(metadata);
    const assertExternalSelection = publication.assertExternalSelection.bind(publication);
    const { expectedBytes, assertAuthority } = captureSelection({
      expectedBytes: publication.selected.bytes,
      assertAuthority: publication.assertAuthority.bind(publication),
    });
    const identity = publication.selected.identity;
    if (expectedBytes === undefined || identity === undefined) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    const selected = parseVersionedAcceptedBuildMetadata(JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(expectedBytes)));
    if (!isDeepStrictEqual(selected, publication.selected.value) ||
      (selected.formatVersion === 2 && validated.formatVersion === 1)) {
      throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    }
    const bytes = Buffer.from(`${JSON.stringify(validated)}\n`, 'utf8');
    if (bytes.byteLength > maximumBytes) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    const byteStore = new CrashSafeByteSlotStore(createNodeCrashSafeFileSlotFileSystem({
      directoryPath: dirname(this.filePath), currentPath: this.filePath,
      nextPath: this.nextPath, backupPath: this.backupPath,
    }, maximumBytes));
    return this.runExclusive(async () => {
      try {
        return await byteStore.replaceSelected(bytes, {
          expectedSlots: { current: expectedBytes, next: undefined, backup: undefined },
          expectedIdentities: { current: identity, next: undefined, backup: undefined },
          assertAuthority,
          assertExternalSelection,
        });
      } catch (error) { throw selectedMutationError(error); }
    });
  }

  private async writeStored(validated: VersionedAcceptedBuildMetadata): Promise<void> {
    // Check before any repair or cleanup: a version downgrade must preserve all slots.
    if (validated.formatVersion === 1) {
      for (const path of [this.filePath, this.backupPath, this.nextPath]) {
        if ((await readMetadata(path))?.formatVersion === 2) {
          throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
        }
      }
    }
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

  clear(): Promise<void> {
    return this.runExclusive(() => this.clearStored());
  }

  private async clearStored(): Promise<void> {
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

  async clearSelected(selection: AcceptedBuildMetadataSelection): Promise<void> {
    const captured = captureSelection(selection);
    if (captured.expectedBytes === undefined) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    return this.runExclusive(async () => {
      const selected: SelectedSlots = { current: captured.expectedBytes, next: undefined, backup: undefined };
      try {
        await this.assertSelectedSlots(selected, captured.assertAuthority);
        captured.assertAuthority();
        await unlink(this.filePath);
        selected.current = undefined;
        captured.assertAuthority();
        await syncDirectory(dirname(this.filePath), true);
        captured.assertAuthority();
        await this.assertSelectedSlots(selected, captured.assertAuthority);
      } catch (error) { throw selectedMutationError(error); }
    });
  }

  confirmAbsent(authority: () => void): Promise<void> {
    const { assertAuthority } = captureSelection({ expectedBytes: undefined, assertAuthority: authority });
    const absent: SelectedSlots = { current: undefined, next: undefined, backup: undefined };
    return this.runExclusive(async () => {
      try {
        await this.assertSelectedSlots(absent, assertAuthority);
        if (await optionalFileStat(dirname(this.filePath)) !== undefined) {
          assertAuthority();
          await assertPrivateDirectory(dirname(this.filePath));
          assertAuthority();
          await syncDirectory(dirname(this.filePath), true);
        }
        await this.assertSelectedSlots(absent, assertAuthority);
      } catch (error) { throw selectedMutationError(error); }
    });
  }

  async confirmSelected(selection: AcceptedBuildMetadataSelection): Promise<void> {
    const captured = captureSelection(selection);
    if (captured.expectedBytes === undefined) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    const selected: SelectedSlots = { current: captured.expectedBytes, next: undefined, backup: undefined };
    return this.runExclusive(async () => {
      try {
        await this.assertSelectedSlots(selected, captured.assertAuthority);
        await assertPrivateDirectory(dirname(this.filePath));
        captured.assertAuthority();
        await syncDirectory(dirname(this.filePath), true);
        await this.assertSelectedSlots(selected, captured.assertAuthority);
      } catch (error) { throw selectedMutationError(error); }
    });
  }

  private async writeSelected(
    validated: VersionedAcceptedBuildMetadata,
    selection: ReturnType<typeof captureSelection>,
  ): Promise<void> {
    const { assertAuthority } = selection;
    const selected: SelectedSlots = { current: selection.expectedBytes, next: undefined, backup: undefined };
    const content = Buffer.from(`${JSON.stringify(validated)}\n`, 'utf8');
    if (content.byteLength > maximumBytes) throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    const directory = dirname(this.filePath);
    try {
      await this.assertSelectedSlots(selected, assertAuthority);
      if (validated.formatVersion === 1 && selected.current !== undefined &&
          parseVersionedAcceptedBuildMetadata(JSON.parse(new TextDecoder('utf-8', { fatal: true })
            .decode(selected.current))).formatVersion === 2) {
        throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
      }
      assertAuthority();
      await mkdir(directory, { mode: 0o700, recursive: true });
      assertAuthority();
      await chmod(directory, 0o700);
      assertAuthority();
      await assertPrivateDirectory(directory);
      await this.assertSelectedSlots(selected, assertAuthority);
      assertAuthority();
      const file = await open(this.nextPath, 'wx', 0o600);
      await settleOwnedFile(file, async () => {
        assertAuthority();
        await file.writeFile(content);
        assertAuthority();
        await file.sync();
        assertAuthority();
      });
      selected.next = content;
      await this.assertSelectedSlots(selected, assertAuthority);
      if (selected.current !== undefined) {
        assertAuthority();
        await rename(this.filePath, this.backupPath);
        selected.backup = selected.current;
        selected.current = undefined;
        await this.assertSelectedSlots(selected, assertAuthority);
      }
      assertAuthority();
      await rename(this.nextPath, this.filePath);
      selected.current = content;
      selected.next = undefined;
      assertAuthority();
      await syncDirectory(directory, true);
      await this.assertSelectedSlots(selected, assertAuthority);
      if (selected.backup !== undefined) {
        assertAuthority();
        await unlink(this.backupPath);
        selected.backup = undefined;
        assertAuthority();
        await syncDirectory(directory, true);
      }
      await this.assertSelectedSlots(selected, assertAuthority);
    } catch (error) {
      // Interrupted slots belong to admission/recovery. A lost acknowledgement
      // must not restore an old acceptance or delete unexplained evidence.
      throw selectedMutationError(error);
    }
  }

  private async assertSelectedSlots(selected: SelectedSlots, assertAuthority: () => void): Promise<void> {
    const paths = { current: this.filePath, next: this.nextPath, backup: this.backupPath };
    const names = ['current', 'next', 'backup'] as const;
    const before: Record<typeof names[number], Awaited<ReturnType<typeof lstat>> | undefined> = {
      current: undefined, next: undefined, backup: undefined,
    };
    assertAuthority();
    for (const slot of names) {
      before[slot] = await optionalFileStat(paths[slot]);
      assertAuthority();
    }
    const actual = await this.inspectStoredSlots();
    assertAuthority();
    for (const slot of names) {
      const expected = selected[slot];
      const bytes = actual[slot]?.bytes;
      if (expected === undefined ? bytes !== undefined : bytes === undefined || !expected.equals(bytes)) {
        throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
      }
      const after = await optionalFileStat(paths[slot]);
      assertAuthority();
      const prior = before[slot];
      if (expected === undefined ? prior !== undefined || after !== undefined :
        prior === undefined || after === undefined || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1 ||
        prior.dev !== after.dev || prior.ino !== after.ino || prior.size !== after.size ||
        prior.mtimeMs !== after.mtimeMs || prior.ctimeMs !== after.ctimeMs) {
        throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
      }
    }
    assertAuthority();
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) throw new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    this.activeOperation = true;
    try { return await operation(); }
    finally { this.activeOperation = false; }
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

function captureSelection(selection: AcceptedBuildMetadataSelection) {
  if ((selection.expectedBytes !== undefined && (!(selection.expectedBytes instanceof Uint8Array) ||
      selection.expectedBytes.byteLength < 1 || selection.expectedBytes.byteLength > maximumBytes)) ||
      typeof selection.assertAuthority !== 'function') {
    throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
  }
  const authority = selection.assertAuthority;
  return {
    expectedBytes: selection.expectedBytes === undefined ? undefined : Buffer.from(selection.expectedBytes),
    assertAuthority() {
      const result: unknown = authority();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
      }
    },
  };
}

function selectedMutationError(error: unknown): Error {
  return error instanceof Error && error.message === 'ACCEPTED_BUILD_METADATA_INVALID'
    ? error : new Error('ACCEPTED_BUILD_METADATA_UNAVAILABLE', { cause: error });
}

async function optionalFileStat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path); }
  catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readMetadata(path: string): Promise<VersionedAcceptedBuildMetadata | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 ||
      metadata.size < 1 || metadata.size > maximumBytes) {
      throw new Error('ACCEPTED_BUILD_METADATA_INVALID');
    }
    return parseVersionedAcceptedBuildMetadata(JSON.parse(await readFile(path, 'utf8')));
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

async function syncDirectory(path: string, preserveFirstFailure = false): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  if (preserveFirstFailure) return settleOwnedFile(directory, () => directory.sync());
  try { await directory.sync(); } finally { await directory.close(); }
}

async function settleOwnedFile(file: FileHandle, operation: () => Promise<void>): Promise<void> {
  let firstFailure: { error: unknown } | undefined;
  try { await operation(); }
  catch (error) { firstFailure = { error }; }
  try { await file.close(); }
  catch (error) {
    if (firstFailure !== undefined) {
      throw new AggregateError([firstFailure.error, error], 'ACCEPTED_BUILD_METADATA_UNAVAILABLE', {
        cause: firstFailure.error,
      });
    }
    throw error;
  }
  if (firstFailure !== undefined) throw firstFailure.error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
