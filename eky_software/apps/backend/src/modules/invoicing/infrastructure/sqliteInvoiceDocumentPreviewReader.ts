import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceDocumentPreviewReader } from '../ports/invoiceDocumentPreviewReader.js';

export class SqliteInvoiceDocumentPreviewReader implements InvoiceDocumentPreviewReader {
  constructor(private readonly database: DatabaseConnection) {}

  async findPreviewDocumentId(scope: InvoiceScope): Promise<string | undefined> {
    return this.database.transaction(() => {
      const invoice = this.database.prepare<[string, string], { status: string }>(`
        SELECT status FROM invoices WHERE company_id = ? AND id = ?
      `).get(scope.companyId, scope.invoiceId);
      if (invoice === undefined || invoice.status === 'reopened_for_edit') return undefined;
      if (!['approved', 'sent', 'cancelled'].includes(invoice.status)) throw new InvoiceDocumentIntegrityError();

      const revision = this.database.prepare<[string, string], {
        id: string; origin: string; vat_breakdown_state: string;
      }>(`
        SELECT r.id, r.origin, r.vat_breakdown_state FROM invoice_current_revisions c
        JOIN invoice_content_revisions r ON r.company_id = c.company_id
          AND r.invoice_id = c.invoice_id AND r.id = c.revision_id
        WHERE c.company_id = ? AND c.invoice_id = ?
      `).get(scope.companyId, scope.invoiceId);
      if (revision === undefined) throw new InvoiceDocumentIntegrityError();

      let documents: { id: string }[];
      if (revision.origin === 'legacySnapshot' && revision.vat_breakdown_state === 'unavailable') {
        // Only the explicit migrated origin permits the original legacy preview.
        documents = this.database.prepare<[string, string], { id: string }>(`
          SELECT id FROM invoice_documents WHERE company_id = ? AND invoice_id = ?
            AND binding_kind = 'legacyOriginal' AND document_type = 'approved_invoice_pdf'
          LIMIT 2
        `).all(scope.companyId, scope.invoiceId);
      } else if (['approval', 'validatedLegacySnapshot'].includes(revision.origin)
        && revision.vat_breakdown_state === 'authoritative') {
        documents = this.database.prepare<[string, string, string], { id: string }>(`
          SELECT id FROM invoice_documents WHERE company_id = ? AND invoice_id = ?
            AND revision_id = ? AND binding_kind = 'revision' AND document_type = 'approved_invoice_pdf'
          LIMIT 2
        `).all(scope.companyId, scope.invoiceId, revision.id);
      } else {
        throw new InvoiceDocumentIntegrityError();
      }
      if (documents.length > 1) throw new InvoiceDocumentIntegrityError();
      return documents[0]?.id;
    }).deferred();
  }
}
