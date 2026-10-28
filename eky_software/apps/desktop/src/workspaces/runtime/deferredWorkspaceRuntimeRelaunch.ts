export interface WorkspaceRuntimeRelaunchCompletion {
  complete(assertCurrent?: () => void): void;
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

  complete(assertCurrent?: () => void): void {
    if (!this.requested || this.completed) return;
    // Burn the request before checking authority or invoking re-entrant callers.
    this.completed = true;
    const validation: unknown = assertCurrent?.();
    if (validation !== undefined) {
      void Promise.resolve(validation).catch(() => undefined);
      throw new Error('WORKSPACE_RELAUNCH_AUTHORITY_ASYNC');
    }
    this.relaunchApplication();
  }

  isRequested(): boolean {
    return this.requested;
  }
}
