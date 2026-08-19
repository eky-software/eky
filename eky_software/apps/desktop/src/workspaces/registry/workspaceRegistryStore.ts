import {
  WORKSPACE_REGISTRY_INVALID,
  WorkspaceRegistryValidationError,
} from './workspaceRegistryError.js';
import {
  createNodeWorkspaceRegistryFileSystem,
  WorkspaceRegistryFileSystemError,
  type WorkspaceRegistryFileSystem,
} from './workspaceRegistryFileSystem.js';
import {
  createWorkspaceRegistryPaths,
} from './workspaceRegistryPaths.js';
import {
  CrashSafeByteSlotStore,
  CrashSafeByteSlotStoreError,
} from '../persistence/crashSafeByteSlotStore.js';
import { CrashSafeFileSlotError } from '../persistence/crashSafeFileSlot.js';
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
  private readonly byteStore: CrashSafeByteSlotStore;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceRegistryStoreOptions>) {
    const paths = createWorkspaceRegistryPaths(
      options.installationRoot,
      options.filePath,
    );
    const fileSystem = options.fileSystem ??
      createNodeWorkspaceRegistryFileSystem(paths);
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
  }

  read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const bytes = serializeWorkspaceRegistry(value);
      const current = await this.recoverAndRead();
      try {
        await this.byteStore.replace(bytes, current !== undefined);
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<LocalWorkspaceRegistryV1> | undefined
  > {
    try {
      return await this.byteStore.recoverAndRead(parseWorkspaceRegistryBytes);
    } catch (error) {
      throw this.mapStoreError(error);
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
    if (error instanceof CrashSafeFileSlotError) {
      return error.failure === 'invalid'
        ? new WorkspaceRegistryValidationError()
        : new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
    }
    if (error instanceof CrashSafeByteSlotStoreError) {
      return new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
    }
    if (error instanceof Error && error.message === WORKSPACE_REGISTRY_INVALID) {
      return new WorkspaceRegistryValidationError();
    }
    return new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
  }
}
