import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { InvoiceCreditContextReader } from '../ports/invoiceCreditContextReader.js';

const maximumIdentifierLength = 120;

export interface GetInvoiceCreditContextInput {
  companyId: string;
  sourceInvoiceId: string;
}

export async function getInvoiceCreditContext(
  input: GetInvoiceCreditContextInput,
  reader: InvoiceCreditContextReader,
): Promise<InvoiceCreditContext> {
  validateIdentifier(input.companyId, 'Company id');
  validateIdentifier(input.sourceInvoiceId, 'Invoice id');

  const context = await reader.getInvoiceCreditContext(
    input.companyId,
    input.sourceInvoiceId,
  );

  if (context === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  return context;
}

function validateIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvoiceDraftValidationError(`${label} is required.`);
  }

  if (value.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError(`${label} is too long.`);
  }
}
