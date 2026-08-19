import {
  WORKSPACE_CREATION_JOURNAL_BUSY,
  WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
  WorkspaceCreationJournalStoreError,
  WorkspaceCreationJournalValidationError,
} from './workspaceCreationJournalError.js';
import {
  createNodeWorkspaceCreationJournalFileSystem,
  WorkspaceCreationJournalFileSystemError,
  type WorkspaceCreationJournalFileSystem,
} from './workspaceCreationJournalFileSystem.js';
import {
  createWorkspaceCreationJournalPaths,
} from './workspaceCreationJournalPaths.js';
import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import { CrashSafeFileSlotError } from '../persistence/crashSafeFileSlot.js';
import { parseWorkspaceCreationJournalBytes } from './workspaceCreationJournalBytes.js';
import { serializeWorkspaceCreationJournal } from './workspaceCreationJournalSerializer.js';
import type {
  WorkspaceCreationJournalStore as WorkspaceCreationJournalStorePort,
  WorkspaceCreationJournalV1,
  WorkspaceCreationOperationId,
} from './workspaceCreationTypes.js';
import {
  assertWorkspaceCreationJournalTransition,
  validateWorkspaceCreationJournal,
} from './workspaceCreationJournalValidation.js';

export interface WorkspaceCreationJournalStoreOptions {
  readonly installationRoot: string;
  readonly filePath: string;
  readonly fileSystem?: WorkspaceCreationJournalFileSystem;
}

export class WorkspaceCreationJournalStore
  implements WorkspaceCreationJournalStorePort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceCreationJournalStoreOptions>) {
    const paths = createWorkspaceCreationJournalPaths(
      options.installationRoot,
      options.filePath,
    );
    const fileSystem = options.fileSystem ??
      createNodeWorkspaceCreationJournalFileSystem(paths);
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
  }

  read(): Promise<Readonly<WorkspaceCreationJournalV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceCreationJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceCreationJournalTransition(current, next);
      const bytes = serializeWorkspaceCreationJournal(next);
      try {
        await this.byteStore.replace(bytes, current !== undefined);
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  remove(operationId: WorkspaceCreationOperationId): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state !== 'registryPublished'
      ) {
        throw new WorkspaceCreationJournalValidationError();
      }
      await this.removeAllSlots();
    });
  }

  discardBeforePublication(
    operationId: WorkspaceCreationOperationId,
  ): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state === 'rootPublished' ||
        current.state === 'registryPublished'
      ) {
        throw new WorkspaceCreationJournalValidationError();
      }
      await this.removeAllSlots();
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceCreationJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceCreationJournalBytes,
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
      throw new WorkspaceCreationJournalStoreError(
        WORKSPACE_CREATION_JOURNAL_BUSY,
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
      error instanceof WorkspaceCreationJournalValidationError ||
      error instanceof WorkspaceCreationJournalStoreError
    ) {
      return error;
    }
    if (error instanceof WorkspaceCreationJournalFileSystemError) {
      return error.failure === 'invalid'
        ? new WorkspaceCreationJournalValidationError()
        : new WorkspaceCreationJournalStoreError(
            WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
          );
    }
    if (error instanceof CrashSafeFileSlotError) {
      return error.failure === 'invalid'
        ? new WorkspaceCreationJournalValidationError()
        : new WorkspaceCreationJournalStoreError(
            WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
          );
    }
    if (error instanceof CrashSafeByteSlotStoreError) {
      return new WorkspaceCreationJournalStoreError(
        WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
      );
    }
    return new WorkspaceCreationJournalStoreError(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
  }
}
