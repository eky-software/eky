import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';
import {
  type InvoiceDraftContentInput,
  prepareInvoiceDraftContent,
} from './prepareInvoiceDraftContent.js';

const maximumIdentifierLength = 200;

export interface UpdateInvoiceDraftInput extends InvoiceDraftContentInput {
  companyId: string;
  invoiceDraftId: string;
}

export interface UpdateInvoiceDraftDependencies {
  customerAccessReader: CustomerAccessReader;
  invoiceDraftRepository: InvoiceDraftRepository;
}

function createNextUpdatedAt(previousUpdatedAt: string): string {
  const currentTime = Date.now();
  const previousTime = Date.parse(previousUpdatedAt);
  const nextTime =
    Number.isNaN(previousTime) || currentTime > previousTime
      ? currentTime
      : previousTime + 1;

  return new Date(nextTime).toISOString();
}

export async function updateInvoiceDraft(
  input: UpdateInvoiceDraftInput,
  dependencies: UpdateInvoiceDraftDependencies,
): Promise<InvoiceDraft> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );

  if (invoiceDraftId.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError('Invoice draft id is invalid.');
  }

  const existingDraft =
    await dependencies.invoiceDraftRepository.getDraftById(
      companyId,
      invoiceDraftId,
    );

  if (existingDraft === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  if (existingDraft.status !== 'draft') {
    throw new InvoiceDraftValidationError(
      'Only invoice drafts can be updated.',
    );
  }

  const customerId = requireIdentifier(input.customerId, 'Customer id');
  const customerBelongsToCompany =
    await dependencies.customerAccessReader.belongsToCompany(
      customerId,
      companyId,
    );

  if (!customerBelongsToCompany) {
    throw new InvoiceDraftValidationError(
      'Customer is not available for invoicing.',
    );
  }

  const content = prepareInvoiceDraftContent(input);
  const updatedDraft: InvoiceDraft = {
    ...content,
    id: existingDraft.id,
    companyId,
    status: 'draft',
    createdAt: existingDraft.createdAt,
    updatedAt: createNextUpdatedAt(existingDraft.updatedAt),
  };
  const savedDraft =
    await dependencies.invoiceDraftRepository.updateDraft(updatedDraft);

  if (savedDraft === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  return savedDraft;
}
