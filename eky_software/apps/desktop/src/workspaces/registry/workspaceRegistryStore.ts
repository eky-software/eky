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
  type CrashSafeByteSlotSelection,
} from '../persistence/crashSafeByteSlotStore.js';
import { CrashSafeFileSlotError, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from './workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from './workspaceRegistrySerializer.js';
import {
  WORKSPACE_REGISTRY_BUSY,
  WORKSPACE_REGISTRY_UNAVAILABLE,
  WorkspaceRegistryStoreError,
} from './workspaceRegistryStoreError.js';
import type { LocalWorkspaceRegistry } from './workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from './workspaceRegistryValidation.js';

export interface WorkspaceRegistryStoreOptions {
  readonly installationRoot: string;
  readonly filePath: string;
  readonly fileSystem?: WorkspaceRegistryFileSystem;
}

export class WorkspaceRegistryStore {
  private readonly byteStore: CrashSafeByteSlotStore;
  private readonly fileSystem: WorkspaceRegistryFileSystem;
  private activeOperation = false;

  constructor(options: Readonly<WorkspaceRegistryStoreOptions>) {
    const paths = createWorkspaceRegistryPaths(
      options.installationRoot,
      options.filePath,
    );
    const fileSystem = options.fileSystem ??
      createNodeWorkspaceRegistryFileSystem(paths);
    this.fileSystem = fileSystem;
    this.byteStore = new CrashSafeByteSlotStore(fileSystem);
  }

  read(): Promise<Readonly<LocalWorkspaceRegistry> | undefined> {
    return this.runExclusive(() => this.recoverAndRead());
  }

  inspect(): Promise<Readonly<LocalWorkspaceRegistry> | undefined> {
    return this.runExclusive(async () => {
      try {
        const selected = await this.byteStore.inspect(parseWorkspaceRegistryBytes);
        return selected?.value;
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  inspectSlots(): Promise<ReadOnlyJournalSlots<LocalWorkspaceRegistry>> {
    return this.runExclusive(async () => {
      try {
        const result: Record<'current' | 'next' | 'backup',
          ReadOnlyJournalSlots<LocalWorkspaceRegistry>['current']> = {
          current: undefined, next: undefined, backup: undefined,
        };
        for (const slot of ['current', 'next', 'backup'] as const) {
          let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
          const bytes = await this.fileSystem.readSlot(slot, value => { identity = value; });
          if (bytes !== undefined) {
            result[slot] = Object.freeze({ bytes, value: parseWorkspaceRegistryBytes(bytes), ...(identity === undefined ? {} : { identity }) });
          }
        }
        return Object.freeze(result);
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  write(value: unknown): Promise<void> {
    return this.runExclusive(async () => {
      const registry = validateWorkspaceRegistry(value);
      const bytes = serializeWorkspaceRegistry(registry);
      const current = await this.recoverAndRead();
      if (current?.formatVersion === 2 && registry.formatVersion === 1) {
        throw new WorkspaceRegistryValidationError();
      }
      try {
        await this.byteStore.replace(bytes, current !== undefined);
      } catch (error) {
        throw this.mapStoreError(error);
      }
    });
  }

  writeSelected(value: unknown, selection: CrashSafeByteSlotSelection): Promise<Readonly<CrashSafeFileSlotIdentity>> {
    return this.runExclusive(async () => {
      const registry = validateWorkspaceRegistry(value);
      try {
        for (const bytes of Object.values(selection.expectedSlots)) {
          if (bytes !== undefined && parseWorkspaceRegistryBytes(bytes).formatVersion === 2 && registry.formatVersion === 1) {
            throw new WorkspaceRegistryValidationError();
          }
        }
        return await this.byteStore.replaceSelected(serializeWorkspaceRegistry(registry), selection);
      } catch (error) { throw this.mapStoreError(error); }
    });
  }

  recoverSelected(selection: CrashSafeByteSlotSelection): Promise<Readonly<CrashSafeFileSlotIdentity>> {
    return this.runExclusive(async () => {
      try {
        for (const bytes of Object.values(selection.expectedSlots)) {
          if (bytes !== undefined) parseWorkspaceRegistryBytes(bytes);
        }
        return await this.byteStore.recoverSelected(selection);
      } catch (error) { throw this.mapStoreError(error); }
    });
  }

  private async recoverAndRead(): Promise<
    Readonly<LocalWorkspaceRegistry> | undefined
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
