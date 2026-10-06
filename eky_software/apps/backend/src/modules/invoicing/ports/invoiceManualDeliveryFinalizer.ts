import type { InvoiceDeliveryMethod } from '../domain/invoiceDeliveryEvent.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';

export interface CompleteManualInvoiceDeliveryInput {
  actorUserId: string;
  auditEventId: string;
  deliveredAt: string;
  deliveryEventId: string;
  deliveryMethod: Extract<InvoiceDeliveryMethod, 'manual' | 'print'>;
  target: RevisionInvoiceDeliveryTarget;
}

export interface CompleteManualInvoiceDeliveryResult {
  outcome: 'completed' | 'alreadySent';
  updatedAt: string;
}

export interface InvoiceManualDeliveryFinalizer {
  completeManualDelivery(
    input: CompleteManualInvoiceDeliveryInput,
  ): Promise<CompleteManualInvoiceDeliveryResult | undefined>;
}
