import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';

export interface ActiveWorkspaceLifecyclePort {
  quiesceWrites(previousActiveWorkspaceId: WorkspaceId | null): Promise<void>;
  stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }>;
  /**
   * Leaves exactly one healthy owner for the previous workspace runtime.
   * Implementations must accept an already healthy runtime without starting
   * another owner.
   */
  ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void>;
}
