export const workspaceFirstStartMigrationPlanInvalidCode =
  'WORKSPACE_FIRST_START_MIGRATION_PLAN_INVALID';

export class WorkspaceFirstStartMigrationPlanError extends Error {
  readonly errorCode = workspaceFirstStartMigrationPlanInvalidCode;

  constructor() {
    super(workspaceFirstStartMigrationPlanInvalidCode);
    this.name = 'WorkspaceFirstStartMigrationPlanError';
  }
}
