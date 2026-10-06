import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';

export interface InvoiceDraftDeliveryHistory {
  invoiceId: string | null;
  events: InvoiceDeliveryEventSummary[];
}

export interface InvoiceDraftDeliveryHistoryReader {
  // Undefined means the scoped draft is absent or not editable; inconsistent
  // stored bindings must fail instead of being represented as empty history.
  findDeliveryHistory(input: {
    companyId: string;
    invoiceDraftId: string;
  }): Promise<InvoiceDraftDeliveryHistory | undefined>;
}
