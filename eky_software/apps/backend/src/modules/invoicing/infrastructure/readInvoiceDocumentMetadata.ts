import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDocumentRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDocumentKey } from '../ports/invoiceDocumentRepository.js';
import { toStoredInvoiceDocument } from './invoiceDocumentPersistenceMapping.js';

// Callers keep the metadata and its reference checks in one read transaction.
export function readInvoiceDocumentMetadata(
  database: DatabaseConnection,
  key: InvoiceDocumentKey,
): StoredInvoiceDocumentMetadata | undefined {
  const row = database.prepare<[string, string, string], InvoiceDocumentRow>(`
    SELECT * FROM invoice_documents WHERE company_id = ? AND invoice_id = ? AND id = ?
  `).get(key.companyId, key.invoiceId, key.documentId);
  return row === undefined ? undefined : validateStoredDocument(database, row);
}

export function validateStoredDocument(
  database: DatabaseConnection,
  row: InvoiceDocumentRow,
): StoredInvoiceDocumentMetadata {
  const document = toStoredInvoiceDocument(row);
  if (database.prepare<[string, string], { id: string }>(`
    SELECT id FROM invoices WHERE company_id = ? AND id = ?
  `).get(row.company_id, row.invoice_id) === undefined) throw new InvoiceDocumentIntegrityError();
  if (document.binding.kind === 'revision') {
    if (database.prepare<[string, string, string], { id: string }>(`
      SELECT id FROM invoice_content_revisions WHERE company_id = ? AND invoice_id = ? AND id = ?
        AND origin IN ('approval', 'validatedLegacySnapshot') AND vat_breakdown_state = 'authoritative'
    `).get(row.company_id, row.invoice_id, document.binding.revisionId) === undefined) {
      throw new InvoiceDocumentIntegrityError();
    }
  } else if (document.binding.kind === 'preservedLegacy') {
    const sourceRow = database.prepare<[string, string, string], InvoiceDocumentRow>(`
      SELECT * FROM invoice_documents WHERE company_id = ? AND invoice_id = ? AND id = ?
    `).get(row.company_id, row.invoice_id, document.binding.sourceDocumentId);
    const source = sourceRow === undefined ? undefined : toStoredInvoiceDocument(sourceRow);
    if (source === undefined || source.binding.kind !== 'legacyOriginal'
      || source.sha256 !== document.sha256 || source.sizeBytes !== document.sizeBytes
      || source.storagePath === document.storagePath) throw new InvoiceDocumentIntegrityError();
  }
  return document;
}
