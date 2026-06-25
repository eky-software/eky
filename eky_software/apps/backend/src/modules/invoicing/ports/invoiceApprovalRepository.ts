import type { ApprovedInvoiceStatus } from '../domain/approvedInvoice.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';

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
  sequenceNumber: number;
  sequenceScope: string;
  numberingMode: InvoiceNumberingMode;
  status: ApprovedInvoiceStatus;
}

export interface InvoiceApprovalRepository {
  approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined>;
}
