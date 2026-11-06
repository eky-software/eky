export const workspaceManagementOperationIds = Object.freeze({
  create: 'workspace.create', import: 'workspace.import', replace: 'workspace.replace',
  switch: 'workspace.switch', rename: 'workspace.rename', delete: 'workspace.delete',
  deleteResume: 'workspace.deleteResume',
} as const);

export type WorkspaceManagementOperationId =
  (typeof workspaceManagementOperationIds)[keyof typeof workspaceManagementOperationIds];

export const workspaceDeletionFailureStages = Object.freeze([
  'admission', 'deletePreparation', 'deleteAuthorization',
  'deletePurge', 'deleteRegistry', 'deleteCleanup',
] as const);

export type WorkspaceDeletionFailureStage = (typeof workspaceDeletionFailureStages)[number];

export const workspaceDeletionFailureCodes = Object.freeze([
  'WORKSPACE_MANAGEMENT_BUSY', 'WORKSPACE_MANAGEMENT_INVALID',
  'WORKSPACE_DELETE_STALE_CONFIRMATION', 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
  'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_INVENTORY_INVALID',
  'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED',
  'WORKSPACE_DELETE_CLEANUP_FAILED', 'WORKSPACE_DELETE_FAILED',
] as const);

export type WorkspaceDeletionFailureCode = (typeof workspaceDeletionFailureCodes)[number];

export function isWorkspaceDeletionFailureCode(value: unknown): value is WorkspaceDeletionFailureCode {
  return workspaceDeletionFailureCodes.some(code => code === value);
}

const failureOperationIds: Readonly<Record<string, WorkspaceManagementOperationId>> = {
  WORKSPACE_CREATION_LABEL_EXISTS: 'workspace.create',
  WORKSPACE_IMPORT_LABEL_EXISTS: 'workspace.import',
  WORKSPACE_MANAGEMENT_CREATE_FAILED: 'workspace.create',
  WORKSPACE_MANAGEMENT_IMPORT_FAILED: 'workspace.import',
  WORKSPACE_MANAGEMENT_REPLACE_FAILED: 'workspace.replace',
  WORKSPACE_MANAGEMENT_SWITCH_FAILED: 'workspace.switch',
  WORKSPACE_MANAGEMENT_RENAME_FAILED: 'workspace.rename',
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWorkspaceManagementFailureContext(value: Record<string, unknown>): boolean {
  if (typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
    !Object.values(workspaceManagementOperationIds).some(id => id === value.operationId) ||
    (value.sideEffectState !== 'none' && value.sideEffectState !== 'unknown')) return false;
  if (value.operationId === workspaceManagementOperationIds.delete ||
    value.operationId === workspaceManagementOperationIds.deleteResume) {
    if (!workspaceDeletionFailureStages.some(stage => stage === value.stage) ||
      !isWorkspaceDeletionFailureCode(value.errorCode)) return false;
    if (value.sideEffectState === 'none' &&
      (value.operationId === workspaceManagementOperationIds.deleteResume ||
        (value.stage !== 'admission' &&
          !(value.stage === 'deletePreparation' && value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY')))) return false;
    return value.retryable === (value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY');
  }
  if (value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY') {
    return (value.stage === 'admission' || value.stage === 'operation') && value.retryable === true;
  }
  if (value.retryable !== false) return false;
  if (value.errorCode === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH') {
    return value.operationId === 'workspace.replace' && value.stage === 'lineageCheck';
  }
  return value.stage === 'operation' && (
    (value.errorCode === 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' &&
      (value.operationId === 'workspace.create' || value.operationId === 'workspace.import' || value.operationId === 'workspace.rename')) ||
    value.errorCode === 'WORKSPACE_MANAGEMENT_INVALID' || value.errorCode === 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' ||
    (typeof value.errorCode === 'string' && Object.hasOwn(failureOperationIds, value.errorCode) &&
      failureOperationIds[value.errorCode] === value.operationId)
  );
}
