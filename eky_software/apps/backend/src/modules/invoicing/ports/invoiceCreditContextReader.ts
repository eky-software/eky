import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';

export interface InvoiceCreditContextReader {
  getInvoiceCreditContext(
    companyId: string,
    sourceInvoiceId: string,
  ): Promise<InvoiceCreditContext | undefined>;
}
