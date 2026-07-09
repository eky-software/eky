import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';

export type ApprovedInvoiceEmailProvider = 'dryRun';

export interface ApprovedInvoiceEmailAttachmentPreview {
  documentId: string;
  fileName: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
}

export interface ApprovedInvoiceEmailPreview {
  provider: ApprovedInvoiceEmailProvider;
  invoiceId: string;
  invoiceNumber: string;
  to: string;
  subject: string;
  body: string;
  attachment: ApprovedInvoiceEmailAttachmentPreview;
}

export interface ApprovedInvoiceEmailDryRunSend {
  provider: 'dryRun';
  invoiceId: string;
  invoiceNumber: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachment: ApprovedInvoiceEmailAttachmentPreview;
}

export interface ApprovedInvoiceEmailDryRunProviderResult {
  provider: 'dryRun';
  providerMessageId: string | null;
}

export function createApprovedInvoiceEmailAttachmentPreview(
  document: ApprovedInvoiceDocumentMetadata,
): ApprovedInvoiceEmailAttachmentPreview {
  return {
    documentId: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
  };
}
