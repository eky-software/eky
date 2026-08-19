export type WorkspaceLegacyAdoptionErrorCode =
  | 'WORKSPACE_ADOPTION_INVALID'
  | 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED'
  | 'WORKSPACE_ADOPTION_STORAGE_FAILED';

export class WorkspaceLegacyAdoptionError extends Error {
  constructor(readonly code: WorkspaceLegacyAdoptionErrorCode) {
    super(code);
    this.name = 'WorkspaceLegacyAdoptionError';
  }
}

export function mapWorkspaceLegacyAdoptionError(
  error: unknown,
): WorkspaceLegacyAdoptionError {
  return error instanceof WorkspaceLegacyAdoptionError
    ? error
    : new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_STORAGE_FAILED');
}
