import type {
  ApprovedInvoiceDocumentType,
} from '../domain/approvedInvoiceDocument.js';

export const invoiceBackupArtifactMaximumCount = 100_000;
export const invoiceBackupArtifactMaximumTextBytes = 1_024;

export interface InvoiceBackupArtifactCatalogItem {
  companyId: string;
  documentId: string;
  documentType: ApprovedInvoiceDocumentType;
  fileName: string;
  invoiceId: string;
  mediaType: 'application/pdf';
  sha256: string;
  sizeBytes: number;
  storagePath: string;
}

export interface InvoiceBackupArtifactCatalog {
  listAuthoritativeArtifacts(): Promise<
    readonly InvoiceBackupArtifactCatalogItem[]
  >;
}
