import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
  type CrashSafeByteSlotSelection,
  type ObservedRecoveryAuthority,
  type ObservedRecoverySelection,
} from '../persistence/crashSafeByteSlotStore.js';
import { CrashSafeFileSlotError, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceBackupImportJournalBytes } from './workspaceBackupImportJournalBytes.js';
import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY,
  WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE,
  WorkspaceBackupImportJournalStoreError,
  WorkspaceBackupImportJournalValidationError,
} from './workspaceBackupImportJournalError.js';
import {
  createNodeWorkspaceBackupImportJournalFileSystem,
  WorkspaceBackupImportJournalFileSystemError,
  type WorkspaceBackupImportJournalFileSystem,
} from './workspaceBackupImportJournalFileSystem.js';
import { createWorkspaceBackupImportJournalPaths } from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import type {
  WorkspaceBackupImportJournalStore as WorkspaceBackupImportJournalStorePort,
  WorkspaceBackupImportJournal,
  WorkspaceBackupImportOperationId,
} from './workspaceBackupImportTypes.js';
import {
  assertWorkspaceBackupImportJournalTransition,
  validateWorkspaceBackupImportJournal,
} from './workspaceBackupImportJournalValidation.js';

export interface WorkspaceBackupImportJournalStoreOptions {
  readonly installationRoot: string;
  readonly filePath: string;
  readonly fileSystem?: WorkspaceBackupImportJournalFileSystem;
}

export class WorkspaceBackupImportJournalStore
  implements WorkspaceBackupImportJournalStorePort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private readonly fileSystem: WorkspaceBackupImportJournalFileSystem;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceBackupImportJournalStoreOptions>) {
    const paths = createWorkspaceBackupImportJournalPaths(
      options.installationRoot,
      options.filePath,
    );
    const fileSystem = options.fileSystem ??
      createNodeWorkspaceBackupImportJournalFileSystem(paths);
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
    this.fileSystem = fileSystem;
  }

  inspectSlots(assertAuthority?: () => void): Promise<ReadOnlyJournalSlots<WorkspaceBackupImportJournal>> {
    return this.runExclusive(async () => {
      try {
        const result: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<WorkspaceBackupImportJournal>['current']> = {
          current: undefined, next: undefined, backup: undefined,
        };
        for (const slot of ['current', 'next', 'backup'] as const) {
          assertSynchronousAuthority(assertAuthority);
          let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
          const bytes = await this.fileSystem.readSlot(slot, value => { identity = value; });
          assertSynchronousAuthority(assertAuthority);
          if (bytes !== undefined) result[slot] = Object.freeze({ bytes: Uint8Array.from(bytes),
            value: parseWorkspaceBackupImportJournalBytes(bytes), ...(identity === undefined ? {} : { identity }) });
        }
        assertSynchronousAuthority(assertAuthority);
        return Object.freeze(result);
      } catch (error) { throw this.mapStoreError(error); }
    });
  }

  inspectRecoverySelection(assertAuthority: () => void) {
    return this.runExclusive(async () => {
      try {
        const selection = await this.byteStore.inspectRecoverySelection(assertAuthority);
        const value = selection.bytes === undefined ? undefined : parseWorkspaceBackupImportJournalBytes(selection.bytes);
        assertSynchronousAuthority(assertAuthority);
        return Object.freeze({ ...selection, value });
      } catch (error) { throw this.mapStoreError(error); }
    });
  }

  recoverObservedSelection(selection: ObservedRecoverySelection, authority: ObservedRecoveryAuthority) {
    return this.runExclusive(async () => {
      try {
        if (selection.bytes === undefined) throw new WorkspaceBackupImportJournalValidationError();
        parseWorkspaceBackupImportJournalBytes(selection.bytes);
        const receipt = await this.byteStore.recoverObservedSelection(selection, authority);
        return Object.freeze({ ...receipt, value: parseWorkspaceBackupImportJournalBytes(receipt.bytes) });
      } catch (error) { throw this.mapStoreError(error); }
    });
  }

  // These ports pin live writes without repairing or adopting another operation.
  writeSelected(value: unknown, selection: CrashSafeByteSlotSelection): Promise<Readonly<CrashSafeFileSlotIdentity>> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceBackupImportJournal(value);
      const current = this.selectedCurrent(selection, true);
      assertWorkspaceBackupImportJournalTransition(current, next);
      try { return await this.byteStore.replaceSelected(serializeWorkspaceBackupImportJournal(next), selection); }
      catch (error) { throw this.mapStoreError(error); }
    });
  }

  removeSelected(operationId: WorkspaceBackupImportOperationId, selection: CrashSafeByteSlotSelection): Promise<void> {
    return this.clearSelected(operationId, selection, true);
  }

  discardBeforePublicationSelected(operationId: WorkspaceBackupImportOperationId, selection: CrashSafeByteSlotSelection): Promise<void> {
    return this.clearSelected(operationId, selection, false);
  }

  read(): Promise<Readonly<WorkspaceBackupImportJournal> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceBackupImportJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceBackupImportJournalTransition(current, next);
      const bytes = serializeWorkspaceBackupImportJournal(next);
      try {
        await this.byteStore.replace(bytes, current !== undefined);
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  remove(operationId: WorkspaceBackupImportOperationId): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state !== 'registryPublished'
      ) {
        throw new WorkspaceBackupImportJournalValidationError();
      }
      await this.removeAllSlots();
    });
  }

  discardBeforePublication(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state === 'rootPublished' ||
        current.state === 'registryPublished'
      ) {
        throw new WorkspaceBackupImportJournalValidationError();
      }
      await this.removeAllSlots();
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceBackupImportJournal> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceBackupImportJournalBytes,
      );
    } catch (error) {
      throw this.mapStoreError(error);
    }
  }

  private selectedCurrent(selection: CrashSafeByteSlotSelection, allowAbsent: boolean) {
    if (selection.expectedSlots.next !== undefined || selection.expectedSlots.backup !== undefined) {
      throw new WorkspaceBackupImportJournalValidationError();
    }
    const bytes = selection.expectedSlots.current;
    if (bytes === undefined) {
      if (!allowAbsent) throw new WorkspaceBackupImportJournalValidationError();
      return undefined;
    }
    return parseWorkspaceBackupImportJournalBytes(bytes);
  }

  private clearSelected(operationId: WorkspaceBackupImportOperationId, selection: CrashSafeByteSlotSelection, completed: boolean): Promise<void> {
    return this.runExclusive(async () => {
      const current = this.selectedCurrent(selection, false)!;
      if (current.operationId !== operationId || (completed ? current.state !== 'registryPublished'
        : current.state === 'rootPublished' || current.state === 'registryPublished')) {
        throw new WorkspaceBackupImportJournalValidationError();
      }
      try { await this.byteStore.clearSelected(selection); }
      catch (error) { throw this.mapStoreError(error); }
    });
  }

  private async removeAllSlots(): Promise<void> {
    try {
      await this.byteStore.clear();
    } catch (error) {
      throw this.mapStoreError(error);
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new WorkspaceBackupImportJournalStoreError(
        WORKSPACE_BACKUP_IMPORT_JOURNAL_BUSY,
      );
    }
    this.activeOperation = true;
    try {
      return await operation();
    } finally {
      this.activeOperation = false;
    }
  }

  private mapStoreError(error: unknown): Error {
    if (
      error instanceof WorkspaceBackupImportJournalValidationError ||
      error instanceof WorkspaceBackupImportJournalStoreError
    ) {
      return error;
    }
    if (error instanceof WorkspaceBackupImportJournalFileSystemError) {
      return error.failure === 'invalid'
        ? new WorkspaceBackupImportJournalValidationError()
        : new WorkspaceBackupImportJournalStoreError(
            WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE,
          );
    }
    if (error instanceof CrashSafeFileSlotError) {
      return error.failure === 'invalid'
        ? new WorkspaceBackupImportJournalValidationError()
        : new WorkspaceBackupImportJournalStoreError(
            WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE,
          );
    }
    if (error instanceof CrashSafeByteSlotStoreError) {
      return new WorkspaceBackupImportJournalStoreError(
        WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE,
      );
    }
    return new WorkspaceBackupImportJournalStoreError(
      WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE,
    );
  }
}

function assertSynchronousAuthority(assertAuthority: (() => void) | undefined): void {
  if (assertAuthority === undefined) return;
  const result: unknown = assertAuthority();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw new WorkspaceBackupImportJournalValidationError();
  }
}
