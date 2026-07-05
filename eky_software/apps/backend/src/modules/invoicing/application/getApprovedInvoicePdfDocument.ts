import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';

const approvedInvoicePdfDocumentType = 'approved_invoice_pdf';

export interface ApprovedInvoicePdfDocumentFile {
  content: Uint8Array;
  metadata: ApprovedInvoiceDocumentMetadata;
}

export interface GetApprovedInvoicePdfDocumentInput {
  companyId: string;
  invoiceId: string;
}

export interface GetApprovedInvoicePdfDocumentDependencies {
  invoiceDocumentRepository: InvoiceDocumentRepository;
  invoiceDocumentStorage: InvoiceDocumentStorage;
}

export async function getApprovedInvoicePdfDocument(
  input: GetApprovedInvoicePdfDocumentInput,
  dependencies: GetApprovedInvoicePdfDocumentDependencies,
): Promise<ApprovedInvoicePdfDocumentFile> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');

  const metadata =
    await dependencies.invoiceDocumentRepository.findDocumentForInvoice(
      companyId,
      invoiceId,
      approvedInvoicePdfDocumentType,
    );

  if (metadata === undefined) {
    throw new ApprovedInvoiceDocumentNotFoundError();
  }

  try {
    const content = await dependencies.invoiceDocumentStorage.readFile(
      metadata.storagePath,
    );

    return { content, metadata };
  } catch {
    throw new ApprovedInvoiceDocumentNotFoundError();
  }
}
