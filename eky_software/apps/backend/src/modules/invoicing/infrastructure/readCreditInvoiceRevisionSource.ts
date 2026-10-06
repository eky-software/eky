import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';

export function readCreditInvoiceRevisionSource(
  database: DatabaseConnection,
  companyId: string,
  invoiceId: string,
): { header: InvoiceContentRevisionRow; lines: InvoiceRevisionLineRow[] } | undefined {
  if (!database.inTransaction) {
    throw new Error('Credit source revision requires the approval transaction.');
  }

  // Eligibility is live; the content and line identity are immutable.
  const eligible = database.prepare<[string, string], { id: string }>(`
    SELECT id FROM invoices
    WHERE company_id = ? AND id = ? AND invoice_kind = 'standard' AND status = 'sent'
  `).get(companyId, invoiceId);
  if (eligible === undefined) {
    return undefined;
  }

  const header = database.prepare<[string, string], InvoiceContentRevisionRow>(`
    SELECT revision.* FROM invoice_current_revisions current
    JOIN invoice_content_revisions revision
      ON revision.company_id = current.company_id
      AND revision.invoice_id = current.invoice_id
      AND revision.id = current.revision_id
    WHERE current.company_id = ? AND current.invoice_id = ?
  `).get(companyId, invoiceId);
  if (
    header === undefined ||
    header.invoice_kind !== 'standard' ||
    header.credited_invoice_id !== null
  ) {
    throw new ApproveInvoiceDraftError('Credit source revision is unavailable or inconsistent.');
  }

  const lines = database.prepare<[string, string, string], InvoiceRevisionLineRow>(`
    SELECT * FROM invoice_revision_lines
    WHERE company_id = ? AND invoice_id = ? AND revision_id = ?
    ORDER BY line_order
  `).all(companyId, invoiceId, header.id);
  if (lines.length === 0) {
    throw new ApproveInvoiceDraftError('Credit source revision has no lines.');
  }

  return { header, lines };
}
