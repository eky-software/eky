import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
  NewInvoiceLineRow,
  NewInvoiceRow,
} from '../../../database/schema.js';
import type { InvoiceTotals } from '../domain/invoiceCalculation.js';
import {
  createInvoiceContentRevisionRow,
  createInvoiceRevisionLineRow,
  type InvoiceRevisionCreditSource,
} from './invoiceContentRevisionPersistenceRows.js';

export function publishInvoiceApprovalRevision(
  database: DatabaseConnection,
  invoice: NewInvoiceRow,
  lines: readonly NewInvoiceLineRow[],
  totals: InvoiceTotals,
  source: InvoiceRevisionCreditSource | null,
): string {
  if (!database.inTransaction) {
    throw new Error('Invoice revision requires the approval transaction.');
  }
  if (
    invoice.status !== 'approved' ||
    lines.some((line) => line.invoice_id !== invoice.id) ||
    totals.netTotalCents !== invoice.total_net_cents ||
    totals.vatTotalCents !== invoice.total_vat_cents ||
    totals.grossTotalCents !== invoice.total_gross_cents
  ) {
    throw new Error('Invoice revision approval content is inconsistent.');
  }

  const revisionId = randomUUID();
  const header = createInvoiceContentRevisionRow(invoice, revisionId, source);
  const insertLine = database.prepare<InvoiceRevisionLineRow>(`
    INSERT INTO invoice_revision_lines (
      company_id, invoice_id, revision_id, line_id, source_invoice_line_id,
      source_revision_id, line_order, code, description, quantity_hundredths,
      unit, unit_price_cents, vat_rate_basis_points, discount_type, discount_value,
      base_cents, discount_cents, net_cents, vat_cents, gross_cents, created_at
    ) VALUES (
      @company_id, @invoice_id, @revision_id, @line_id, @source_invoice_line_id,
      @source_revision_id, @line_order, @code, @description, @quantity_hundredths,
      @unit, @unit_price_cents, @vat_rate_basis_points, @discount_type, @discount_value,
      @base_cents, @discount_cents, @net_cents, @vat_cents, @gross_cents, @created_at
    )
  `);
  const insertVat = database.prepare<InvoiceRevisionVatBreakdownRow>(`
    INSERT INTO invoice_revision_vat_breakdown (
      company_id, invoice_id, revision_id, vat_rate_basis_points,
      net_cents, vat_cents, gross_cents
    ) VALUES (
      @company_id, @invoice_id, @revision_id, @vat_rate_basis_points,
      @net_cents, @vat_cents, @gross_cents
    )
  `);

  // Deferred children precede the header that seals the complete collections.
  for (const line of lines) {
    insertLine.run(createInvoiceRevisionLineRow(invoice.company_id, revisionId, line, source));
  }
  for (const vat of totals.vatBreakdown) {
    insertVat.run({
      company_id: invoice.company_id,
      invoice_id: invoice.id,
      revision_id: revisionId,
      vat_rate_basis_points: vat.vatRateBasisPoints,
      net_cents: vat.netCents,
      vat_cents: vat.vatCents,
      gross_cents: vat.grossCents,
    });
  }

  // Column names come only from the explicit internal mapper, never an input key.
  const columns = Object.keys(header);
  database.prepare(`
    INSERT INTO invoice_content_revisions (${columns.join(', ')})
    VALUES (${columns.map((column) => '@' + column).join(', ')})
  `).run(header);
  database.prepare(`
    INSERT INTO invoice_current_revisions (company_id, invoice_id, revision_id)
    VALUES (?, ?, ?)
    ON CONFLICT (company_id, invoice_id) DO UPDATE SET revision_id = excluded.revision_id
  `).run(invoice.company_id, invoice.id, revisionId);

  return revisionId;
}
