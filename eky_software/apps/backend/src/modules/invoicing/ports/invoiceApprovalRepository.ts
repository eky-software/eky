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

export interface InvoiceApprovalRepository {
  approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined>;

  reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined>;
}
