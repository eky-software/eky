export type WorkspaceSwitchSafeErrorCode =
  | 'WORKSPACE_SWITCH_INVALID'
  | 'WORKSPACE_SWITCH_RECOVERY_REQUIRED'
  | 'WORKSPACE_SWITCH_STORAGE_FAILED';

export class WorkspaceSwitchError extends Error {
  constructor(readonly code: WorkspaceSwitchSafeErrorCode) {
    super(code);
    this.name = 'WorkspaceSwitchError';
  }
}

export function mapWorkspaceSwitchError(error: unknown): WorkspaceSwitchError {
  return error instanceof WorkspaceSwitchError
    ? error
    : new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED');
}
