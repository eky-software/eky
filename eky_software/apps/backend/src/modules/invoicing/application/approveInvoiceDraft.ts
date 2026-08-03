import { randomUUID } from 'node:crypto';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type {
  ApprovedInvoiceResult,
  InvoiceApprovalRepository,
} from '../ports/invoiceApprovalRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

export interface ApproveInvoiceDraftInput {
  actorUserId: string;
  approvedAt: string;
  companyId: string;
  draftId: string;
  reverseChargeEligibilityConfirmed?: boolean;
}

export interface ApproveInvoiceDraftDependencies {
  invoiceApprovalRepository: InvoiceApprovalRepository;
}

export async function approveInvoiceDraft(
  input: ApproveInvoiceDraftInput,
  dependencies: ApproveInvoiceDraftDependencies,
): Promise<ApprovedInvoiceResult> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const draftId = requireIdentifier(input.draftId, 'Invoice draft id');
  const actorUserId = requireIdentifier(input.actorUserId, 'Actor user id');
  const approvedAt = requireIdentifier(input.approvedAt, 'Approval timestamp');

  const approvedInvoice =
    await dependencies.invoiceApprovalRepository.approveDraft({
      actorUserId,
      approvedAt,
      auditEventId: randomUUID(),
      companyId,
      draftId,
      invoiceId: randomUUID(),
      reverseChargeEligibilityConfirmed:
        input.reverseChargeEligibilityConfirmed === true,
    });

  if (approvedInvoice === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  return approvedInvoice;
}
