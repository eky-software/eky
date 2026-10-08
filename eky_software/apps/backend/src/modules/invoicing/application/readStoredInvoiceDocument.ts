import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDocumentKey, InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';

export interface StoredInvoiceDocumentFile {
  readonly content: Uint8Array;
  readonly metadata: StoredInvoiceDocumentMetadata;
}

export interface ReadStoredInvoiceDocumentDependencies {
  invoiceDocumentRepository: Pick<InvoiceDocumentRepository, 'findDocumentById'>;
  invoiceDocumentStorage: Pick<InvoiceDocumentStorage, 'readVerifiedDocument'>;
}

// Exact document access is not a current-revision or delivery authorization check.
export async function readStoredInvoiceDocument(
  input: InvoiceDocumentKey,
  dependencies: ReadStoredInvoiceDocumentDependencies,
): Promise<StoredInvoiceDocumentFile> {
  const key = {
    companyId: requireIdentifier(input.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.invoiceId, 'Invoice id'),
    documentId: requireIdentifier(input.documentId, 'Invoice document id'),
  };
  const metadata = await dependencies.invoiceDocumentRepository.findDocumentById(key);
  if (metadata === undefined) throw new ApprovedInvoiceDocumentNotFoundError();
  if (metadata.companyId !== key.companyId || metadata.invoiceId !== key.invoiceId
    || metadata.id !== key.documentId) throw new InvoiceDocumentIntegrityError();

  try {
    const content = await dependencies.invoiceDocumentStorage.readVerifiedDocument(metadata);
    return { content, metadata };
  } catch {
    throw new InvoiceDocumentIntegrityError();
  }
}
