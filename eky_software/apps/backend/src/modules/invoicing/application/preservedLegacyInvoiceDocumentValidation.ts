import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import type { InvoiceLegacyResendDocuments } from '../ports/invoiceLegacyResendReader.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';

export function assertLegacyResendSelection(scope: InvoiceScope, { source, preserved }: InvoiceLegacyResendDocuments): void {
  if (source.companyId !== scope.companyId || source.invoiceId !== scope.invoiceId
    || source.binding.kind !== 'legacyOriginal') throw new InvoiceDocumentIntegrityError();
  if (preserved !== undefined && (preserved.companyId !== scope.companyId || preserved.invoiceId !== scope.invoiceId
    || preserved.binding.kind !== 'preservedLegacy' || preserved.binding.sourceDocumentId !== source.id
    || preserved.id === source.id || preserved.storagePath === source.storagePath
    || preserved.sha256 !== source.sha256 || preserved.sizeBytes !== source.sizeBytes)) {
    throw new InvoiceDocumentIntegrityError();
  }
}

export function sameLegacyResendDocument(first: ApprovedInvoiceDocumentMetadata, second: ApprovedInvoiceDocumentMetadata): boolean {
  return first.id === second.id && first.companyId === second.companyId && first.invoiceId === second.invoiceId
    && first.storagePath === second.storagePath && first.sha256 === second.sha256 && first.sizeBytes === second.sizeBytes
    && first.fileName === second.fileName && first.mimeType === second.mimeType
    && first.documentType === second.documentType && first.createdAt === second.createdAt;
}

export async function readVerifiedLegacyDocument(
  document: ApprovedInvoiceDocumentMetadata,
  storage: Pick<InvoiceDocumentStorage, 'readVerifiedDocument'>,
): Promise<Uint8Array> {
  try { return await storage.readVerifiedDocument(document); }
  catch { throw new InvoiceDocumentIntegrityError(); }
}
