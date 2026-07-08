import type { ApprovedInvoiceStatus } from '../domain/approvedInvoice.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import type { ReferenceNumberType } from '../domain/invoiceReferenceNumber.js';

export interface ApproveInvoiceDraftPersistenceInput {
  actorUserId: string;
  approvedAt: string;
  auditEventId: string;
  companyId: string;
  draftId: string;
  invoiceId: string;
  seriesKey: string;
}

export interface ApprovedInvoiceResult {
  invoiceId: string;
  draftId: string;
  invoiceNumber: string;
  referenceNumber: string;
  referenceNumberType: ReferenceNumberType;
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
}

export interface ReopenApprovedInvoicePersistenceInput {
  actorUserId: string;
  auditEventId: string;
  companyId: string;
  invoiceId: string;
  reopenedAt: string;
}

export interface ReopenedApprovedInvoiceResult {
  invoiceId: string;
  draftId: string;
  removedDocumentStoragePaths: string[];
}

export interface MarkApprovedInvoiceSentPersistenceInput {
  actorUserId: string;
  auditEventId: string;
  companyId: string;
  invoiceId: string;
  markedSentAt: string;
}

export interface MarkApprovedInvoiceSentResult {
  invoiceId: string;
  status: 'sent';
}

export interface InvoiceApprovalRepository {
  approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined>;

  markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentPersistenceInput,
  ): Promise<MarkApprovedInvoiceSentResult | undefined>;

  reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined>;
}
