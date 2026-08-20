export type WorkspaceManagementRecoveryState =
  | 'clear'
  | 'recoveryRequired';

export class WorkspaceManagementRecoveryRequiredError extends Error {
  constructor() {
    super('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    this.name = 'WorkspaceManagementRecoveryRequiredError';
  }
}

export interface WorkspaceManagementOperationGuard {
  assertNoUnresolvedOperations(): Promise<void>;
  readRecoveryState(): Promise<WorkspaceManagementRecoveryState>;
}
