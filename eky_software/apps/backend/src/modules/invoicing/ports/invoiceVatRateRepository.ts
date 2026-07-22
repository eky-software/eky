import type { StoredInvoiceVatRate } from '../domain/invoiceVatRates.js';

export interface InvoiceVatRateRepository {
  listRates(companyId: string): Promise<StoredInvoiceVatRate[]>;
  replaceRates(
    companyId: string,
    vatRates: readonly StoredInvoiceVatRate[],
  ): Promise<StoredInvoiceVatRate[]>;
}
