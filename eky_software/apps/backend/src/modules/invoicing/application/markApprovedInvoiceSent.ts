import { randomUUID } from 'node:crypto';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedApprovedInvoiceVatBreakdown } from '../domain/invoiceViewTotals.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceApprovalRepository } from '../ports/invoiceApprovalRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';

export interface MarkApprovedInvoiceSentInput {
  actorUserId: string;
  companyId: string;
  invoiceId: string;
  markedSentAt: string;
}

export interface MarkApprovedInvoiceSentDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<unknown>;
  invoiceApprovalRepository: InvoiceApprovalRepository;
}

export async function markApprovedInvoiceSent(
  input: MarkApprovedInvoiceSentInput,
  dependencies: MarkApprovedInvoiceSentDependencies,
): Promise<ApprovedInvoiceView> {
  const actorUserId = requireIdentifier(input.actorUserId, 'Actor user id');
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const markedSentAt = requireIdentifier(input.markedSentAt, 'Sent timestamp');

  await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: markedSentAt,
    invoiceId,
  });

  const result = await dependencies.invoiceApprovalRepository.markApprovedInvoiceSent({
    actorUserId,
    auditEventId: randomUUID(),
    companyId,
    invoiceId,
    markedSentAt,
  });

  if (result === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  return withCalculatedApprovedInvoiceVatBreakdown(invoice);
}
