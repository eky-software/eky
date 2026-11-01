import { isAbsolute, join, resolve } from 'node:path';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
  type CrashSafeByteSlotSelection,
  type ObservedRecoveryAuthority,
  type ObservedRecoverySelection,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  createNodeCrashSafeFileSlotFileSystem,
  CrashSafeFileSlotError,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity,
} from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceTimestamp } from '../registry/workspaceTimestampValidation.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { captureWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { assertNoDuplicateWorkspaceLegacyAdoptionJournalKeys } from './workspaceLegacyAdoptionJournalDuplicateKeys.js';

export const maximumWorkspaceLegacyAdoptionJournalBytes = 4_096;
export const workspaceLegacyAdoptionJournalFileName =
  'workspace-adoption-v1.json';
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type WorkspaceLegacyAdoptionSourceKind = 'fresh' | 'legacy';
export type WorkspaceLegacyAdoptionJournalState =
  | 'prepared'
  | 'candidatePrepared'
  | 'rootPublished'
  | 'registryPublished'
  | 'recoveryRequired';

export interface WorkspaceLegacyAdoptionJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: string;
  readonly workspaceId: WorkspaceId;
  readonly sourceKind: WorkspaceLegacyAdoptionSourceKind;
  readonly state: WorkspaceLegacyAdoptionJournalState;
  readonly createdAt: string;
}

export interface WorkspaceLegacyAdoptionJournalPort {
  read(): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  clear(operationId: string): Promise<void>;
}

export interface WorkspaceLegacyAdoptionJournalPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly directoryPath: string;
  readonly nextPath: string;
}

export function createWorkspaceLegacyAdoptionJournalPaths(
  userDataRoot: string,
): Readonly<WorkspaceLegacyAdoptionJournalPaths> {
  const root = requireAbsoluteRoot(userDataRoot);
  const directoryPath = join(root, 'workspace-state');
  const currentPath = join(
    directoryPath,
    workspaceLegacyAdoptionJournalFileName,
  );
  return Object.freeze({
    backupPath: `${currentPath}.backup`,
    currentPath,
    directoryPath,
    nextPath: `${currentPath}.next`,
  });
}

export class WorkspaceLegacyAdoptionJournalStore
  implements WorkspaceLegacyAdoptionJournalPort
{
  private readonly byteStore: CrashSafeByteSlotStore;
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private activeOperation = false;

  constructor(userDataRoot: string, fileSystem?: CrashSafeFileSlotFileSystem) {
    const paths = createWorkspaceLegacyAdoptionJournalPaths(userDataRoot);
    this.fileSystem = fileSystem ?? createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceLegacyAdoptionJournalBytes);
    this.byteStore = new CrashSafeByteSlotStore(this.fileSystem);
  }

  inspectSlots(assertAuthority: () => void): Promise<ReadOnlyJournalSlots<WorkspaceLegacyAdoptionJournalV1>> {
    return this.runExclusive(async () => {
      const check = checkedAdoptionAuthority(assertAuthority);
      const slots: Record<'current' | 'backup' | 'next', ReadOnlyJournalSlots<WorkspaceLegacyAdoptionJournalV1>['current']> = {
        current: undefined, backup: undefined, next: undefined,
      };
      for (const slot of ['current', 'backup', 'next'] as const) {
        check();
        let identity: CrashSafeFileSlotIdentity | undefined;
        const bytes = await this.fileSystem.readSlot(slot, value => { identity = value; });
        check();
        if (bytes !== undefined) {
          if (identity === undefined) invalid();
          slots[slot] = Object.freeze({ bytes: Uint8Array.from(bytes), identity: Object.freeze({ ...identity }),
            value: parseWorkspaceLegacyAdoptionJournalBytes(bytes) });
        }
      }
      return Object.freeze(slots);
    });
  }

  // Only deletion of the bound company's complete payload can retire a nonterminal adoption journal.
  clearAfterDeletionPurged(bindingValue: unknown, selection: CrashSafeByteSlotSelection & ObservedRecoveryAuthority & {
    assertDeletionPurged(): Promise<void>;
  }): Promise<void> {
    return this.runExclusive(async () => {
      const { expectedSlots: slots, expectedIdentities: identities } = captureWorkspaceLegacyAdoptionDeletionSlots(bindingValue, selection);
      const check = checkedAdoptionAuthority(selection.assertAuthority.bind(selection));
      const external = selection.assertExternalSelection.bind(selection), purged = selection.assertDeletionPurged.bind(selection);
      const uncertain = selection.onUncertain.bind(selection);
      let failed = false;
      let firstFailure: unknown;
      const retain = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } return firstFailure; };
      const assertAuthority = () => { if (failed) throw firstFailure; try { check(); } catch (error) { throw retain(error); } };
      const assertExternalSelection = async () => {
        try { assertAuthority(); await external(); assertAuthority(); await purged(); assertAuthority(); await external(); assertAuthority(); }
        catch (error) { throw retain(error); }
      };
      try {
        await this.byteStore.clearSelected({ expectedSlots: slots, expectedIdentities: identities, assertAuthority, assertExternalSelection });
        assertAuthority();
      }
      catch (error) {
        const original = failed ? firstFailure : error;
        try { const result: unknown = uncertain(original); if (result !== undefined) void Promise.resolve(result).catch(() => undefined); }
        catch { /* Preserve the original cleanup failure. */ }
        if (failed) throw firstFailure;
        throw mapStorageError(error);
      }
    });
  }

  inspectRecoverySelection(assertAuthority: () => void) {
    return this.runExclusive(async () => {
      try {
        const selection = await this.byteStore.inspectRecoverySelection(assertAuthority);
        const value = selection.bytes === undefined ? undefined : parseWorkspaceLegacyAdoptionJournalBytes(selection.bytes);
        return Object.freeze({ ...selection, value });
      } catch (error) { throw mapStorageError(error); }
    });
  }

  recoverObservedSelection(selection: ObservedRecoverySelection, authority: ObservedRecoveryAuthority) {
    return this.runExclusive(async () => {
      try {
        if (selection.bytes === undefined) throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
        parseWorkspaceLegacyAdoptionJournalBytes(selection.bytes);
        const receipt = await this.byteStore.recoverObservedSelection(selection, authority);
        return Object.freeze({ ...receipt, value: parseWorkspaceLegacyAdoptionJournalBytes(receipt.bytes) });
      } catch (error) { throw mapStorageError(error); }
    });
  }

  writeSelected(value: unknown, selection: CrashSafeByteSlotSelection & ObservedRecoveryAuthority) {
    return this.runSelected(selection, async () => {
      const next = validateWorkspaceLegacyAdoptionJournal(value);
      assertWorkspaceLegacyAdoptionTransition(this.selectedCurrent(selection), next);
      return this.byteStore.replaceSelected(serializeWorkspaceLegacyAdoptionJournal(next), selection);
    });
  }

  clearSelected(operationId: string, selection: CrashSafeByteSlotSelection & ObservedRecoveryAuthority): Promise<void> {
    return this.runSelected(selection, async () => {
      if (this.selectedCurrent(selection)?.operationId !== operationId) {
        throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
      }
      await this.byteStore.clearSelected(selection);
    });
  }

  // Only the recovery owner may supply the binding, absent-registry and
  // payload-absence authority. Ordinary writes retain the terminal transition.
  prepareRecoveredSelection(selection: CrashSafeByteSlotSelection & ObservedRecoveryAuthority) {
    return this.runSelected(selection, async () => {
      const current = this.selectedCurrent(selection);
      if (current?.state !== 'recoveryRequired' || current.sourceKind !== 'legacy') {
        throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
      }
      return this.byteStore.replaceSelected(serializeWorkspaceLegacyAdoptionJournal({ ...current, state: 'prepared' }), selection);
    });
  }

  read(): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceLegacyAdoptionJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceLegacyAdoptionTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceLegacyAdoptionJournal(next),
          current !== undefined,
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  clear(operationId: string): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (current?.operationId !== operationId) {
        throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceLegacyAdoptionJournalBytes,
      );
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  private selectedCurrent(selection: CrashSafeByteSlotSelection) {
    if (selection.expectedSlots.next !== undefined || selection.expectedSlots.backup !== undefined) {
      throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
    }
    const bytes = selection.expectedSlots.current;
    return bytes === undefined ? undefined : parseWorkspaceLegacyAdoptionJournalBytes(bytes);
  }

  private runSelected<Result>(selection: ObservedRecoveryAuthority, operation: () => Promise<Result>): Promise<Result> {
    const onUncertain = selection.onUncertain.bind(selection);
    return this.runExclusive(async () => {
      try { return await operation(); }
      catch (error) {
        try {
          const result: unknown = onUncertain(error);
          if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
        } catch { /* Preserve the original failure. */ }
        throw mapStorageError(error);
      }
    });
  }

  private async runExclusive<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeOperation) {
      throw new WorkspaceLegacyAdoptionError(
        'WORKSPACE_ADOPTION_STORAGE_FAILED',
      );
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }
}

// Pure journal-state capture; callers still own current file, target and lifecycle proof.
export function captureWorkspaceLegacyAdoptionDeletionSlots(
  bindingValue: unknown, selection: Pick<CrashSafeByteSlotSelection, 'expectedSlots' | 'expectedIdentities'>,
) {
  const binding = captureWorkspaceRemnantBinding(bindingValue);
  if (binding.owner !== 'workspaceLegacyAdoption') invalid();
  const slots: Record<'current' | 'backup' | 'next', Uint8Array | undefined> = { current: undefined, backup: undefined, next: undefined };
  const identities: Record<'current' | 'backup' | 'next', Readonly<CrashSafeFileSlotIdentity> | undefined> = {
    current: undefined, backup: undefined, next: undefined,
  };
  let previous: Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined;
  let count = 0;
  for (const slot of ['backup', 'current', 'next'] as const) {
    const supplied = selection.expectedSlots[slot];
    if (supplied === undefined) { if (selection.expectedIdentities[slot] !== undefined) invalid(); continue; }
    if (!(supplied instanceof Uint8Array)) invalid();
    const bytes = Uint8Array.from(supplied), journal = parseWorkspaceLegacyAdoptionJournalBytes(bytes);
    const identity = selection.expectedIdentities?.[slot];
    if (identity === undefined || journal.operationId !== binding.operationId || journal.workspaceId !== binding.workspaceId ||
        journal.sourceKind !== 'legacy') invalid();
    if (previous !== undefined) {
      if (previous.state === 'recoveryRequired' && previous.sourceKind === 'legacy' && journal.state === 'prepared') {
        assertWorkspaceLegacyAdoptionTransition({ ...previous, state: 'prepared' }, journal);
      } else assertWorkspaceLegacyAdoptionTransition(previous, journal);
    }
    previous = journal;
    slots[slot] = bytes; identities[slot] = Object.freeze({ ...identity });
    count++;
  }
  if (count > 2) invalid();
  return { expectedSlots: slots, expectedIdentities: identities };
}

export function validateWorkspaceLegacyAdoptionJournal(
  value: unknown,
): Readonly<WorkspaceLegacyAdoptionJournalV1> {
  try {
    requirePlainRecord(value);
    requireExactKeys(value, [
      'formatVersion',
      'operationId',
      'workspaceId',
      'sourceKind',
      'state',
      'createdAt',
    ]);
    if (
      value.formatVersion !== 1 ||
      typeof value.operationId !== 'string' ||
      !operationIdPattern.test(value.operationId) ||
      !isSourceKind(value.sourceKind) ||
      !isJournalState(value.state)
    ) {
      throw new Error('invalid');
    }
    return Object.freeze({
      formatVersion: 1,
      operationId: value.operationId,
      workspaceId: validateWorkspaceId(value.workspaceId),
      sourceKind: value.sourceKind,
      state: value.state,
      createdAt: validateWorkspaceTimestamp(value.createdAt),
    });
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

export function serializeWorkspaceLegacyAdoptionJournal(
  value: unknown,
): Uint8Array {
  const journal = validateWorkspaceLegacyAdoptionJournal(value);
  return new TextEncoder().encode(
    `${JSON.stringify({
      formatVersion: journal.formatVersion,
      operationId: journal.operationId,
      workspaceId: journal.workspaceId,
      sourceKind: journal.sourceKind,
      state: journal.state,
      createdAt: journal.createdAt,
    })}\n`,
  );
}

export function parseWorkspaceLegacyAdoptionJournalBytes(
  bytes: Uint8Array,
): Readonly<WorkspaceLegacyAdoptionJournalV1> {
  try {
    if (bytes.byteLength < 1 || bytes.byteLength > maximumWorkspaceLegacyAdoptionJournalBytes) {
      throw new Error('invalid');
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assertNoDuplicateWorkspaceLegacyAdoptionJournalKeys(source);
    const parsed = validateWorkspaceLegacyAdoptionJournal(JSON.parse(source));
    if (!bytesEqual(bytes, serializeWorkspaceLegacyAdoptionJournal(parsed))) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

export function assertWorkspaceLegacyAdoptionTransition(
  current: Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined,
  next: Readonly<WorkspaceLegacyAdoptionJournalV1>,
): void {
  if (current === undefined) {
    if (next.state !== 'prepared') invalid();
    return;
  }
  if (
    current.operationId !== next.operationId ||
    current.workspaceId !== next.workspaceId ||
    current.sourceKind !== next.sourceKind ||
    current.createdAt !== next.createdAt
  ) {
    invalid();
  }
  const transitions: Readonly<
    Record<
      WorkspaceLegacyAdoptionJournalState,
      readonly WorkspaceLegacyAdoptionJournalState[]
    >
  > = {
    prepared: ['prepared', 'candidatePrepared', 'recoveryRequired'],
    candidatePrepared: [
      'candidatePrepared',
      'rootPublished',
      'recoveryRequired',
    ],
    rootPublished: [
      'rootPublished',
      'registryPublished',
      'recoveryRequired',
    ],
    registryPublished: ['registryPublished', 'recoveryRequired'],
    recoveryRequired: ['recoveryRequired'],
  };
  if (!transitions[current.state].includes(next.state)) invalid();
}

function requireAbsoluteRoot(value: string): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
  }
  return value;
}

function requirePlainRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('invalid');
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    keys.length !== required.length ||
    keys.some((key, index) => key !== required[index])
  ) {
    throw new Error('invalid');
  }
}

function isSourceKind(value: unknown): value is WorkspaceLegacyAdoptionSourceKind {
  return value === 'fresh' || value === 'legacy';
}

function isJournalState(
  value: unknown,
): value is WorkspaceLegacyAdoptionJournalState {
  return (
    value === 'prepared' ||
    value === 'candidatePrepared' ||
    value === 'rootPublished' ||
    value === 'registryPublished' ||
    value === 'recoveryRequired'
  );
}

function checkedAdoptionAuthority(assertCurrent: () => void): () => void {
  return () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); invalid(); }
  };
}

function invalid(): never {
  throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function mapStorageError(error: unknown): WorkspaceLegacyAdoptionError {
  if (error instanceof WorkspaceLegacyAdoptionError) return error;
  if (error instanceof CrashSafeFileSlotError) {
    return new WorkspaceLegacyAdoptionError(
      error.failure === 'invalid'
        ? 'WORKSPACE_ADOPTION_INVALID'
        : 'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
  }
  if (error instanceof CrashSafeByteSlotStoreError) {
    return new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_STORAGE_FAILED',
    );
  }
  return new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_STORAGE_FAILED');
}
