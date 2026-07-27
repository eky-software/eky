export interface InvoiceSettingsAuditRetentionPort {
  deleteInvoiceSettingsAuditEventsBefore(cutoff: string): Promise<number>;
}
