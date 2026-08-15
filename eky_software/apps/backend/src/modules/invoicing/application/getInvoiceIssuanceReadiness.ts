import {
  findInvoiceIssuanceReadinessIssues,
  type InvoiceIssuanceReadiness,
  type InvoiceIssuanceReadinessIssue,
} from '../domain/invoiceIssuanceReadiness.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceIssuanceReadinessReader } from '../ports/invoiceIssuanceReadinessReader.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

const maximumIdentifierLength = 200;

export interface GetInvoiceIssuanceReadinessInput {
  companyId: string;
  invoiceDraftId: string;
}

export async function getInvoiceIssuanceReadiness(
  input: GetInvoiceIssuanceReadinessInput,
  reader: InvoiceIssuanceReadinessReader,
): Promise<InvoiceIssuanceReadiness> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(
    input.invoiceDraftId,
    'Invoice draft id',
  );

  if (invoiceDraftId.length > maximumIdentifierLength) {
    throw new InvoiceDraftValidationError('Invoice draft id is invalid.');
  }

  const data = await reader.getReadinessData(companyId, invoiceDraftId);

  if (data === undefined) {
    throw new InvoiceDraftNotFoundError();
  }

  const issues: InvoiceIssuanceReadinessIssue[] =
    data.hasActiveInvoiceNumberingSettings
      ? []
      : ['invoiceNumberingSettingsMissing'];
  issues.push(...findInvoiceIssuanceReadinessIssues(data));

  return {
    isReady: issues.length === 0,
    issues,
  };
}
