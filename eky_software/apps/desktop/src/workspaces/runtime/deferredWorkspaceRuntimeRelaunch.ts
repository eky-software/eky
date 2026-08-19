export interface WorkspaceRuntimeRelaunchCompletion {
  complete(): void;
}

export class DeferredWorkspaceRuntimeRelaunch
  implements WorkspaceRuntimeRelaunchCompletion
{
  private requested = false;
  private completed = false;

  constructor(private readonly relaunchApplication: () => void) {}

  request(): void {
    if (!this.completed) this.requested = true;
  }

  complete(): void {
    if (!this.requested || this.completed) return;
    this.completed = true;
    this.relaunchApplication();
  }

  isRequested(): boolean {
    return this.requested;
  }
}
