import type {
  LegacyOriginalInvoiceDocumentBinding,
  PreservedLegacyInvoiceDocumentBinding,
  RevisionInvoiceDocumentBinding,
} from './invoiceDocumentBinding.js';

export const approvedInvoicePdfDocumentType = 'approved_invoice_pdf';
export const approvedInvoicePdfMimeType = 'application/pdf';

export type ApprovedInvoiceDocumentType = typeof approvedInvoicePdfDocumentType;

export interface ApprovedInvoiceDocumentMetadata {
  id: string;
  companyId: string;
  invoiceId: string;
  documentType: ApprovedInvoiceDocumentType;
  fileName: string;
  storagePath: string;
  mimeType: typeof approvedInvoicePdfMimeType;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export type RevisionInvoiceDocumentMetadata = Readonly<ApprovedInvoiceDocumentMetadata> &
  Readonly<{ binding: RevisionInvoiceDocumentBinding }>;

export type PreservedLegacyInvoiceDocumentMetadata = Readonly<ApprovedInvoiceDocumentMetadata> &
  Readonly<{ binding: PreservedLegacyInvoiceDocumentBinding }>;

export type LegacyOriginalInvoiceDocumentMetadata = Readonly<ApprovedInvoiceDocumentMetadata> &
  Readonly<{ binding: LegacyOriginalInvoiceDocumentBinding }>;

export type StoredInvoiceDocumentMetadata =
  | RevisionInvoiceDocumentMetadata
  | PreservedLegacyInvoiceDocumentMetadata
  | LegacyOriginalInvoiceDocumentMetadata;
