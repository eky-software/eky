import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';

export function toInvoiceDocumentResponse(document: ApprovedInvoiceDocumentMetadata): ApprovedInvoiceDocumentMetadata {
  return {
    id: document.id,
    companyId: document.companyId,
    invoiceId: document.invoiceId,
    documentType: document.documentType,
    fileName: document.fileName,
    storagePath: document.storagePath,
    mimeType: document.mimeType,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt,
  };
}
