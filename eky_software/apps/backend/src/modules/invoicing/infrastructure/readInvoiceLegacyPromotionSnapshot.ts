import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceContentRevisionRow, InvoiceLineRow, InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow, InvoiceRow,
} from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';
import {
  createInvoiceContentRevisionRow, createInvoiceRevisionLineRow, type InvoiceRevisionCreditSource,
} from './invoiceContentRevisionPersistenceRows.js';

export function readInvoiceLegacyPromotionSnapshot(database: DatabaseConnection, key: InvoiceRevisionKey) {
  if (!database.inTransaction) throw new InvoiceDeliveryConflictError();
  const invoice = database.prepare<[string, string], InvoiceRow>(`
    SELECT * FROM invoices WHERE company_id = ? AND id = ?
  `).get(key.companyId, key.invoiceId);
  const current = database.prepare<[string, string], { revision_id: string }>(`
    SELECT revision_id FROM invoice_current_revisions WHERE company_id = ? AND invoice_id = ?
  `).get(key.companyId, key.invoiceId);
  if (invoice?.status !== 'approved' || current?.revision_id !== key.revisionId) {
    throw new InvoiceDeliveryConflictError();
  }
  const header = database.prepare<[string, string, string], InvoiceContentRevisionRow>(`
    SELECT * FROM invoice_content_revisions WHERE company_id = ? AND invoice_id = ? AND id = ?
  `).get(key.companyId, key.invoiceId, key.revisionId);
  if (header === undefined) fail();
  if (header.origin !== 'legacySnapshot') throw new InvoiceDeliveryConflictError();
  // Inspect the full collection so malformed child scopes cannot disappear from the check.
  const lines = database.prepare<[string], InvoiceRevisionLineRow>(`
    SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order
  `).all(key.revisionId);
  const vat = database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`
    SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ? ORDER BY vat_rate_basis_points
  `).all(key.revisionId);
  const content = toInvoiceContentRevision(header, lines, vat);
  const source = requireCreditSource(database, content);
  if (invoice.invoice_kind !== content.invoiceKind || invoice.credited_invoice_id !== content.creditedInvoiceId) fail();
  const expectedHeader = {
    ...createInvoiceContentRevisionRow(invoice, key.revisionId, source),
    origin: header.origin,
    vat_breakdown_state: header.vat_breakdown_state,
  };
  for (const field of Object.keys(expectedHeader) as (keyof InvoiceContentRevisionRow)[]) {
    if (expectedHeader[field] !== header[field]) fail();
  }
  const currentLines = database.prepare<[string], InvoiceLineRow>(`
    SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order
  `).all(key.invoiceId);
  if (currentLines.length !== lines.length) fail();
  const expectedLines = currentLines.map((line, index) => {
    const expectedLine = createInvoiceRevisionLineRow(key.companyId, key.revisionId, line, source);
    const stored = lines[index];
    if (stored === undefined) fail();
    for (const field of Object.keys(expectedLine) as (keyof InvoiceRevisionLineRow)[]) {
      if (expectedLine[field] !== stored[field]) fail();
    }
    return expectedLine;
  });
  // Return only the existing explicit mapper's fields, not arbitrary SQL columns.
  return { header: expectedHeader, lines: expectedLines, content };
}

function requireCreditSource(
  database: DatabaseConnection, revision: InvoiceContentRevision,
): InvoiceRevisionCreditSource | null {
  if (revision.invoiceKind === 'standard') return null;
  const source = database.prepare<[string, string | null, string | null], InvoiceContentRevisionRow>(`
    SELECT r.* FROM invoice_content_revisions r
    JOIN invoices i ON i.company_id = r.company_id AND i.id = r.invoice_id
    WHERE r.company_id = ? AND r.invoice_id = ? AND r.id = ?
  `).get(revision.companyId, revision.creditedInvoiceId, revision.creditedRevisionId);
  if (source === undefined || source.invoice_kind !== 'standard' || source.credited_invoice_id !== null
    || source.invoice_number !== revision.creditedInvoiceNumberSnapshot
    || source.invoice_date !== revision.creditedInvoiceDateSnapshot) fail();
  const brokenLine = database.prepare<[string, string], { line_id: string }>(`
    SELECT l.line_id FROM invoice_revision_lines l
    WHERE l.revision_id = ? AND l.source_invoice_line_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM invoice_revision_lines s WHERE s.company_id = l.company_id
        AND s.invoice_id = ? AND s.revision_id = l.source_revision_id AND s.line_id = l.source_invoice_line_id
    ) LIMIT 1
  `).get(revision.revisionId, source.invoice_id);
  if (brokenLine !== undefined) fail();
  return {
    companyId: source.company_id, invoiceId: source.invoice_id, revisionId: source.id,
    invoiceNumber: source.invoice_number, invoiceDate: source.invoice_date,
  };
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
