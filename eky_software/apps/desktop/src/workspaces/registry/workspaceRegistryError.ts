export const WORKSPACE_REGISTRY_INVALID = 'WORKSPACE_REGISTRY_INVALID';

export class WorkspaceRegistryValidationError extends Error {
  readonly code = WORKSPACE_REGISTRY_INVALID;

  constructor() {
    super(WORKSPACE_REGISTRY_INVALID);
    this.name = 'WorkspaceRegistryValidationError';
  }
}

export function workspaceRegistryInvalid(): never {
  throw new WorkspaceRegistryValidationError();
}
