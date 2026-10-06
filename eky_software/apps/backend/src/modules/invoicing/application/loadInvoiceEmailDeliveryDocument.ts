import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import type { InvoiceDocumentKey } from '../ports/invoiceDocumentRepository.js';
import type { StoredInvoiceDocumentFile } from './readStoredInvoiceDocument.js';

export interface InvoiceEmailDeliveryDocument {
  readonly content: Uint8Array;
  readonly metadata: RevisionInvoiceDocumentMetadata;
  readonly target: RevisionInvoiceDeliveryTarget;
}

export interface LoadInvoiceEmailDeliveryDocumentDependencies {
  ensureApprovedInvoicePdfDocument(input: GenerateApprovedInvoicePdfDocumentInput): Promise<RevisionInvoiceDocumentMetadata>;
  readStoredInvoiceDocument(input: InvoiceDocumentKey): Promise<StoredInvoiceDocumentFile>;
}

// Load one exact revision document. Only the later reservation authorizes delivery.
export async function loadInvoiceEmailDeliveryDocument(
  input: GenerateApprovedInvoicePdfDocumentInput,
  dependencies: LoadInvoiceEmailDeliveryDocumentDependencies,
): Promise<InvoiceEmailDeliveryDocument> {
  const expected = await dependencies.ensureApprovedInvoicePdfDocument(input);
  if (expected.companyId !== input.companyId || expected.invoiceId !== input.invoiceId
    || expected.binding.kind !== 'revision') throw new InvoiceDocumentIntegrityError();
  const document = await dependencies.readStoredInvoiceDocument({
    companyId: input.companyId, invoiceId: input.invoiceId, documentId: expected.id,
  });
  const actual = document.metadata;
  if (actual.companyId !== expected.companyId || actual.invoiceId !== expected.invoiceId
    || actual.id !== expected.id || actual.binding.kind !== 'revision'
    || actual.binding.revisionId !== expected.binding.revisionId
    || actual.sha256 !== expected.sha256 || actual.sizeBytes !== expected.sizeBytes
    || actual.storagePath !== expected.storagePath || actual.fileName !== expected.fileName
    || actual.mimeType !== expected.mimeType || actual.documentType !== expected.documentType) {
    document.content.fill(0);
    throw new InvoiceDocumentIntegrityError();
  }
  const metadata: RevisionInvoiceDocumentMetadata = { ...actual, binding: actual.binding };
  return {
    content: document.content, metadata,
    target: {
      companyId: metadata.companyId, invoiceId: metadata.invoiceId,
      documentId: metadata.id, ...metadata.binding,
      sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
    },
  };
}
