import type {
  StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';

export interface InvoicePaymentSettingsRepository {
  getSettings(companyId: string): Promise<StoredInvoicePaymentSettings | undefined>;
  saveSettings(
    settings: StoredInvoicePaymentSettings,
  ): Promise<StoredInvoicePaymentSettings>;
}
