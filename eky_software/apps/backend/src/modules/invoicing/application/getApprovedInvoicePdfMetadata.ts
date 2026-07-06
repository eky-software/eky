import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';

export interface GetApprovedInvoicePdfMetadataInput {
  companyId: string;
  invoiceId: string;
}

interface GetApprovedInvoicePdfMetadataDependencies {
  invoiceDocumentRepository: InvoiceDocumentRepository;
  invoiceDocumentStorage: InvoiceDocumentStorage;
}

export async function getApprovedInvoicePdfMetadata(
  input: GetApprovedInvoicePdfMetadataInput,
  dependencies: GetApprovedInvoicePdfMetadataDependencies,
): Promise<ApprovedInvoiceDocumentMetadata> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');

  const metadata =
    await dependencies.invoiceDocumentRepository.findDocumentForInvoice(
      companyId,
      invoiceId,
      'approved_invoice_pdf',
    );

  if (metadata === undefined) {
    throw new ApprovedInvoiceDocumentNotFoundError();
  }

  try {
    await dependencies.invoiceDocumentStorage.readFile(metadata.storagePath);
  } catch {
    throw new ApprovedInvoiceDocumentNotFoundError();
  }

  return metadata;
}
