export type WorkspaceFirstStartMigrationOrchestratorFailure =
  | 'failed'
  | 'recoveryRequired'
  | 'rollbackRequired';

const errorCodes: Readonly<
  Record<WorkspaceFirstStartMigrationOrchestratorFailure, string>
> = Object.freeze({
  failed: 'WORKSPACE_FIRST_START_MIGRATION_FAILED',
  recoveryRequired: 'WORKSPACE_FIRST_START_MIGRATION_RECOVERY_REQUIRED',
  rollbackRequired: 'WORKSPACE_FIRST_START_MIGRATION_ROLLBACK_REQUIRED',
});

export class WorkspaceFirstStartMigrationOrchestratorError extends Error {
  readonly relaunchRequired: boolean;

  constructor(
    readonly failure: WorkspaceFirstStartMigrationOrchestratorFailure,
  ) {
    super(errorCodes[failure]);
    this.name = 'WorkspaceFirstStartMigrationOrchestratorError';
    this.relaunchRequired = failure === 'rollbackRequired';
  }
}
