import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventRow, InvoiceDocumentRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { validateStoredDocument } from './readInvoiceDocumentMetadata.js';
import { readInvoiceEventDocument } from './readInvoiceEventDocument.js';

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

  const events = database.prepare<[], InvoiceDeliveryEventRow>(`
    SELECT event.*, binding_kind, revision_id, send_mode, document_sha256, document_size_bytes
    FROM invoice_delivery_events event
  `).all();
  const unresolvedInvoices = new Set<string>();
  for (const event of events) {
    if (!['prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown'].includes(event.status)
      || !['email', 'manual', 'print', 'other'].includes(event.delivery_method)
      || !['dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other'].includes(event.provider)) fail();
    if (readInvoiceEventDocument(database, {
      companyId: event.company_id, invoiceId: event.invoice_id,
    }, event.id) === undefined) fail();
    if (event.binding_kind === 'legacyOriginal') continue;

    const validMode = (event.send_mode === 'customer' || event.send_mode === 'smtpTest')
      ? event.delivery_method === 'email' && event.provider === 'smtp'
      : event.send_mode === 'dryRun'
        ? event.delivery_method === 'email' && event.provider === 'dryRun'
        : event.send_mode === 'manual' && ['manual', 'print'].includes(event.delivery_method)
          && event.provider === 'manual';
    if (!validMode) fail();
    if (event.provider === 'smtp' && ['attempted', 'outcomeUnknown'].includes(event.status)) {
      const key = JSON.stringify([event.company_id, event.invoice_id]);
      if (unresolvedInvoices.has(key)) fail();
      unresolvedInvoices.add(key);
    }
  }
}

function fail(): never {
  throw new InvoiceDocumentIntegrityError();
}
