export type MigrationFailureStage =
  | 'historyPreparation'
  | 'manifest'
  | 'migrationExecution';

export type MigrationRunErrorCode =
  | 'MIGRATION_EXECUTION_FAILED'
  | 'MIGRATION_HISTORY_PREPARATION_FAILED'
  | 'MIGRATION_MANIFEST_FAILED';

export class MigrationRunError extends Error {
  readonly completedMigrationCount: number;
  readonly errorCode: MigrationRunErrorCode;
  readonly failureStage: MigrationFailureStage;
  readonly sideEffectState = 'unknown' as const;

  constructor(input: {
    completedMigrationCount: number;
    errorCode: MigrationRunErrorCode;
    failureStage: MigrationFailureStage;
  }) {
    super('Database migration run failed.');
    this.name = 'MigrationRunError';
    this.completedMigrationCount = input.completedMigrationCount;
    this.errorCode = input.errorCode;
    this.failureStage = input.failureStage;
  }
}
