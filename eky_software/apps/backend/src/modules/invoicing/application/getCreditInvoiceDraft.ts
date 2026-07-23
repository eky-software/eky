import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceCreditDraftRepository } from '../ports/invoiceCreditDraftRepository.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { toCreditInvoiceDraftView } from './creditInvoiceDraftModel.js';
import type { CreditInvoiceDraftView } from './creditInvoiceDraftView.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

export interface GetCreditInvoiceDraftInput {
  actorContext: ActorContext;
  invoiceDraftId: string;
}

export interface GetCreditInvoiceDraftDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceCreditDraftRepository: InvoiceCreditDraftRepository;
  invoiceDraftRepository: InvoiceDraftRepository;
}

export async function getCreditInvoiceDraft(
  input: GetCreditInvoiceDraftInput,
  dependencies: GetCreditInvoiceDraftDependencies,
): Promise<CreditInvoiceDraftView> {
  requirePermission(input.actorContext, 'manageInvoiceCorrections');

  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );
  const draft = await dependencies.invoiceDraftRepository.getDraftById(
    companyId,
    invoiceDraftId,
  );

  if (
    draft === undefined ||
    draft.invoiceKind !== 'credit' ||
    draft.creditedInvoiceId === null
  ) {
    throw new InvoiceDraftNotFoundError();
  }

  const sourceInvoice =
    await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
      companyId,
      draft.creditedInvoiceId,
    );

  if (sourceInvoice === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  const previousAllocations =
    await dependencies.invoiceCreditDraftRepository.listPreviousCreditLineAllocations(
      companyId,
      sourceInvoice.id,
    );

  return toCreditInvoiceDraftView(draft, sourceInvoice, previousAllocations);
}
