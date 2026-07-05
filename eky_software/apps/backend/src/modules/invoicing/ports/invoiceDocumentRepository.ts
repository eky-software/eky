import type {
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoiceDocumentType,
} from '../domain/approvedInvoiceDocument.js';

export interface InvoiceDocumentRepository {
  deleteDocumentsForInvoice(
    companyId: string,
    invoiceId: string,
    documentType: ApprovedInvoiceDocumentType,
  ): Promise<string[]>;

  findDocumentForInvoice(
    companyId: string,
    invoiceId: string,
    documentType: ApprovedInvoiceDocumentType,
  ): Promise<ApprovedInvoiceDocumentMetadata | undefined>;

  saveDocument(
    metadata: ApprovedInvoiceDocumentMetadata,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
}
