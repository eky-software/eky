const commonFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'errorCode',
  'eventName', 'id', 'level', 'occurredAt', 'outcome', 'runtimeInstanceId',
];

export function isInvoiceArchiveProjection(value: Record<string, unknown>): boolean {
  if (typeof value.eventName !== 'string' || !value.eventName.startsWith('invoicePdfArchive.')) {
    return true;
  }
  if (value.category !== 'invoicePdfArchive') return false;

  switch (value.eventName) {
    case 'invoicePdfArchive.queueFailed':
      return hasOnlyFields(value, ['stage', 'retryable', 'sideEffectState']) &&
        value.component === 'backend' && value.level === 'warn' &&
        value.outcome === 'failure' && value.errorCode === 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED' &&
        value.stage === 'queue' && value.retryable === true && value.sideEffectState === 'none';
    case 'invoicePdfArchive.taskQueued':
      return isDesktopSuccess(value) && hasOnlyFields(value, []);
    case 'invoicePdfArchive.copySucceeded':
      return isDesktopSuccess(value) && hasOnlyFields(value, ['durationMs']) &&
        isNonNegativeInteger(value.durationMs);
    case 'invoicePdfArchive.configurationChanged':
      return isDesktopSuccess(value) && hasOnlyFields(value, ['stage']) &&
        (value.stage === 'enabled' || value.stage === 'disabled');
    case 'invoicePdfArchive.copyFailed':
      return hasOnlyFields(value, ['durationMs', 'retryable', 'sideEffectState']) &&
        value.component === 'desktop' && value.level === 'warn' && value.outcome === 'failure' &&
        typeof value.errorCode === 'string' && value.errorCode.length > 0;
    default:
      return false;
  }
}

function hasOnlyFields(value: Record<string, unknown>, payload: readonly string[]): boolean {
  const fields = new Set([...commonFields, ...payload]);
  return Object.keys(value).every(key => fields.has(key));
}

function isDesktopSuccess(value: Record<string, unknown>): boolean {
  return value.component === 'desktop' && value.level === 'info' &&
    value.outcome === 'success' && value.errorCode === null;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
