import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';

export interface ActiveWorkspaceLifecyclePort {
  quiesceWrites(previousActiveWorkspaceId: WorkspaceId | null): Promise<void>;
  stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }>;
  restartPreviousWorkspace(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void>;
}
