import type { InvoiceKind } from '../domain/invoiceKind.js';

export interface CancelApprovedInvoicePersistenceInput {
  actorUserId: string;
  auditEventId: string;
  cancellationReason: string;
  cancelledAt: string;
  companyId: string;
  confirmationInvoiceNumber: string;
  invoiceId: string;
}

export interface CancelledApprovedInvoiceResult {
  cancellationReason: string;
  cancelledAt: string;
  cancelledBy: string;
  invoiceId: string;
  invoiceKind: InvoiceKind;
  invoiceNumber: string;
  status: 'cancelled';
}

export type CancelApprovedInvoicePersistenceResult =
  | { outcome: 'cancelled'; invoice: CancelledApprovedInvoiceResult }
  | {
      outcome:
        | 'confirmationMismatch'
        | 'deliveryConflict'
        | 'notCancellable'
        | 'notFound';
    };

export interface InvoiceCorrectionRepository {
  cancelApprovedInvoice(
    input: CancelApprovedInvoicePersistenceInput,
  ): Promise<CancelApprovedInvoicePersistenceResult>;
}
