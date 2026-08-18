export const WORKSPACE_ROOT_INVALID = 'WORKSPACE_ROOT_INVALID';

export class WorkspaceRootValidationError extends Error {
  readonly code = WORKSPACE_ROOT_INVALID;

  constructor() {
    super(WORKSPACE_ROOT_INVALID);
    this.name = 'WorkspaceRootValidationError';
  }
}

export function workspaceRootInvalid(): never {
  throw new WorkspaceRootValidationError();
}
