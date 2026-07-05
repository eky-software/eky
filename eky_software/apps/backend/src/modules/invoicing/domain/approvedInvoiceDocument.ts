export type ApprovedInvoiceDocumentType = 'approved_invoice_pdf';

export interface ApprovedInvoiceDocumentMetadata {
  id: string;
  companyId: string;
  invoiceId: string;
  documentType: ApprovedInvoiceDocumentType;
  fileName: string;
  storagePath: string;
  mimeType: 'application/pdf';
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}
