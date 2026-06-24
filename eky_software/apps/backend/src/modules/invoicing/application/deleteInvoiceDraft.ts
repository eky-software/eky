import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

const maximumIdentifierLength = 200;

export interface DeleteInvoiceDraftInput {
  companyId: string;
  invoiceDraftId: string;
}

export async function deleteInvoiceDraft(
  input: DeleteInvoiceDraftInput,
  invoiceDraftRepository: InvoiceDraftRepository,
): Promise<void> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );

  if (invoiceDraftId.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError('Invoice draft id is invalid.');
  }

  const wasDeleted = await invoiceDraftRepository.deleteDraft(
    companyId,
    invoiceDraftId,
  );

  if (!wasDeleted) {
    throw new InvoiceDraftNotFoundError();
  }
}
