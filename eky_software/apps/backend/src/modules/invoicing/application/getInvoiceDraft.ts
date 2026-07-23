import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedInvoiceDraftTotals } from '../domain/invoiceViewTotals.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

const maximumIdentifierLength = 200;

export interface GetInvoiceDraftInput {
  companyId: string;
  invoiceDraftId: string;
}

export async function getInvoiceDraft(
  input: GetInvoiceDraftInput,
  invoiceDraftRepository: InvoiceDraftRepository,
): Promise<InvoiceDraft> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );

  if (invoiceDraftId.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError('Invoice draft id is invalid.');
  }

  const invoiceDraft = await invoiceDraftRepository.getDraftById(
    companyId,
    invoiceDraftId,
  );

  if (invoiceDraft === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  if (invoiceDraft.invoiceKind !== 'standard') {
    throw new InvoiceDraftValidationError(
      'Credit invoice drafts use the credit correction workflow.',
    );
  }

  return withCalculatedInvoiceDraftTotals(invoiceDraft);
}
