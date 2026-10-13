import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDocumentRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { validateStoredDocument } from './readInvoiceDocumentMetadata.js';
import { validateInvoiceHistoryEvents } from './invoiceHistoryEventScan.js';

export function validateInvoiceRevisionCatalogDocuments(database: DatabaseConnection): void {
  const documents = database.prepare<[], InvoiceDocumentRow>(`
    SELECT document.*, binding_kind, revision_id, source_document_id FROM invoice_documents document
  `).all();
  const documentKeys = new Set<string>();
  const paths = new Set<string>();
  for (const row of documents) {
    const document = validateStoredDocument(database, row);
    const binding = document.binding;
    const key = JSON.stringify([document.companyId, document.invoiceId, document.documentType, binding.kind,
      binding.kind === 'revision' ? binding.revisionId
        : binding.kind === 'preservedLegacy' ? binding.sourceDocumentId : null]);
    if (documentKeys.has(key) || paths.has(document.storagePath)) fail();
    documentKeys.add(key);
    paths.add(document.storagePath);
  }

  validateInvoiceHistoryEvents(database);
}

function fail(): never {
  throw new InvoiceDocumentIntegrityError();
}
