const fields = new Set([
  'appVersion', 'buildRevision', 'category', 'component', 'correlationId', 'durationMs',
  'errorCode', 'eventName', 'id', 'level', 'occurredAt', 'operationId', 'outcome',
  'retryable', 'runtimeInstanceId', 'sideEffectState', 'stage',
]);
const failureOperations: Readonly<Record<string, string>> = {
  WORKSPACE_CREATION_LABEL_EXISTS: 'workspace.create',
  WORKSPACE_IMPORT_LABEL_EXISTS: 'workspace.import',
  WORKSPACE_MANAGEMENT_CREATE_FAILED: 'workspace.create',
  WORKSPACE_MANAGEMENT_IMPORT_FAILED: 'workspace.import',
  WORKSPACE_MANAGEMENT_REPLACE_FAILED: 'workspace.replace',
  WORKSPACE_MANAGEMENT_SWITCH_FAILED: 'workspace.switch',
  WORKSPACE_MANAGEMENT_RENAME_FAILED: 'workspace.rename',
};
const operations = new Set(Object.values(failureOperations));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWorkspaceManagementProjection(value: Record<string, unknown>): boolean {
  if (typeof value.eventName !== 'string' || !value.eventName.startsWith('workspaceManagement.')) return true;
  if (value.eventName !== 'workspaceManagement.operationFailed' || value.category !== 'workspaceManagement' ||
    value.component !== 'desktop' || value.level !== 'error' || value.outcome !== 'failure' ||
    Object.keys(value).some(key => !fields.has(key)) ||
    typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
    typeof value.operationId !== 'string' || !operations.has(value.operationId) ||
    (value.sideEffectState !== 'none' && value.sideEffectState !== 'unknown')) return false;
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
    (typeof value.errorCode === 'string' && Object.hasOwn(failureOperations, value.errorCode) &&
      failureOperations[value.errorCode] === value.operationId)
  );
}
