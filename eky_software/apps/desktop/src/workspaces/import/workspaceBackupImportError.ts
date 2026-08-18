export type WorkspaceBackupImportStage =
  | 'inputValidation'
  | 'backupPreflight'
  | 'registryRead'
  | 'lineageCheck'
  | 'lease'
  | 'activeRuntimeQuiesce'
  | 'activeRuntimeStop'
  | 'runtimeAbsence'
  | 'identityGeneration'
  | 'journal'
  | 'candidateRoot'
  | 'backupStage'
  | 'candidateMigration'
  | 'candidateValidation'
  | 'rootPublish'
  | 'registryPublish'
  | 'activeRuntimeRestart'
  | 'cleanup'
  | 'recovery';

export type WorkspaceBackupImportErrorCode =
  | 'WORKSPACE_IMPORT_INVALID'
  | 'WORKSPACE_IMPORT_BUSY'
  | 'WORKSPACE_IMPORT_LINEAGE_EXISTS'
  | 'WORKSPACE_IMPORT_CONFLICT'
  | 'WORKSPACE_IMPORT_CAPACITY_EXCEEDED'
  | 'WORKSPACE_IMPORT_LIFECYCLE_FAILED'
  | 'WORKSPACE_IMPORT_BACKUP_FAILED'
  | 'WORKSPACE_IMPORT_JOURNAL_FAILED'
  | 'WORKSPACE_IMPORT_STORAGE_FAILED'
  | 'WORKSPACE_IMPORT_MIGRATION_FAILED'
  | 'WORKSPACE_IMPORT_VALIDATION_FAILED'
  | 'WORKSPACE_IMPORT_REGISTRY_FAILED'
  | 'WORKSPACE_IMPORT_RECOVERY_REQUIRED';

export class WorkspaceBackupImportError extends Error {
  constructor(
    readonly code: WorkspaceBackupImportErrorCode,
    readonly stage: WorkspaceBackupImportStage,
  ) {
    super(code);
    this.name = 'WorkspaceBackupImportError';
  }
}

export function mapWorkspaceBackupImportError(
  error: unknown,
  code: WorkspaceBackupImportErrorCode,
  stage: WorkspaceBackupImportStage,
): WorkspaceBackupImportError {
  return error instanceof WorkspaceBackupImportError
    ? error
    : new WorkspaceBackupImportError(code, stage);
}
