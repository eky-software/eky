import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

export interface InvoiceDocumentFileEvidence {
  readonly storagePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface InvoiceDocumentFileCandidate extends InvoiceDocumentFileEvidence {
  // Only the unpublished candidate may be discarded, never a repository winner.
  discard(): Promise<void>;
}

export interface InvoiceDocumentStorage {
  readVerifiedDocument(document: InvoiceDocumentFileEvidence): Promise<Uint8Array>;
  writeCandidate(input: {
    scope: InvoiceScope;
    documentId: string;
    content: Uint8Array;
  }): Promise<InvoiceDocumentFileCandidate>;
}
