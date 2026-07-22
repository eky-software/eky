import type { InvoiceVatRateSetting } from '../domain/invoiceVatRates.js';

export interface InvoiceVatRatesView {
  vatRates: InvoiceVatRateSetting[];
  isPersisted: boolean;
}
