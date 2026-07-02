import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';

const maximumCompanyIdLength = 120;

export interface ListApprovedInvoicesInput {
  companyId: string;
}

export async function listApprovedInvoices(
  input: ListApprovedInvoicesInput,
  approvedInvoiceReader: ApprovedInvoiceReader,
): Promise<ApprovedInvoiceSummary[]> {
  validateCompanyId(input.companyId);

  return approvedInvoiceReader.listApprovedInvoiceSummaries(input.companyId);
}

function validateCompanyId(companyId: string): void {
  if (companyId.trim().length === 0) {
    throw new InvoiceDraftValidationError('Company id is required.');
  }

  if (companyId.length > maximumCompanyIdLength) {
    throw new InvoiceDraftValidationError('Company id is too long.');
  }
}
