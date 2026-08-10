import type { InvoiceIssuanceReadinessData } from '../domain/invoiceIssuanceReadiness.js';

export interface InvoiceIssuanceReadinessReader {
  getReadinessData(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceIssuanceReadinessData | undefined>;
}
