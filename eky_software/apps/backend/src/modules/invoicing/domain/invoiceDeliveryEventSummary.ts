import type {
  InvoiceDeliveryMethod,
  InvoiceDeliveryProvider,
  InvoiceDeliveryStatus,
} from './invoiceDeliveryEvent.js';

export interface InvoiceDeliveryEventSummary {
  id: string;
  createdAt: string;
  deliveryMethod: InvoiceDeliveryMethod;
  provider: InvoiceDeliveryProvider;
  recipientEmail: string;
  ccEmail: string;
  safeErrorMessage: string | null;
  status: InvoiceDeliveryStatus;
}
