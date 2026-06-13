import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';

const maximumIdentifierLength = 200;

export interface ListInvoiceDraftsInput {
  companyId: string;
  customerId?: string;
}

function normalizeOptionalCustomerId(
  customerId: string | undefined,
): string | undefined {
  if (customerId === undefined) {
    return undefined;
  }

  const normalizedCustomerId = requireIdentifier(customerId, 'Customer id');

  if (normalizedCustomerId.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError('Customer id is invalid.');
  }

  return normalizedCustomerId;
}

export async function listInvoiceDrafts(
  input: ListInvoiceDraftsInput,
  invoiceDraftRepository: InvoiceDraftRepository,
): Promise<InvoiceDraftSummary[]> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const customerId = normalizeOptionalCustomerId(input.customerId);

  return invoiceDraftRepository.listDraftSummaries(companyId, customerId);
}
