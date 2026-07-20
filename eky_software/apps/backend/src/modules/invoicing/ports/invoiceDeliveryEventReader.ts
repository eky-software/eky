import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';

export interface InvoiceDeliveryEventReader {
  hasUnresolvedDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): Promise<boolean>;
  listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceDeliveryEventSummary[]>;
}
