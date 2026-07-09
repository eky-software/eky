import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';

export interface InvoiceDeliveryEventRepository {
  saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent>;
}
