import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceCreditDraftRepository } from '../ports/invoiceCreditDraftRepository.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  createInitialCreditDraft,
  toCreditInvoiceDraftView,
} from './creditInvoiceDraftModel.js';
import type { CreditInvoiceDraftView } from './creditInvoiceDraftView.js';
import { InvoiceCreditConflictError } from './invoiceCreditConflictError.js';

export interface CreateCreditInvoiceDraftInput {
  actorContext: ActorContext;
  createdAt: string;
  invoiceId: string;
}

export interface CreateCreditInvoiceDraftDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceCreditDraftRepository: InvoiceCreditDraftRepository;
  invoiceDraftRepository: InvoiceDraftRepository;
}

export async function createCreditInvoiceDraft(
  input: CreateCreditInvoiceDraftInput,
  dependencies: CreateCreditInvoiceDraftDependencies,
): Promise<CreditInvoiceDraftView> {
  requirePermission(input.actorContext, 'manageInvoiceCorrections');

  const actorUserId = requireIdentifier(input.actorContext.actorId, 'Actor user id');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const sourceInvoice =
    await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
      companyId,
      invoiceId,
    );

  if (sourceInvoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  if (
    sourceInvoice.invoiceKind !== 'standard' ||
    sourceInvoice.status !== 'sent'
  ) {
    throw new InvoiceCreditConflictError();
  }

  const previousAllocations =
    await dependencies.invoiceCreditDraftRepository.listPreviousCreditLineAllocations(
      companyId,
      sourceInvoice.id,
    );
  let draft;

  try {
    draft = createInitialCreditDraft(
      sourceInvoice,
      previousAllocations,
      input.createdAt,
    );
  } catch (error) {
    if (error instanceof InvoiceCreditError) {
      throw new InvoiceCreditConflictError();
    }

    throw error;
  }

  const result =
    await dependencies.invoiceCreditDraftRepository.createCreditDraft({
      actorUserId,
      auditEventId: randomUUID(),
      draft,
      sourceInvoiceId: sourceInvoice.id,
    });

  if (result.outcome === 'notEligible') {
    throw new InvoiceCreditConflictError();
  }

  const savedDraft = await dependencies.invoiceDraftRepository.getDraftById(
    companyId,
    result.draftId,
  );

  if (savedDraft === undefined || savedDraft.invoiceKind !== 'credit') {
    throw new ApprovedInvoiceNotFoundError();
  }

  return toCreditInvoiceDraftView(
    savedDraft,
    sourceInvoice,
    previousAllocations,
  );
}
