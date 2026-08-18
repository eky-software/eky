export type EmptyWorkspaceCreationStage =
  | 'inputValidation'
  | 'lease'
  | 'activeRuntimeQuiesce'
  | 'activeRuntimeStop'
  | 'identityGeneration'
  | 'journal'
  | 'candidateRoot'
  | 'bootstrap'
  | 'candidateValidation'
  | 'rootPublish'
  | 'registryPublish'
  | 'activeRuntimeRestart'
  | 'cleanup'
  | 'recovery';

export type EmptyWorkspaceCreationErrorCode =
  | 'WORKSPACE_CREATION_INVALID'
  | 'WORKSPACE_CREATION_BUSY'
  | 'WORKSPACE_CREATION_CONFLICT'
  | 'WORKSPACE_CREATION_CAPACITY_EXCEEDED'
  | 'WORKSPACE_CREATION_LIFECYCLE_FAILED'
  | 'WORKSPACE_CREATION_JOURNAL_FAILED'
  | 'WORKSPACE_CREATION_STORAGE_FAILED'
  | 'WORKSPACE_CREATION_BOOTSTRAP_FAILED'
  | 'WORKSPACE_CREATION_REGISTRY_FAILED'
  | 'WORKSPACE_CREATION_RECOVERY_REQUIRED';

export class EmptyWorkspaceCreationError extends Error {
  constructor(
    readonly code: EmptyWorkspaceCreationErrorCode,
    readonly stage: EmptyWorkspaceCreationStage,
  ) {
    super(code);
    this.name = 'EmptyWorkspaceCreationError';
  }
}

export function mapEmptyWorkspaceCreationError(
  error: unknown,
  code: EmptyWorkspaceCreationErrorCode,
  stage: EmptyWorkspaceCreationStage,
): EmptyWorkspaceCreationError {
  return error instanceof EmptyWorkspaceCreationError
    ? error
    : new EmptyWorkspaceCreationError(code, stage);
}
