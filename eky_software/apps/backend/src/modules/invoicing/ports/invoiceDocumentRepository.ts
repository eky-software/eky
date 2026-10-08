import type {
  ApprovedInvoiceDocumentMetadata,
  PreservedLegacyInvoiceDocumentMetadata,
  RevisionInvoiceDocumentMetadata,
  StoredInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceRevisionKey, InvoiceScope } from '../domain/invoiceContentRevision.js';

export type InvoiceDocumentCandidate = Readonly<Omit<
  ApprovedInvoiceDocumentMetadata,
  'companyId' | 'invoiceId' | 'documentType' | 'mimeType'
>>;

export type InvoiceDocumentKey = InvoiceScope & Readonly<{ documentId: string }>;

export type PublishRevisionDocumentInput = Readonly<{
  key: InvoiceRevisionKey;
  candidate: InvoiceDocumentCandidate;
}>;

export type PublishPreservedLegacyDocumentInput = Readonly<{
  scope: InvoiceScope;
  source: Readonly<{ documentId: string; sha256: string; sizeBytes: number }>;
  candidate: InvoiceDocumentCandidate;
}>;

export type PublishInvoiceDocumentResult<T> =
  | Readonly<{ outcome: 'published' | 'existing'; document: T }>
  | Readonly<{ outcome: 'conflict' }>;

export interface InvoiceDocumentRepository {
  findDocumentForRevision(key: InvoiceRevisionKey): Promise<RevisionInvoiceDocumentMetadata | undefined>;

  findCurrentDocumentForRevision(key: InvoiceRevisionKey): Promise<RevisionInvoiceDocumentMetadata | undefined>;

  findDocumentById(key: InvoiceDocumentKey): Promise<StoredInvoiceDocumentMetadata | undefined>;

  publishDocumentIfCurrent(
    input: PublishRevisionDocumentInput,
  ): Promise<PublishInvoiceDocumentResult<RevisionInvoiceDocumentMetadata>>;

  publishPreservedLegacyDocument(
    input: PublishPreservedLegacyDocumentInput,
  ): Promise<PublishInvoiceDocumentResult<PreservedLegacyInvoiceDocumentMetadata>>;
}
