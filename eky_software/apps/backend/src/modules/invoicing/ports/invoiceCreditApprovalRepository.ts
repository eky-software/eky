import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';

export interface ApproveCreditInvoiceDraftPersistenceInput {
  actorUserId: string;
  approvedAt: string;
  auditEventId: string;
  companyId: string;
  draftId: string;
  invoiceId: string;
  seriesKey: string;
}

export interface ApprovedCreditInvoiceResult {
  invoiceId: string;
  draftId: string;
  invoiceNumber: string;
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode: InvoiceNumberingMode;
  status: 'approved';
}

export type ApproveCreditInvoiceDraftPersistenceResult =
  | { outcome: 'approved'; invoice: ApprovedCreditInvoiceResult }
  | { outcome: 'conflict' }
  | { outcome: 'notFound' };

export interface InvoiceCreditApprovalRepository {
  approveCreditDraft(
    input: ApproveCreditInvoiceDraftPersistenceInput,
  ): Promise<ApproveCreditInvoiceDraftPersistenceResult>;
}
