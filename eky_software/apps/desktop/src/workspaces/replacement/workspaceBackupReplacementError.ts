export type WorkspaceBackupReplacementStage =
  | 'inputValidation'
  | 'operationGuard'
  | 'registryRead'
  | 'targetValidation'
  | 'backupPreflight'
  | 'lineageCheck'
  | 'lease'
  | 'registryRevalidation'
  | 'activeRuntimeQuiesce'
  | 'activeRuntimeStop'
  | 'runtimeAbsence'
  | 'preRestore'
  | 'candidateRoot'
  | 'backupStage'
  | 'candidateMigration'
  | 'candidateValidation'
  | 'activationJournal'
  | 'activationPrepare'
  | 'activationReplace'
  | 'activeRuntimeRestart'
  | 'activeRuntimeValidation'
  | 'registryInvariant'
  | 'cleanup'
  | 'rollback';

export type WorkspaceBackupReplacementErrorCode =
  | 'WORKSPACE_REPLACEMENT_INVALID'
  | 'WORKSPACE_REPLACEMENT_BUSY'
  | 'WORKSPACE_REPLACEMENT_TARGET_INELIGIBLE'
  | 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH'
  | 'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED'
  | 'WORKSPACE_REPLACEMENT_REGISTRY_FAILED'
  | 'WORKSPACE_REPLACEMENT_BACKUP_FAILED'
  | 'WORKSPACE_REPLACEMENT_LIFECYCLE_FAILED'
  | 'WORKSPACE_REPLACEMENT_RECOVERY_POINT_FAILED'
  | 'WORKSPACE_REPLACEMENT_STORAGE_FAILED'
  | 'WORKSPACE_REPLACEMENT_MIGRATION_FAILED'
  | 'WORKSPACE_REPLACEMENT_VALIDATION_FAILED'
  | 'WORKSPACE_REPLACEMENT_ACTIVATION_FAILED'
  | 'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED';

export class WorkspaceBackupReplacementError extends Error {
  constructor(
    readonly code: WorkspaceBackupReplacementErrorCode,
    readonly stage: WorkspaceBackupReplacementStage,
  ) {
    super(code);
    this.name = 'WorkspaceBackupReplacementError';
  }
}

export function mapWorkspaceBackupReplacementError(
  error: unknown,
  code: WorkspaceBackupReplacementErrorCode,
  stage: WorkspaceBackupReplacementStage,
): WorkspaceBackupReplacementError {
  return error instanceof WorkspaceBackupReplacementError
    ? error
    : new WorkspaceBackupReplacementError(code, stage);
}
