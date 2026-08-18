import {
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotNextWriter,
} from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_MAX_BYTES } from './workspaceRegistryBytes.js';
import type { WorkspaceRegistryPaths } from './workspaceRegistryPaths.js';

export type WorkspaceRegistrySlot = CrashSafeFileSlot;
export type WorkspaceRegistryFileSystemFailure = 'invalid' | 'unavailable';

export class WorkspaceRegistryFileSystemError extends Error {
  constructor(readonly failure: WorkspaceRegistryFileSystemFailure) {
    super(
      failure === 'invalid'
        ? 'WORKSPACE_REGISTRY_INVALID'
        : 'WORKSPACE_REGISTRY_UNAVAILABLE',
    );
    this.name = 'WorkspaceRegistryFileSystemError';
  }
}

export type WorkspaceRegistryNextWriter = CrashSafeFileSlotNextWriter;
export type WorkspaceRegistryFileSystem = CrashSafeFileSlotFileSystem;

export function createNodeWorkspaceRegistryFileSystem(
  paths: Readonly<WorkspaceRegistryPaths>,
): WorkspaceRegistryFileSystem {
  return createNodeCrashSafeFileSlotFileSystem(
    paths,
    WORKSPACE_REGISTRY_MAX_BYTES,
  );
}
