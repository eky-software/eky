import { isAbsolute, join, resolve } from 'node:path';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  createNodeCrashSafeFileSlotFileSystem,
  CrashSafeFileSlotError,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity,
} from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { planWorkspaceSelectorSwitchSlots } from './workspaceSelectorSwitchSlots.js';
import { captureWorkspaceSelectorSwitchSelection, type WorkspaceSelectorSwitchSelection } from './workspaceSelectorSwitchSelection.js';
import {
  assertWorkspaceSwitchTransition,
  maximumWorkspaceSwitchJournalBytes,
  parseWorkspaceSwitchJournalBytes,
  parseVersionedWorkspaceSwitchJournalBytes,
  serializeWorkspaceSwitchJournal,
  serializeVersionedWorkspaceSwitchJournal,
  validateWorkspaceSwitchJournal,
  validateVersionedWorkspaceSwitchJournal,
  workspaceSwitchJournalFileName,
  type WorkspaceSwitchJournalV1,
  type WorkspaceSwitchJournal,
} from './workspaceSwitchJournalCodec.js';

export * from './workspaceSwitchJournalCodec.js';

export interface WorkspaceSwitchJournalPort {
  read(): Promise<Readonly<WorkspaceSwitchJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  clear(operationId: string): Promise<void>;
}

export interface WorkspaceSwitchJournalPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly directoryPath: string;
  readonly nextPath: string;
}

export function createWorkspaceSwitchJournalPaths(
  userDataRoot: string,
): Readonly<WorkspaceSwitchJournalPaths> {
  const root = requireAbsoluteRoot(userDataRoot);
  const directoryPath = join(root, 'workspace-state');
  const currentPath = join(directoryPath, workspaceSwitchJournalFileName);
  return Object.freeze({
    backupPath: `${currentPath}.backup`,
    currentPath,
    directoryPath,
    nextPath: `${currentPath}.next`,
  });
}

export class WorkspaceSwitchJournalStore implements WorkspaceSwitchJournalPort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private readonly fileSystem: CrashSafeFileSlotFileSystem;
  private activeOperation = false;

  constructor(userDataRoot: string) {
    const paths = createWorkspaceSwitchJournalPaths(userDataRoot);
    this.fileSystem = createNodeCrashSafeFileSlotFileSystem(
      paths, maximumWorkspaceSwitchJournalBytes,
    );
    this.byteStore = new CrashSafeByteSlotStore(this.fileSystem);
  }

  read(): Promise<Readonly<WorkspaceSwitchJournalV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  // Inspection never repairs slots or grants a selector mutation authority.
  inspectSlots(): Promise<ReadOnlyJournalSlots<WorkspaceSwitchJournal>> {
    return this.runExclusive(async () => {
      const slots: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<WorkspaceSwitchJournal>['current']> = {
        current: undefined, next: undefined, backup: undefined,
      };
      try {
        for (const slot of ['current', 'next', 'backup'] as const) {
          let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
          const bytes = await this.fileSystem.readSlot(slot, value => { identity = value; });
          if (bytes !== undefined) {
            slots[slot] = Object.freeze({ bytes, value: parseVersionedWorkspaceSwitchJournalBytes(bytes), ...(identity === undefined ? {} : { identity }) });
          }
        }
        return Object.freeze(slots);
      } catch (error) { throw mapStorageError(error); }
    });
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceSwitchJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceSwitchTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceSwitchJournal(next),
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
      if (current === undefined || current.operationId !== operationId) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw mapStorageError(error);
      }
    });
  }

  writeSelector(value: unknown, selection: WorkspaceSelectorSwitchSelection): Promise<void> {
    return this.runExclusive(async () => {
      const captured = captureWorkspaceSelectorSwitchSelection(selection);
      const next = validateVersionedWorkspaceSwitchJournal(value);
      if (next.formatVersion !== 2 || captured.journalSlots.next !== undefined || captured.journalSlots.backup !== undefined) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      assertWorkspaceSwitchTransition(captured.journalSlots.current?.value, next);
      const bytes = serializeVersionedWorkspaceSwitchJournal(next);
      planWorkspaceSelectorSwitchSlots({ ...captured.journalSlots, next: { value: next, bytes } }, captured.registrySlots);
      try { await this.byteStore.replaceSelected(bytes, captured.guard); }
      catch (error) { throw mapStorageError(error); }
    });
  }

  recoverSelector(selection: WorkspaceSelectorSwitchSelection): Promise<void> {
    return this.runExclusive(async () => {
      const captured = captureWorkspaceSelectorSwitchSelection(selection);
      const plan = planWorkspaceSelectorSwitchSlots(captured.journalSlots, captured.registrySlots);
      if (plan.mode === 'unpublishedPreparation' || plan.mode === 'recoveryRequired') {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      try { await this.byteStore.recoverSelected(captured.guard); }
      catch (error) { throw mapStorageError(error); }
    });
  }

  clearSelector(
    selection: WorkspaceSelectorSwitchSelection,
    terminal: Readonly<{ purpose: 'selectorReturn' | 'acceptedTarget'; assertCurrent(): void }>,
  ): Promise<void> {
    return this.runExclusive(async () => {
      const captured = captureWorkspaceSelectorSwitchSelection(selection);
      const plan = planWorkspaceSelectorSwitchSlots(captured.journalSlots, captured.registrySlots);
      if (captured.registrySlots.current === undefined || captured.registrySlots.next !== undefined || captured.registrySlots.backup !== undefined) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      if (terminal.purpose === 'selectorReturn'
        ? !['unpublishedPreparation', 'selectorUncommitted', 'selectorReturned'].includes(plan.mode)
        : terminal.purpose !== 'acceptedTarget' || plan.mode !== 'validateTarget') {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      const authority = captured.guard.assertAuthority;
      const assertTerminal = terminal.assertCurrent.bind(terminal);
      const guard = { ...captured.guard, assertAuthority() {
        authority();
        const result: unknown = assertTerminal();
        if (result !== undefined) {
          void Promise.resolve(result).catch(() => undefined);
          throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
        }
      } };
      try { await this.byteStore.clearSelected(guard); }
      catch (error) { throw mapStorageError(error); }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceSwitchJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceSwitchJournalBytes,
      );
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  private async runExclusive<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeOperation) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }
}

function requireAbsoluteRoot(value: string): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
  }
  return value;
}

function mapStorageError(error: unknown): WorkspaceSwitchError {
  if (error instanceof WorkspaceSwitchError) return error;
  if (
    error instanceof CrashSafeFileSlotError &&
    error.failure === 'invalid'
  ) {
    return new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  if (error instanceof CrashSafeByteSlotStoreError) {
    return new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
  }
  return new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
}
