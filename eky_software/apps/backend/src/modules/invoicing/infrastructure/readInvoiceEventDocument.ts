import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceEventDocument } from '../ports/invoiceDeliveryEventReader.js';
import { validateInvoiceEventDocumentBinding, validateInvoiceEventReference } from './invoiceEventDocumentBinding.js';
import { readInvoiceDocumentMetadata } from './readInvoiceDocumentMetadata.js';

type EventBindingRow = Pick<InvoiceDeliveryEventRow,
  'document_id' | 'binding_kind' | 'revision_id' | 'send_mode' | 'document_sha256' | 'document_size_bytes'>;

export function readInvoiceEventDocument(
  database: DatabaseConnection,
  scope: InvoiceScope,
  eventId: string,
): InvoiceEventDocument | undefined {
  return database.transaction((): InvoiceEventDocument | undefined => {
    const event = database.prepare<[string, string, string], EventBindingRow>(`
      SELECT document_id, binding_kind, revision_id, send_mode, document_sha256, document_size_bytes
      FROM invoice_delivery_events WHERE company_id = ? AND invoice_id = ? AND id = ?
    `).get(scope.companyId, scope.invoiceId, eventId);
    if (event === undefined) return undefined;
    const reference = validateInvoiceEventReference({
      legacyOriginal: event.binding_kind === 'legacyOriginal',
      legacyFieldsValid: event.revision_id === null && event.send_mode === 'legacyUnknown'
        && event.document_sha256 === null && event.document_size_bytes === null,
      documentAbsent: event.document_id === null,
    });
    if (reference === 'legacyMissingDocument') {
      if (database.prepare<[string, string], { id: string }>(`
        SELECT id FROM invoices WHERE company_id = ? AND id = ?
      `).get(scope.companyId, scope.invoiceId) === undefined) throw new InvoiceDocumentIntegrityError();
      return { kind: 'legacyMissingDocument' };
    }
    if (event.document_id === null) throw new InvoiceDocumentIntegrityError();
    const document = readInvoiceDocumentMetadata(database, { ...scope, documentId: event.document_id });
    if (document === undefined) throw new InvoiceDocumentIntegrityError();
    validateInvoiceEventDocumentBinding({
      documentKind: document.binding.kind,
      kindMatches: document.binding.kind === event.binding_kind,
      revisionMatches: document.binding.kind === 'revision' && document.binding.revisionId === event.revision_id,
      revisionModeAllowed: ['customer', 'smtpTest', 'dryRun', 'manual'].includes(event.send_mode),
      preservedLegacyFieldsValid: event.revision_id === null && event.send_mode === 'customer',
      evidenceMatches: document.sha256 === event.document_sha256 && document.sizeBytes === event.document_size_bytes,
    });
    return { kind: 'document', document };
  }).deferred();
}
