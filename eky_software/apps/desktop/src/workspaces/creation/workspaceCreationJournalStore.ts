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
  type WorkspaceCreationJournalNextWriter,
} from './workspaceCreationJournalFileSystem.js';
import {
  createWorkspaceCreationJournalPaths,
  type WorkspaceCreationJournalPaths,
} from './workspaceCreationJournalPaths.js';
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
  private readonly paths: Readonly<WorkspaceCreationJournalPaths>;
  private readonly fileSystem: WorkspaceCreationJournalFileSystem;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceCreationJournalStoreOptions>) {
    this.paths = createWorkspaceCreationJournalPaths(
      options.installationRoot,
      options.filePath,
    );
    this.fileSystem = options.fileSystem ??
      createNodeWorkspaceCreationJournalFileSystem(this.paths);
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
        await this.fileSystem.prepareDirectory();
      } catch (error) {
        throw this.mapStoreError(error);
      }

      let writer: WorkspaceCreationJournalNextWriter | undefined;
      let currentMovedToBackup = false;
      let nextPublished = false;
      try {
        writer = await this.fileSystem.createNextWriter();
        const bytesWritten = await writer.write(bytes);
        if (bytesWritten !== bytes.byteLength) {
          throw new WorkspaceCreationJournalStoreError(
            WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
          );
        }
        await writer.sync();
        await writer.close();
        writer = undefined;

        if (current !== undefined) {
          await this.fileSystem.moveSlot('current', 'backup');
          currentMovedToBackup = true;
        }
        try {
          await this.fileSystem.moveSlot('next', 'current');
          nextPublished = true;
        } catch (error) {
          if (currentMovedToBackup) await this.restoreBackupBestEffort();
          throw error;
        }
        await this.fileSystem.syncDirectory();
        if (currentMovedToBackup) {
          await this.fileSystem.removeSlot('backup');
          await this.fileSystem.syncDirectory();
        }
      } catch (error) {
        throw this.mapStoreError(error);
      } finally {
        await writer?.close().catch(() => undefined);
        if (!nextPublished) {
          await this.fileSystem.removeSlot('next').catch(() => undefined);
        }
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
      const currentBytes = await this.fileSystem.readSlot('current');
      if (currentBytes !== undefined) {
        const current = parseWorkspaceCreationJournalBytes(currentBytes);
        const removedNext = await this.fileSystem.removeSlot('next');
        const removedBackup = await this.fileSystem.removeSlot('backup');
        if (removedNext || removedBackup) await this.fileSystem.syncDirectory();
        return current;
      }

      const backupBytes = await this.fileSystem.readSlot('backup');
      if (backupBytes !== undefined) {
        const backup = parseWorkspaceCreationJournalBytes(backupBytes);
        await this.fileSystem.removeSlot('next');
        await this.fileSystem.moveSlot('backup', 'current');
        await this.fileSystem.syncDirectory();
        return backup;
      }

      const nextBytes = await this.fileSystem.readSlot('next');
      if (nextBytes !== undefined) {
        const next = parseWorkspaceCreationJournalBytes(nextBytes);
        await this.fileSystem.moveSlot('next', 'current');
        await this.fileSystem.syncDirectory();
        return next;
      }
      return undefined;
    } catch (error) {
      throw this.mapStoreError(error);
    }
  }

  private async restoreBackupBestEffort(): Promise<void> {
    try {
      await this.fileSystem.moveSlot('backup', 'current');
      await this.fileSystem.syncDirectory();
    } catch {
      // The next read deterministically recovers from the backup slot.
    }
  }

  private async removeAllSlots(): Promise<void> {
    try {
      await this.fileSystem.removeSlot('next');
      await this.fileSystem.removeSlot('backup');
      await this.fileSystem.removeSlot('current');
      await this.fileSystem.syncDirectory();
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
    return new WorkspaceCreationJournalStoreError(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
  }
}
