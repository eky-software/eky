export const WORKSPACE_REGISTRY_UNAVAILABLE = 'WORKSPACE_REGISTRY_UNAVAILABLE';
export const WORKSPACE_REGISTRY_BUSY = 'WORKSPACE_REGISTRY_BUSY';

export type WorkspaceRegistryStoreErrorCode =
  | typeof WORKSPACE_REGISTRY_UNAVAILABLE
  | typeof WORKSPACE_REGISTRY_BUSY;

export class WorkspaceRegistryStoreError extends Error {
  constructor(readonly code: WorkspaceRegistryStoreErrorCode) {
    super(code);
    this.name = 'WorkspaceRegistryStoreError';
  }
}
