import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDraftDeliveryHistoryIntegrityError } from '../application/invoiceDraftDeliveryHistoryIntegrityError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type {
  InvoiceDraftDeliveryHistory,
  InvoiceDraftDeliveryHistoryReader,
} from '../ports/invoiceDraftDeliveryHistoryReader.js';
import { SqliteInvoiceDeliveryEventQueries } from './sqliteInvoiceDeliveryEventQueries.js';

interface InvoiceIdentityRow {
  id: string;
  status: string;
  invoice_kind: string;
  credited_invoice_id: string | null;
}

export class SqliteInvoiceDraftDeliveryHistoryReader implements InvoiceDraftDeliveryHistoryReader {
  private readonly events: SqliteInvoiceDeliveryEventQueries;

  constructor(private readonly database: DatabaseConnection) {
    this.events = new SqliteInvoiceDeliveryEventQueries(database);
  }

  async findDeliveryHistory(input: {
    companyId: string;
    invoiceDraftId: string;
  }): Promise<InvoiceDraftDeliveryHistory | undefined> {
    return this.database.transaction(() => {
      const draft = this.database.prepare<[string, string], { present: number }>(`
        SELECT 1 AS present FROM invoice_drafts
        WHERE company_id = ? AND id = ? AND status = 'draft'
          AND approved_invoice_id IS NULL
          AND invoice_kind = 'standard' AND credited_invoice_id IS NULL
      `).get(input.companyId, input.invoiceDraftId);
      if (draft === undefined) return undefined;

      // The unique company/source-draft relation owns identity, not ID spelling
      // or a filtered reopened-only query that could hide an inconsistent bind.
      const invoice = this.database.prepare<[string, string], InvoiceIdentityRow>(`
        SELECT id, status, invoice_kind, credited_invoice_id FROM invoices
        WHERE company_id = ? AND source_draft_id = ?
      `).get(input.companyId, input.invoiceDraftId);
      if (invoice === undefined) return { invoiceId: null, events: [] };
      if (invoice.status !== 'reopened_for_edit' || invoice.invoice_kind !== 'standard'
        || invoice.credited_invoice_id !== null) {
        throw new InvoiceDraftDeliveryHistoryIntegrityError();
      }

      try {
        if (requireIdentifier(invoice.id, 'Invoice id') !== invoice.id) {
          throw new InvoiceDraftDeliveryHistoryIntegrityError();
        }
        return {
          invoiceId: invoice.id,
          events: this.events.listDeliveryEvents(input.companyId, invoice.id),
        };
      } catch (error) {
        if (error instanceof InvoiceDocumentIntegrityError || error instanceof InvoiceDraftValidationError) {
          throw new InvoiceDraftDeliveryHistoryIntegrityError();
        }
        throw error;
      }
    }).deferred();
  }
}
