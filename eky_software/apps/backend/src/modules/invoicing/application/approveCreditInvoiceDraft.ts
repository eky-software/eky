import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type {
  ApprovedCreditInvoiceResult,
  InvoiceCreditApprovalRepository,
} from '../ports/invoiceCreditApprovalRepository.js';
import { InvoiceCreditConflictError } from './invoiceCreditConflictError.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

export interface ApproveCreditInvoiceDraftInput {
  actorContext: ActorContext;
  approvedAt: string;
  draftId: string;
}

export interface ApproveCreditInvoiceDraftDependencies {
  invoiceCreditApprovalRepository: InvoiceCreditApprovalRepository;
}

export async function approveCreditInvoiceDraft(
  input: ApproveCreditInvoiceDraftInput,
  dependencies: ApproveCreditInvoiceDraftDependencies,
): Promise<ApprovedCreditInvoiceResult> {
  requirePermission(input.actorContext, 'manageInvoiceCorrections');

  const actorUserId = requireIdentifier(
    input.actorContext.actorId,
    'Actor user id',
  );
  const approvedAt = requireIdentifier(
    input.approvedAt,
    'Approval timestamp',
  );
  const companyId = requireIdentifier(
    input.actorContext.companyId,
    'Company id',
  );
  const draftId = requireIdentifier(input.draftId, 'Invoice draft id');

  let result;

  try {
    result =
      await dependencies.invoiceCreditApprovalRepository.approveCreditDraft({
        actorUserId,
        approvedAt,
        auditEventId: randomUUID(),
        companyId,
        draftId,
        invoiceId: randomUUID(),
      });
  } catch (error) {
    if (error instanceof InvoiceCreditError) {
      throw new InvoiceCreditConflictError();
    }

    throw error;
  }

  if (result.outcome === 'notFound') {
    throw new InvoiceDraftNotFoundError();
  }

  if (result.outcome === 'conflict') {
    throw new InvoiceCreditConflictError();
  }

  return result.invoice;
}
