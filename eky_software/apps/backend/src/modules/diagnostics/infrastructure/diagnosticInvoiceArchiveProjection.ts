const sourceCoreFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'eventId', 'eventName',
  'level', 'outcome', 'runtimeInstanceId', 'schemaVersion', 'timestamp',
];
const failureFields = [
  'durationMs', 'errorCode', 'fingerprint', 'retryable', 'sideEffectState', 'stage',
];

export function isInvoiceArchiveSourcePayload(value: Record<string, unknown>): boolean {
  switch (value.eventName) {
    case 'invoicePdfArchive.queueFailed':
      return hasOnlyFields(value, ['errorCode', 'stage', 'retryable', 'sideEffectState']) &&
        value.errorCode === 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED' &&
        value.stage === 'queue' && value.retryable === true && value.sideEffectState === 'none';
    case 'invoicePdfArchive.taskQueued':
      return hasOnlyFields(value, []);
    case 'invoicePdfArchive.copySucceeded':
      return hasOnlyFields(value, ['attemptCount', 'durationMs']) &&
        isNonNegativeInteger(value.attemptCount) && isNonNegativeInteger(value.durationMs);
    case 'invoicePdfArchive.copyFailed':
      return hasOnlyFields(value, ['attemptCount', ...failureFields]) &&
        isNonNegativeInteger(value.attemptCount) && typeof value.errorCode === 'string' &&
        value.errorCode.length > 0 && value.errorCode.length <= 120;
    case 'invoicePdfArchive.configurationChanged':
      return hasOnlyFields(value, ['stage']) &&
        (value.stage === 'enabled' || value.stage === 'disabled');
    default:
      return false;
  }
}

function hasOnlyFields(value: Record<string, unknown>, payload: readonly string[]): boolean {
  const fields = new Set([...sourceCoreFields, ...payload]);
  return Object.keys(value).every(key => fields.has(key));
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
