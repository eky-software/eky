export type WorkspaceMaintenancePurpose =
  | 'backup'
  | 'create'
  | 'import'
  | 'replace'
  | 'adopt'
  | 'rename'
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

export type WorkspaceMaintenanceState = 'idle' | 'busy';

export interface WorkspaceMaintenanceStateReader {
  readState(): WorkspaceMaintenanceState;
}

export class WorkspaceMaintenanceLeaseBusyError extends Error {
  constructor() {
    super('WORKSPACE_MAINTENANCE_BUSY');
    this.name = 'WorkspaceMaintenanceLeaseBusyError';
  }
}

export class InMemoryWorkspaceMaintenanceLease
  implements WorkspaceMaintenanceLease, WorkspaceMaintenanceStateReader {
  private held: Readonly<{
    purpose: WorkspaceMaintenancePurpose;
    handle: WorkspaceMaintenanceLeaseHandle;
  }> | undefined;

  readState(): WorkspaceMaintenanceState {
    return this.held ? 'busy' : 'idle';
  }

  captureCurrentOwner(allowedPurposes: readonly WorkspaceMaintenancePurpose[]): () => void {
    const owner = this.held;
    if (owner === undefined || !allowedPurposes.includes(owner.purpose)) {
      throw new WorkspaceMaintenanceLeaseBusyError();
    }
    return () => {
      if (this.held !== owner) throw new WorkspaceMaintenanceLeaseBusyError();
    };
  }

  async acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    if (this.held) {
      throw new WorkspaceMaintenanceLeaseBusyError();
    }
    const owner = Object.freeze({ purpose, handle: Object.freeze({
      release: async () => {
        if (this.held === owner) this.held = undefined;
      },
    }) });
    this.held = owner;
    return owner.handle;
  }
}
