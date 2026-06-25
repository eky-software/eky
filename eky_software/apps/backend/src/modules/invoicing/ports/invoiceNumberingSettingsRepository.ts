import type { StoredInvoiceNumberingSettings } from '../domain/invoiceNumbering.js';

export interface InvoiceNumberingSettingsRepository {
  getSettings(
    companyId: string,
    seriesKey: string,
  ): Promise<StoredInvoiceNumberingSettings | undefined>;
  saveSettings(
    settings: StoredInvoiceNumberingSettings,
  ): Promise<StoredInvoiceNumberingSettings>;
  hasUsedNumbering(companyId: string, seriesKey: string): Promise<boolean>;
}
