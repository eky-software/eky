import type { InvoiceActivityEntry } from '../domain/invoiceActivityEntry.js';

export interface InvoiceActivityReader {
  listInvoiceActivity(
    companyId: string,
    limit: number,
  ): Promise<InvoiceActivityEntry[]>;
}
