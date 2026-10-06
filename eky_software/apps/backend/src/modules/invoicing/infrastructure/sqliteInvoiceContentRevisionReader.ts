import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
} from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceRevisionKey, InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';

export class SqliteInvoiceContentRevisionReader implements InvoiceContentRevisionReader {
  constructor(private readonly database: DatabaseConnection) {}

  async getCurrentRevision(scope: InvoiceScope): Promise<InvoiceContentRevision | undefined> {
    return this.database.transaction(() => {
      const current = this.database.prepare<[string, string], { revision_id: string }>(`
        SELECT revision_id FROM invoice_current_revisions
        WHERE company_id = ? AND invoice_id = ?
      `).get(scope.companyId, scope.invoiceId);
      if (current === undefined) return undefined;
      const revision = this.readRevision({ ...scope, revisionId: current.revision_id });
      if (revision === undefined) throw new InvoiceContentRevisionIntegrityError();
      return revision;
    }).deferred();
  }

  async getRevision(key: InvoiceRevisionKey): Promise<InvoiceContentRevision | undefined> {
    return this.database.transaction(() => this.readRevision(key)).deferred();
  }

  private readRevision(key: InvoiceRevisionKey): InvoiceContentRevision | undefined {
    const header = this.database.prepare<[string, string, string], InvoiceContentRevisionRow>(`
      SELECT * FROM invoice_content_revisions
      WHERE company_id = ? AND invoice_id = ? AND id = ?
    `).get(key.companyId, key.invoiceId, key.revisionId);
    if (header === undefined) return undefined;
    if (this.database.prepare<[string, string], { id: string }>(`
      SELECT id FROM invoices WHERE company_id = ? AND id = ?
    `).get(key.companyId, key.invoiceId) === undefined) throw new InvoiceContentRevisionIntegrityError();

    // Inspect the entire revision collection so corrupt child scoping cannot hide rows.
    const lines = this.database.prepare<[string], InvoiceRevisionLineRow>(`
      SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order
    `).all(key.revisionId);
    const vat = this.database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`
      SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ? ORDER BY vat_rate_basis_points
    `).all(key.revisionId);
    const revision = toInvoiceContentRevision(header, lines, vat);
    this.requireCreditSource(revision);
    return revision;
  }

  private requireCreditSource(revision: InvoiceContentRevision): void {
    if (revision.invoiceKind !== 'credit') return;
    const source = this.database.prepare<[string, string | null, string | null, string | null, string | null], { id: string }>(`
      SELECT source.id FROM invoice_content_revisions source
      JOIN invoices identity ON identity.company_id = source.company_id AND identity.id = source.invoice_id
      WHERE source.company_id = ? AND source.invoice_id = ? AND source.id = ?
        AND source.invoice_number = ? AND source.invoice_date = ?
        AND source.invoice_kind = 'standard' AND source.credited_invoice_id IS NULL
    `).get(revision.companyId, revision.creditedInvoiceId, revision.creditedRevisionId,
      revision.creditedInvoiceNumberSnapshot, revision.creditedInvoiceDateSnapshot);
    if (source === undefined) throw new InvoiceContentRevisionIntegrityError();

    const brokenLine = this.database.prepare<[string, string | null], { line_id: string }>(`
      SELECT line.line_id FROM invoice_revision_lines line
      WHERE line.revision_id = ? AND line.source_invoice_line_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_revision_lines source
        WHERE source.company_id = line.company_id AND source.invoice_id = ?
          AND source.revision_id = line.source_revision_id AND source.line_id = line.source_invoice_line_id
      ) LIMIT 1
    `).get(revision.revisionId, revision.creditedInvoiceId);
    if (brokenLine !== undefined) throw new InvoiceContentRevisionIntegrityError();
  }
}
