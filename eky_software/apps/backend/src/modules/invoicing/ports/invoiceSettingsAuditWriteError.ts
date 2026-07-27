export class InvoiceSettingsAuditWriteError extends Error {
  readonly code = 'invoice_settings_audit_write_failed';

  constructor() {
    super('Invoice settings could not be saved.');
    this.name = 'InvoiceSettingsAuditWriteError';
  }
}
