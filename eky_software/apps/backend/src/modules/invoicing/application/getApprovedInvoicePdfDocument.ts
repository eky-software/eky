import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDocumentPreviewReader } from '../ports/invoiceDocumentPreviewReader.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentReadConflictError } from './invoiceDocumentReadConflictError.js';
import { readStoredInvoiceDocument, type ReadStoredInvoiceDocumentDependencies } from './readStoredInvoiceDocument.js';

export interface ApprovedInvoicePdfDocumentFile {
  content: Uint8Array;
  metadata: ApprovedInvoiceDocumentMetadata;
}

export interface GetApprovedInvoicePdfDocumentInput {
  companyId: string;
  invoiceId: string;
}

export interface GetApprovedInvoicePdfDocumentDependencies extends ReadStoredInvoiceDocumentDependencies {
  invoiceDocumentPreviewReader: InvoiceDocumentPreviewReader;
}

export async function getApprovedInvoicePdfDocument(
  input: GetApprovedInvoicePdfDocumentInput,
  dependencies: GetApprovedInvoicePdfDocumentDependencies,
): Promise<ApprovedInvoicePdfDocumentFile> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');

  const scope = { companyId, invoiceId };
  const reader = dependencies.invoiceDocumentPreviewReader;
  const documentId = await reader.findPreviewDocumentId(scope);
  if (documentId === undefined) throw new ApprovedInvoiceDocumentNotFoundError();

  const document = await readStoredInvoiceDocument({ ...scope, documentId }, dependencies)
    .catch((error: unknown) => {
      // A selected non-null reference must not silently become an absent PDF.
      if (error instanceof ApprovedInvoiceDocumentNotFoundError) throw new InvoiceDocumentIntegrityError();
      throw error;
    });
  if (await reader.findPreviewDocumentId(scope) !== documentId) throw new InvoiceDocumentReadConflictError();
  return document;
}
