import type { StoredInvoiceNumberingSettings } from '../domain/invoiceNumbering.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';

export interface InvoiceNumberingSettingsRepository {
  getSettings(
    companyId: string,
    seriesKey: string,
  ): Promise<StoredInvoiceNumberingSettings | undefined>;
  saveSettings(
    settings: StoredInvoiceNumberingSettings,
    auditEvent: InvoiceSettingsAuditEvent,
  ): Promise<StoredInvoiceNumberingSettings>;
  hasUsedNumbering(companyId: string, seriesKey: string): Promise<boolean>;
}
