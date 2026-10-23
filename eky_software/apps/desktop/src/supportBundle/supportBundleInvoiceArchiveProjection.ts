const commonFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'errorCode',
  'eventName', 'id', 'level', 'occurredAt', 'outcome', 'runtimeInstanceId',
];

export function isSupportBundleInvoiceArchiveProjection(value: Record<string, unknown>): boolean {
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
