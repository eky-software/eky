import { isAbsolute, join, resolve } from 'node:path';

import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  createNodeCrashSafeFileSlotFileSystem,
  CrashSafeFileSlotError,
  type CrashSafeFileSlotFileSystem,
} from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import {
  assertWorkspaceSwitchTransition,
  maximumWorkspaceSwitchJournalBytes,
  parseWorkspaceSwitchJournalBytes,
  parseVersionedWorkspaceSwitchJournalBytes,
  serializeWorkspaceSwitchJournal,
  validateWorkspaceSwitchJournal,
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
          const bytes = await this.fileSystem.readSlot(slot);
          if (bytes !== undefined) {
            slots[slot] = Object.freeze({ bytes, value: parseVersionedWorkspaceSwitchJournalBytes(bytes) });
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
