export type WorkspaceFirstStartMigrationJournalStoreFailure =
  | 'busy'
  | 'unavailable';

export class WorkspaceFirstStartMigrationJournalValidationError extends Error {
  constructor() {
    super('WORKSPACE_FIRST_START_MIGRATION_JOURNAL_INVALID');
    this.name = 'WorkspaceFirstStartMigrationJournalValidationError';
  }
}

export class WorkspaceFirstStartMigrationJournalStoreError extends Error {
  constructor(
    readonly failure: WorkspaceFirstStartMigrationJournalStoreFailure,
  ) {
    super(
      failure === 'busy'
        ? 'WORKSPACE_FIRST_START_MIGRATION_JOURNAL_BUSY'
        : 'WORKSPACE_FIRST_START_MIGRATION_JOURNAL_UNAVAILABLE',
    );
    this.name = 'WorkspaceFirstStartMigrationJournalStoreError';
  }
}

export type WorkspaceFirstStartMigrationTransitionFailure =
  | 'invalid'
  | 'recoveryRequired';

export class WorkspaceFirstStartMigrationTransitionError extends Error {
  constructor(
    readonly failure: WorkspaceFirstStartMigrationTransitionFailure,
  ) {
    super(
      failure === 'invalid'
        ? 'WORKSPACE_FIRST_START_MIGRATION_TRANSITION_INVALID'
        : 'WORKSPACE_FIRST_START_MIGRATION_RECOVERY_REQUIRED',
    );
    this.name = 'WorkspaceFirstStartMigrationTransitionError';
  }
}

export function workspaceFirstStartMigrationJournalInvalid(): never {
  throw new WorkspaceFirstStartMigrationJournalValidationError();
}
