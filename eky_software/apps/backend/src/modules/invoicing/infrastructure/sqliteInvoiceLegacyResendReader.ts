import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceLegacyResendDocuments, InvoiceLegacyResendReader } from '../ports/invoiceLegacyResendReader.js';
import { readLegacyResendSourceId } from './invoiceLegacyResendEligibility.js';
import { readInvoiceDocumentMetadata } from './readInvoiceDocumentMetadata.js';

export class SqliteInvoiceLegacyResendReader implements InvoiceLegacyResendReader {
  constructor(private readonly database: DatabaseConnection) {}

  async findDocuments(scope: InvoiceScope): Promise<InvoiceLegacyResendDocuments | undefined> {
    return this.database.transaction(() => {
      const sourceId = readLegacyResendSourceId(this.database, scope);
      if (sourceId === undefined) return undefined;
      const source = readInvoiceDocumentMetadata(this.database, { ...scope, documentId: sourceId });
      if (source === undefined || source.binding.kind !== 'legacyOriginal') throw new InvoiceDocumentIntegrityError();
      const copies = this.database.prepare<[string, string, string], { id: string }>(`
        SELECT id FROM invoice_documents WHERE company_id = ? AND invoice_id = ?
          AND binding_kind = 'preservedLegacy' AND source_document_id = ? LIMIT 2
      `).all(scope.companyId, scope.invoiceId, sourceId);
      if (copies.length > 1) throw new InvoiceDocumentIntegrityError();
      const copy = copies[0];
      const preserved = copy === undefined ? undefined
        : readInvoiceDocumentMetadata(this.database, { ...scope, documentId: copy.id });
      if (copy !== undefined && (preserved === undefined || preserved.binding.kind !== 'preservedLegacy')) {
        throw new InvoiceDocumentIntegrityError();
      }
      return { source: { ...source, binding: source.binding },
        preserved: preserved?.binding.kind === 'preservedLegacy' ? { ...preserved, binding: preserved.binding } : undefined };
    }).deferred();
  }
}
