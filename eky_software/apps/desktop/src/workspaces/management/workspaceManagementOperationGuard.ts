export type WorkspaceManagementRecoveryState =
  | 'clear'
  | 'recoveryRequired';

export class WorkspaceManagementRecoveryRequiredError extends Error {
  constructor(options?: ErrorOptions) {
    super('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', options);
    this.name = 'WorkspaceManagementRecoveryRequiredError';
  }
}

export interface WorkspaceManagementOperationGuard {
  assertNoUnresolvedOperations(): Promise<void>;
  readRecoveryState(): Promise<WorkspaceManagementRecoveryState>;
}
