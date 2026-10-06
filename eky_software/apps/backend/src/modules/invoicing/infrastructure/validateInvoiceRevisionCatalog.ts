import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceContentRevisionRow,
  InvoiceLineRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
  InvoiceRow,
} from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';
import {
  createInvoiceContentRevisionRow,
  createInvoiceRevisionLineRow,
  type InvoiceRevisionCreditSource,
} from './invoiceContentRevisionPersistenceRows.js';

interface CatalogRevision {
  header: InvoiceContentRevisionRow;
  lines: readonly InvoiceRevisionLineRow[];
  content: InvoiceContentRevision;
}

// The owning catalog keeps all validation and artifact enumeration in one read transaction.
export function validateInvoiceRevisionCatalog(database: DatabaseConnection): void {
  const orphan = database.prepare<[], { invalid: number }>(`
    SELECT 1 AS invalid FROM invoice_revision_lines child
    WHERE NOT EXISTS (
      SELECT 1 FROM invoice_content_revisions parent WHERE parent.id = child.revision_id
        AND parent.company_id = child.company_id AND parent.invoice_id = child.invoice_id
    )
    UNION ALL
    SELECT 1 FROM invoice_revision_vat_breakdown child
    WHERE NOT EXISTS (
      SELECT 1 FROM invoice_content_revisions parent WHERE parent.id = child.revision_id
        AND parent.company_id = child.company_id AND parent.invoice_id = child.invoice_id
    )
    LIMIT 1
  `).get();
  if (orphan !== undefined) fail();

  const invoices = database.prepare<[], InvoiceRow>('SELECT * FROM invoices').all();
  const identities = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const headers = database.prepare<[], InvoiceContentRevisionRow>(`
    SELECT revision.*, origin, vat_breakdown_state, credited_revision_id,
      credited_invoice_number_snapshot, credited_invoice_date_snapshot
    FROM invoice_content_revisions revision ORDER BY id
  `).all();
  const readLines = database.prepare<[string], InvoiceRevisionLineRow>(`
    SELECT line.*, source_revision_id FROM invoice_revision_lines line
    WHERE revision_id = ? ORDER BY line_order
  `);
  const readVat = database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`
    SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ? ORDER BY vat_rate_basis_points
  `);
  const revisions = new Map<string, CatalogRevision>();
  const invoiceHistory = new Set<string>();
  for (const header of headers) {
    const invoice = identities.get(header.invoice_id);
    if (invoice === undefined || invoice.company_id !== header.company_id || revisions.has(header.id)) fail();
    const lines = readLines.all(header.id);
    const content = toInvoiceContentRevision(header, lines, readVat.all(header.id));
    revisions.set(header.id, { header, lines, content });
    invoiceHistory.add(invoice.id);
  }
  for (const { content } of revisions.values()) validateCreditSource(content, revisions);

  const currentRows = database.prepare<[], {
    company_id: string; invoice_id: string; revision_id: string;
  }>('SELECT company_id, invoice_id, revision_id FROM invoice_current_revisions').all();
  const currentInvoices = new Set<string>();
  for (const current of currentRows) {
    const invoice = identities.get(current.invoice_id);
    const revision = revisions.get(current.revision_id);
    if (invoice === undefined || revision === undefined || currentInvoices.has(current.invoice_id)
      || invoice.company_id !== current.company_id || revision.header.company_id !== current.company_id
      || revision.header.invoice_id !== current.invoice_id || invoice.status === 'reopened_for_edit') fail();
    currentInvoices.add(current.invoice_id);
    validateCurrentContent(database, invoice, revision);
  }
  for (const invoice of invoices) {
    if (!invoiceHistory.has(invoice.id)
      || !['approved', 'sent', 'cancelled', 'reopened_for_edit'].includes(invoice.status)
      || (invoice.status !== 'reopened_for_edit' && !currentInvoices.has(invoice.id))) fail();
  }
}

function validateCreditSource(
  revision: InvoiceContentRevision,
  revisions: ReadonlyMap<string, CatalogRevision>,
): void {
  if (revision.invoiceKind !== 'credit') return;
  const source = revision.creditedRevisionId === null ? undefined : revisions.get(revision.creditedRevisionId)?.content;
  if (source === undefined || source.companyId !== revision.companyId || source.invoiceId !== revision.creditedInvoiceId
    || source.invoiceKind !== 'standard' || source.invoiceNumber !== revision.creditedInvoiceNumberSnapshot
    || source.invoiceDate !== revision.creditedInvoiceDateSnapshot) fail();
  const sourceLines = new Set(source.lines.map((line) => line.lineId));
  for (const line of revision.lines) {
    if (line.sourceInvoiceLineId !== null && !sourceLines.has(line.sourceInvoiceLineId)) fail();
  }
}

function validateCurrentContent(
  database: DatabaseConnection,
  invoice: InvoiceRow,
  revision: CatalogRevision,
): void {
  const content = revision.content;
  const source: InvoiceRevisionCreditSource | null = content.invoiceKind === 'credit' ? {
    companyId: content.companyId,
    invoiceId: content.creditedInvoiceId!,
    revisionId: content.creditedRevisionId!,
    invoiceNumber: content.creditedInvoiceNumberSnapshot!,
    invoiceDate: content.creditedInvoiceDateSnapshot!,
  } : null;
  const expectedHeader = {
    ...createInvoiceContentRevisionRow(invoice, content.revisionId, source),
    origin: revision.header.origin,
    vat_breakdown_state: revision.header.vat_breakdown_state,
  };
  // Reuse the explicit snapshot field contract, excluding live payment/delivery/cancellation state.
  for (const key of Object.keys(expectedHeader) as (keyof InvoiceContentRevisionRow)[]) {
    if (expectedHeader[key] !== revision.header[key]) fail();
  }
  const lines = database.prepare<[string], InvoiceLineRow>(`
    SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order
  `).all(invoice.id);
  if (lines.length !== revision.lines.length) fail();
  lines.forEach((line, index) => {
    const expected = createInvoiceRevisionLineRow(invoice.company_id, content.revisionId, line, source);
    const stored = revision.lines[index];
    if (stored === undefined) fail();
    for (const key of Object.keys(expected) as (keyof InvoiceRevisionLineRow)[]) {
      if (expected[key] !== stored[key]) fail();
    }
  });
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
