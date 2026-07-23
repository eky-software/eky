import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceCreditDraftRepository } from '../ports/invoiceCreditDraftRepository.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import {
  type CreditInvoiceDraftLineInput,
  prepareUpdatedCreditDraft,
  toCreditInvoiceDraftView,
} from './creditInvoiceDraftModel.js';
import type { CreditInvoiceDraftView } from './creditInvoiceDraftView.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

export interface UpdateCreditInvoiceDraftInput {
  actorContext: ActorContext;
  invoiceDraftId: string;
  subject: string;
  note: string;
  lines: readonly CreditInvoiceDraftLineInput[];
}

export interface UpdateCreditInvoiceDraftDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceCreditDraftRepository: InvoiceCreditDraftRepository;
  invoiceDraftRepository: InvoiceDraftRepository;
}

export async function updateCreditInvoiceDraft(
  input: UpdateCreditInvoiceDraftInput,
  dependencies: UpdateCreditInvoiceDraftDependencies,
): Promise<CreditInvoiceDraftView> {
  requirePermission(input.actorContext, 'manageInvoiceCorrections');

  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );
  const existingDraft =
    await dependencies.invoiceDraftRepository.getDraftById(
      companyId,
      invoiceDraftId,
    );

  if (
    existingDraft === undefined ||
    existingDraft.invoiceKind !== 'credit' ||
    existingDraft.creditedInvoiceId === null
  ) {
    throw new InvoiceDraftNotFoundError();
  }

  const sourceInvoice =
    await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
      companyId,
      existingDraft.creditedInvoiceId,
    );

  if (
    sourceInvoice === undefined ||
    sourceInvoice.invoiceKind !== 'standard' ||
    sourceInvoice.status !== 'sent'
  ) {
    throw new InvoiceDraftNotFoundError();
  }

  const previousAllocations =
    await dependencies.invoiceCreditDraftRepository.listPreviousCreditLineAllocations(
      companyId,
      sourceInvoice.id,
    );
  const updatedDraft = prepareUpdatedCreditDraft(
    existingDraft,
    sourceInvoice,
    previousAllocations,
    {
      subject: input.subject,
      note: input.note,
      lines: input.lines,
      updatedAt: createNextUpdatedAt(existingDraft.updatedAt),
    },
  );

  const savedDraft =
    await dependencies.invoiceDraftRepository.updateDraft(updatedDraft);

  if (savedDraft === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  return toCreditInvoiceDraftView(
    savedDraft,
    sourceInvoice,
    previousAllocations,
  );
}

function createNextUpdatedAt(previousUpdatedAt: string): string {
  const now = Date.now();
  const previous = Date.parse(previousUpdatedAt);
  const next =
    Number.isNaN(previous) || now > previous ? now : previous + 1;

  return new Date(next).toISOString();
}
