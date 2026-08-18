import { EmptyWorkspaceCreationError } from './emptyWorkspaceCreationError.js';

export type WorkspaceMaintenancePurpose =
  | 'create'
  | 'import'
  | 'replace'
  | 'adopt'
  | 'switch'
  | 'update'
  | 'restore';

export interface WorkspaceMaintenanceLeaseHandle {
  release(): Promise<void>;
}

export interface WorkspaceMaintenanceLease {
  acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle>;
}

export class InMemoryWorkspaceMaintenanceLease
  implements WorkspaceMaintenanceLease {
  private held = false;

  async acquire(
    _purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    if (this.held) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_BUSY',
        'lease',
      );
    }
    this.held = true;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.held = false;
      },
    };
  }
}
