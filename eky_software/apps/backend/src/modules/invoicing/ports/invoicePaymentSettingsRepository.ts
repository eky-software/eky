import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';

export interface InvoicePaymentSettingsRepository {
  getSettings(companyId: string): Promise<StoredInvoicePaymentSettings | undefined>;
  saveSettings(
    settings: StoredInvoicePaymentSettings,
    auditEvent: InvoiceSettingsAuditEvent,
  ): Promise<StoredInvoicePaymentSettings>;
}
