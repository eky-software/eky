import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';

export interface CompleteInvoiceDeliveryEventInput {
  companyId: string;
  eventId: string;
  providerMessageId: string | null;
  safeErrorMessage: string | null;
  status: 'succeeded' | 'failed' | 'outcomeUnknown';
  technicalErrorCode: string | null;
}

export interface InvoiceDeliveryEventRepository {
  completeDeliveryEvent(input: CompleteInvoiceDeliveryEventInput): Promise<void>;
  saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent>;
}
