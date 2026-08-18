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

export class WorkspaceMaintenanceLeaseBusyError extends Error {
  constructor() {
    super('WORKSPACE_MAINTENANCE_BUSY');
    this.name = 'WorkspaceMaintenanceLeaseBusyError';
  }
}

export class InMemoryWorkspaceMaintenanceLease
  implements WorkspaceMaintenanceLease {
  private held = false;

  async acquire(
    _purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    if (this.held) {
      throw new WorkspaceMaintenanceLeaseBusyError();
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
