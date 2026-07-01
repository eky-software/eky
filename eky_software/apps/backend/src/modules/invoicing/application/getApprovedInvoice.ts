import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';

const maximumInvoiceIdLength = 120;

export interface GetApprovedInvoiceInput {
  companyId: string;
  invoiceId: string;
}

export async function getApprovedInvoice(
  input: GetApprovedInvoiceInput,
  approvedInvoiceReader: ApprovedInvoiceReader,
): Promise<ApprovedInvoiceView> {
  validateGetApprovedInvoiceInput(input);

  const invoice = await approvedInvoiceReader.getApprovedInvoiceById(
    input.companyId,
    input.invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  return invoice;
}

function validateGetApprovedInvoiceInput(input: GetApprovedInvoiceInput): void {
  validateIdentifier(input.companyId, 'Company id');
  validateIdentifier(input.invoiceId, 'Invoice id');
}

function validateIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new InvoiceDraftValidationError(`${label} is required.`);
  }

  if (value.length > maximumInvoiceIdLength) {
    throw new InvoiceDraftValidationError(`${label} is too long.`);
  }
}
