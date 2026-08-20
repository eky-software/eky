import type {
  WorkspaceManagementCapability,
  WorkspaceManagementStatus,
} from '../../app/desktopWorkspaceManagement.js';

interface WorkspaceStatusLoadCallbacks {
  failed(): void;
  started(): void;
  succeeded(status: WorkspaceManagementStatus): void;
}

export class WorkspaceStatusLoadController {
  private activeLoad: Promise<void> | null = null;
  private generation = 0;

  load(
    capability: WorkspaceManagementCapability,
    callbacks: Readonly<WorkspaceStatusLoadCallbacks>,
  ): Promise<void> {
    if (this.activeLoad !== null) return this.activeLoad;

    const generation = this.generation;
    callbacks.started();
    let load!: Promise<void>;
    load = (async () => {
      try {
        const status = await capability.getStatus();
        if (this.generation === generation) callbacks.succeeded(status);
      } catch {
        if (this.generation === generation) callbacks.failed();
      } finally {
        if (this.activeLoad === load) this.activeLoad = null;
      }
    })();
    this.activeLoad = load;
    return load;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeLoad = null;
  }
}
