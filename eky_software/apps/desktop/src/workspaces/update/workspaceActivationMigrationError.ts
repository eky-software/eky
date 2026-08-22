export type WorkspaceActivationMigrationErrorCode =
  | 'WORKSPACE_ACTIVATION_MIGRATION_FAILED'
  | 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED';

export class WorkspaceActivationMigrationError extends Error {
  constructor(readonly code: WorkspaceActivationMigrationErrorCode) {
    super(code);
    this.name = 'WorkspaceActivationMigrationError';
  }
}

