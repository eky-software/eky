import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { insert, oldState, type Row } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { insertInvoiceClone } from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { createLegacyPdfReadFixture } from './invoicePdfRead.fixture.js';
import { SqliteInvoiceContentRevisionReader } from './sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceLegacyRevisionPromoter } from './sqliteInvoiceLegacyRevisionPromoter.js';

export async function createLegacyPromotionFixture(options: {
  kind?: 'standard' | 'credit';
  beforeMigration?: (database: DatabaseConnection, invoiceId: string) => void;
} = {}) {
  const invoiceId = options.kind === 'credit' ? 'credit-1' : 'invoice-1';
  const f = await createLegacyPdfReadFixture(false, database => {
    // Correct the generic read fixture before the real 039 migration freezes it.
    database.exec(`
      UPDATE invoice_lines SET discount_type = 'none', discount_value = 0 WHERE id = 'line-2';
      UPDATE invoice_lines SET discount_type = 'fixed', discount_value = 2000,
        vat_cents = 4590, gross_cents = 22590 WHERE id = 'line-1';
      UPDATE invoices SET total_vat_cents = 5590, total_gross_cents = 35590 WHERE id = 'invoice-1';
    `);
    if (options.kind === 'credit') {
      database.exec("UPDATE invoices SET status = 'sent' WHERE id = 'invoice-1'");
      insertInvoiceClone(database, {
        id: invoiceId, sourceDraftId: 'credit-draft', invoiceKind: 'credit', creditedInvoiceId: 'invoice-1',
        invoiceNumber: '20260002', status: 'approved', totalGrossCents: 112, invoiceDate: '2026-07-01',
      });
      database.prepare('UPDATE invoices SET total_net_cents = 102, total_vat_cents = 10 WHERE id = ?').run(invoiceId);
      const source = database.prepare<[], Row>("SELECT * FROM invoice_lines WHERE id = 'line-1'").get()!;
      insert(database, 'invoice_lines', {
        ...source, id: 'credit-source-line', invoice_id: invoiceId, source_invoice_line_id: 'line-1',
        quantity_hundredths: 1, unit_price_cents: 2, discount_type: 'none', discount_value: 0,
        base_cents: 2, discount_cents: 0, net_cents: 2, vat_cents: 0, gross_cents: 2,
      });
      insert(database, 'invoice_lines', {
        ...source, id: 'credit-free-line', invoice_id: invoiceId, line_order: 2, source_invoice_line_id: null,
        quantity_hundredths: 100, unit_price_cents: 100, vat_rate_basis_points: 1000,
        discount_type: 'none', discount_value: 0, base_cents: 100, discount_cents: 0,
        net_cents: 100, vat_cents: 10, gross_cents: 110,
      });
      database.prepare("UPDATE invoice_documents SET invoice_id = ? WHERE id = 'legacy-document'").run(invoiceId);
    }
    options.beforeMigration?.(database, invoiceId);
  });
  const scope = { companyId: f.scope.companyId, invoiceId };
  const reader = new SqliteInvoiceContentRevisionReader(f.database);
  const original = await reader.getCurrentRevision(scope);
  if (original === undefined) throw new Error('Synthetic legacy current revision missing.');
  const key = { ...scope, revisionId: original.revisionId };
  return { ...f, scope, key, original, reader, promoter: new SqliteInvoiceLegacyRevisionPromoter(f.database) };
}

export function promotionPreservedState(database: DatabaseConnection) {
  return {
    ...oldState(database),
    ...Object.fromEntries([
      'invoice_drafts', 'invoice_audit_events', 'invoice_payment_events', 'invoice_number_sequences',
      'invoice_numbering_settings', 'invoice_numbering_active_series', 'invoice_numbering_series_events',
    ].map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])),
  };
}

export function insertLegacyPromotionEvent(database: DatabaseConnection, invoiceId: string, overrides: Row = {}) {
  insert(database, 'invoice_delivery_events', {
    id: 'old-delivery', company_id: 'dev-company', invoice_id: invoiceId, document_id: 'legacy-document',
    delivery_method: 'email', provider: 'smtp', status: 'succeeded', created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  });
}
