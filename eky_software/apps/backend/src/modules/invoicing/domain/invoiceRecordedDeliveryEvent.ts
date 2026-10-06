import type { InvoiceDeliveryEvent } from './invoiceDeliveryEvent.js';
import type { RevisionInvoiceDeliveryTarget } from './invoiceDeliveryReservation.js';

type RevisionBoundEvent = InvoiceDeliveryEvent & Readonly<{
  documentId: string;
  target: RevisionInvoiceDeliveryTarget;
}>;

export type InvoiceDryRunDeliveryEvent = RevisionBoundEvent & Readonly<{
  deliveryMethod: 'email';
  provider: 'dryRun';
  status: 'succeeded' | 'failed';
}>;

export type InvoiceManualDeliveryEvent = RevisionBoundEvent & Readonly<{
  deliveryMethod: 'manual' | 'print';
  provider: 'manual';
  status: 'succeeded';
}>;

export type InvoiceRecordedDeliveryEvent = InvoiceDryRunDeliveryEvent | InvoiceManualDeliveryEvent;
