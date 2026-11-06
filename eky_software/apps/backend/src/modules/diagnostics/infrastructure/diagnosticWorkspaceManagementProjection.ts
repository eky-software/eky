const coreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'eventId', 'eventName',
  'level', 'outcome', 'runtimeInstanceId', 'schemaVersion', 'timestamp',
];
const requiredFields = [
  'correlationId', 'durationMs', 'errorCode', 'operationId', 'retryable', 'sideEffectState', 'stage',
];
const failureOperations: Readonly<Record<string, string>> = {
  WORKSPACE_CREATION_LABEL_EXISTS: 'workspace.create',
  WORKSPACE_IMPORT_LABEL_EXISTS: 'workspace.import',
  WORKSPACE_MANAGEMENT_CREATE_FAILED: 'workspace.create',
  WORKSPACE_MANAGEMENT_IMPORT_FAILED: 'workspace.import',
  WORKSPACE_MANAGEMENT_REPLACE_FAILED: 'workspace.replace',
  WORKSPACE_MANAGEMENT_SWITCH_FAILED: 'workspace.switch',
  WORKSPACE_MANAGEMENT_RENAME_FAILED: 'workspace.rename',
};
const operations = new Set([...Object.values(failureOperations), 'workspace.delete', 'workspace.deleteResume']);
const deletionStages = new Set([
  'admission', 'deletePreparation', 'deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup',
]);
const deletionCodes = new Set([
  'WORKSPACE_MANAGEMENT_BUSY', 'WORKSPACE_MANAGEMENT_INVALID',
  'WORKSPACE_DELETE_STALE_CONFIRMATION', 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
  'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_INVENTORY_INVALID',
  'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED',
  'WORKSPACE_DELETE_CLEANUP_FAILED', 'WORKSPACE_DELETE_FAILED',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWorkspaceManagementSourcePayload(value: Record<string, unknown>): boolean {
  const fields = new Set([...coreFields, ...requiredFields]);
  if (Object.keys(value).some(key => !fields.has(key)) || requiredFields.some(key => value[key] === undefined) ||
    typeof value.correlationId !== 'string' || !uuidPattern.test(value.correlationId) ||
    typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
    typeof value.operationId !== 'string' || !operations.has(value.operationId) ||
    (value.sideEffectState !== 'none' && value.sideEffectState !== 'unknown')) return false;
  if (value.operationId === 'workspace.delete' || value.operationId === 'workspace.deleteResume') {
    if (typeof value.stage !== 'string' || !deletionStages.has(value.stage) ||
      typeof value.errorCode !== 'string' || !deletionCodes.has(value.errorCode)) return false;
    if (value.sideEffectState === 'none' &&
      (value.operationId === 'workspace.deleteResume' ||
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
    (typeof value.errorCode === 'string' && Object.hasOwn(failureOperations, value.errorCode) &&
      failureOperations[value.errorCode] === value.operationId)
  );
}
