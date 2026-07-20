import type { InvoiceDeliveryMethod } from '../domain/invoiceDeliveryEvent.js';

export interface CompleteManualInvoiceDeliveryInput {
  actorUserId: string;
  auditEventId: string;
  companyId: string;
  deliveredAt: string;
  deliveryEventId: string;
  deliveryMethod: Extract<InvoiceDeliveryMethod, 'manual' | 'print'>;
  documentId: string;
  invoiceId: string;
}

export interface CompleteManualInvoiceDeliveryResult {
  updatedAt: string;
}

export interface InvoiceManualDeliveryFinalizer {
  completeManualDelivery(
    input: CompleteManualInvoiceDeliveryInput,
  ): Promise<CompleteManualInvoiceDeliveryResult | undefined>;
}
