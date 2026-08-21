import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import {
  CrashSafeFileSlotError,
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotFileSystem,
} from '../persistence/crashSafeFileSlot.js';
import {
  assertWorkspaceFirstStartMigrationJournalTransition,
  parseWorkspaceFirstStartMigrationJournalBytes,
  serializeWorkspaceFirstStartMigrationJournal,
  validateWorkspaceFirstStartMigrationJournal,
  WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES,
} from './workspaceFirstStartMigrationJournalCodec.js';
import {
  WorkspaceFirstStartMigrationJournalStoreError,
  WorkspaceFirstStartMigrationJournalValidationError,
} from './workspaceFirstStartMigrationJournalError.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from './workspaceFirstStartMigrationJournalPaths.js';
import type {
  WorkspaceFirstStartMigrationJournalPort,
  WorkspaceFirstStartMigrationJournalV1,
} from './workspaceFirstStartMigrationJournalTypes.js';

export interface WorkspaceFirstStartMigrationJournalStoreOptions {
  readonly userDataPath: string;
  readonly fileSystem?: CrashSafeFileSlotFileSystem;
}

export class WorkspaceFirstStartMigrationJournalStore
  implements WorkspaceFirstStartMigrationJournalPort {
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(
    options: Readonly<WorkspaceFirstStartMigrationJournalStoreOptions>,
  ) {
    const paths = createWorkspaceFirstStartMigrationJournalPaths(
      options.userDataPath,
    );
    const fileSystem =
      options.fileSystem ??
      createNodeCrashSafeFileSlotFileSystem(
        paths,
        WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES,
      );
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
  }

  read(): Promise<
    Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined
  > {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const next = validateWorkspaceFirstStartMigrationJournal(value);
      const current = await this.recoverAndRead();
      assertWorkspaceFirstStartMigrationJournalTransition(current, next);
      try {
        await this.byteStore.replace(
          serializeWorkspaceFirstStartMigrationJournal(next),
          current !== undefined,
        );
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  discardPrepared(operationId: string): Promise<void> {
    return this.removeMatching(operationId, 'prepared');
  }

  removeTransitioned(operationId: string): Promise<void> {
    return this.removeMatching(operationId, 'registryTransitioned');
  }

  private removeMatching(
    operationId: string,
    expectedState: 'prepared' | 'registryTransitioned',
  ): Promise<void> {
    return this.runExclusive(async () => {
      const current = await this.recoverAndRead();
      if (
        current === undefined ||
        current.operationId !== operationId ||
        current.state !== expectedState
      ) {
        throw new WorkspaceFirstStartMigrationJournalValidationError();
      }
      try {
        await this.byteStore.clear();
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(
        parseWorkspaceFirstStartMigrationJournalBytes,
      );
    } catch (error) {
      throw this.mapStoreError(error);
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new WorkspaceFirstStartMigrationJournalStoreError('busy');
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
      error instanceof WorkspaceFirstStartMigrationJournalValidationError ||
      error instanceof WorkspaceFirstStartMigrationJournalStoreError
    ) {
      return error;
    }
    if (error instanceof CrashSafeFileSlotError) {
      return error.failure === 'invalid'
        ? new WorkspaceFirstStartMigrationJournalValidationError()
        : new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
    }
    if (error instanceof CrashSafeByteSlotStoreError) {
      return new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
    }
    return new WorkspaceFirstStartMigrationJournalStoreError('unavailable');
  }
}
