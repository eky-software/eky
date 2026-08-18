import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import { CrashSafeFileSlotError } from '../persistence/crashSafeFileSlot.js';
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
  WorkspaceBackupImportJournalV1,
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
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceBackupImportJournalStoreOptions>) {
    const paths = createWorkspaceBackupImportJournalPaths(
      options.installationRoot,
      options.filePath,
    );
    const fileSystem = options.fileSystem ??
      createNodeWorkspaceBackupImportJournalFileSystem(paths);
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
  }

  read(): Promise<Readonly<WorkspaceBackupImportJournalV1> | undefined> {
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
    Readonly<WorkspaceBackupImportJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceBackupImportJournalBytes,
      );
    } catch (error) {
      throw this.mapStoreError(error);
    }
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
