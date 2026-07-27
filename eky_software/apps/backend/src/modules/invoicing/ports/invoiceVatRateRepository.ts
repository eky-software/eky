import type { StoredInvoiceVatRate } from '../domain/invoiceVatRates.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';

export interface InvoiceVatRateRepository {
  listRates(companyId: string): Promise<StoredInvoiceVatRate[]>;
  replaceRates(
    companyId: string,
    vatRates: readonly StoredInvoiceVatRate[],
    auditEvent: InvoiceSettingsAuditEvent,
  ): Promise<StoredInvoiceVatRate[]>;
}
