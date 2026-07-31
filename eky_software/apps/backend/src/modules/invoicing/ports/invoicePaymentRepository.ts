import type { InvoicePaymentSummary } from '../domain/invoicePayment.js';

export interface MarkInvoicePaidPersistenceInput {
  actorUserId: string;
  companyId: string;
  eventId: string;
  invoiceId: string;
  paidOn: string;
  recordedAt: string;
}

export interface RevertInvoicePaidMarkPersistenceInput {
  actorUserId: string;
  companyId: string;
  eventId: string;
  invoiceId: string;
  recordedAt: string;
}

export type MarkInvoicePaidPersistenceResult =
  | {
      outcome: 'idempotent' | 'markedPaid';
      payment: InvoicePaymentSummary;
    }
  | {
      outcome: 'conflict' | 'notFound' | 'notPayable';
    };

export type RevertInvoicePaidMarkPersistenceResult =
  | {
      outcome: 'idempotent' | 'reverted';
      payment: InvoicePaymentSummary;
    }
  | {
      outcome: 'conflict' | 'notFound';
    };

export interface InvoicePaymentRepository {
  markInvoicePaid(
    input: MarkInvoicePaidPersistenceInput,
  ): Promise<MarkInvoicePaidPersistenceResult>;
  revertInvoicePaidMark(
    input: RevertInvoicePaidMarkPersistenceInput,
  ): Promise<RevertInvoicePaidMarkPersistenceResult>;
}
