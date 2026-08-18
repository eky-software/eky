import {
  WORKSPACE_REGISTRY_INVALID,
  WorkspaceRegistryValidationError,
} from './workspaceRegistryError.js';
import {
  createNodeWorkspaceRegistryFileSystem,
  WorkspaceRegistryFileSystemError,
  type WorkspaceRegistryFileSystem,
  type WorkspaceRegistryNextWriter,
} from './workspaceRegistryFileSystem.js';
import {
  createWorkspaceRegistryPaths,
  type WorkspaceRegistryPaths,
} from './workspaceRegistryPaths.js';
import { parseWorkspaceRegistryBytes } from './workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import {
  WORKSPACE_REGISTRY_BUSY,
  WORKSPACE_REGISTRY_UNAVAILABLE,
  WorkspaceRegistryStoreError,
} from './workspaceRegistryStoreError.js';
import type { LocalWorkspaceRegistryV1 } from './workspaceRegistryTypes.js';

export interface WorkspaceRegistryStoreOptions {
  readonly installationRoot: string;
  readonly filePath: string;
  readonly fileSystem?: WorkspaceRegistryFileSystem;
}

export class WorkspaceRegistryStore {
  private readonly paths: Readonly<WorkspaceRegistryPaths>;
  private readonly fileSystem: WorkspaceRegistryFileSystem;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceRegistryStoreOptions>) {
    this.paths = createWorkspaceRegistryPaths(
      options.installationRoot,
      options.filePath,
    );
    this.fileSystem = options.fileSystem ??
      createNodeWorkspaceRegistryFileSystem(this.paths);
  }

  read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const bytes = serializeWorkspaceRegistry(value);
      const current = await this.recoverAndRead();
      try {
        await this.fileSystem.prepareDirectory();
      } catch (error) {
        throw this.mapStoreError(error);
      }

      let writer: WorkspaceRegistryNextWriter | undefined;
      let currentMovedToBackup = false;
      let nextPublished = false;
      try {
        writer = await this.fileSystem.createNextWriter();
        const bytesWritten = await writer.write(bytes);
        if (bytesWritten !== bytes.byteLength) {
          throw new WorkspaceRegistryStoreError(
            WORKSPACE_REGISTRY_UNAVAILABLE,
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
          if (currentMovedToBackup) {
            await this.restoreBackupBestEffort();
          }
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

  private async recoverAndRead(): Promise<
    Readonly<LocalWorkspaceRegistryV1> | undefined
  > {
    try {
      const currentBytes = await this.fileSystem.readSlot('current');
      if (currentBytes !== undefined) {
        const current = parseWorkspaceRegistryBytes(currentBytes);
        const removedNext = await this.fileSystem.removeSlot('next');
        const removedBackup = await this.fileSystem.removeSlot('backup');
        if (removedNext || removedBackup) {
          await this.fileSystem.syncDirectory();
        }
        return current;
      }

      const backupBytes = await this.fileSystem.readSlot('backup');
      if (backupBytes !== undefined) {
        const backup = parseWorkspaceRegistryBytes(backupBytes);
        await this.fileSystem.removeSlot('next');
        await this.fileSystem.moveSlot('backup', 'current');
        await this.fileSystem.syncDirectory();
        return backup;
      }

      const nextBytes = await this.fileSystem.readSlot('next');
      if (nextBytes !== undefined) {
        const next = parseWorkspaceRegistryBytes(nextBytes);
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
      // Recovery remains deterministic on the next read from the backup slot.
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_BUSY);
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
      error instanceof WorkspaceRegistryValidationError ||
      error instanceof WorkspaceRegistryStoreError
    ) {
      return error;
    }
    if (error instanceof WorkspaceRegistryFileSystemError) {
      return error.failure === 'invalid'
        ? new WorkspaceRegistryValidationError()
        : new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
    }
    if (error instanceof Error && error.message === WORKSPACE_REGISTRY_INVALID) {
      return new WorkspaceRegistryValidationError();
    }
    return new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
  }
}
