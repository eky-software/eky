export type WorkspaceMaintenancePurpose =
  | 'backup'
  | 'delete'
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

// Read freshness only; this observation never grants a maintenance lease.
export interface WorkspaceMaintenanceStatusObservation {
  readonly state: WorkspaceMaintenanceState;
  assertCurrent(): void;
}

export class WorkspaceMaintenanceLeaseBusyError extends Error {
  constructor() {
    super('WORKSPACE_MAINTENANCE_BUSY');
    this.name = 'WorkspaceMaintenanceLeaseBusyError';
  }
}

export class InMemoryWorkspaceMaintenanceLease
  implements WorkspaceMaintenanceLease, WorkspaceMaintenanceStateReader {
  private statusGeneration: object = {};
  private held: Readonly<{
    purpose: WorkspaceMaintenancePurpose;
    handle: WorkspaceMaintenanceLeaseHandle;
  }> | undefined;

  readState(): WorkspaceMaintenanceState {
    return this.held ? 'busy' : 'idle';
  }

  captureStatusObservation(): Readonly<WorkspaceMaintenanceStatusObservation> {
    const generation = this.statusGeneration;
    const state = this.readState();
    let current = true;
    return Object.freeze({ state, assertCurrent: () => {
      if (!current || generation !== this.statusGeneration) {
        current = false;
        throw new WorkspaceMaintenanceLeaseBusyError();
      }
    } });
  }

  captureCurrentOwner(
    allowedPurposes: readonly WorkspaceMaintenancePurpose[],
    expectedHandle?: WorkspaceMaintenanceLeaseHandle,
  ): () => void {
    const owner = this.held;
    if (owner === undefined || !allowedPurposes.includes(owner.purpose) ||
        (expectedHandle !== undefined && owner.handle !== expectedHandle)) {
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
        if (this.held === owner) {
          this.held = undefined;
          this.statusGeneration = {};
        }
      },
    }) });
    this.held = owner;
    this.statusGeneration = {};
    return owner.handle;
  }
}
