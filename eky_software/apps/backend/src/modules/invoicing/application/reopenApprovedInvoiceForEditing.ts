import { randomUUID } from 'node:crypto';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type {
  InvoiceApprovalRepository,
  ReopenedApprovedInvoiceResult,
} from '../ports/invoiceApprovalRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';

export interface ReopenApprovedInvoiceForEditingInput {
  actorUserId: string;
  companyId: string;
  invoiceId: string;
  reopenedAt: string;
}

export interface ReopenApprovedInvoiceForEditingDependencies {
  invoiceApprovalRepository: InvoiceApprovalRepository;
}

export async function reopenApprovedInvoiceForEditing(
  input: ReopenApprovedInvoiceForEditingInput,
  dependencies: ReopenApprovedInvoiceForEditingDependencies,
): Promise<ReopenedApprovedInvoiceResult> {
  const actorUserId = requireIdentifier(input.actorUserId, 'Actor user id');
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const reopenedAt = requireIdentifier(input.reopenedAt, 'Reopen timestamp');

  const reopenedInvoice =
    await dependencies.invoiceApprovalRepository.reopenApprovedInvoiceForEditing({
      actorUserId,
      auditEventId: randomUUID(),
      companyId,
      invoiceId,
      reopenedAt,
    });

  if (reopenedInvoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  return reopenedInvoice;
}
