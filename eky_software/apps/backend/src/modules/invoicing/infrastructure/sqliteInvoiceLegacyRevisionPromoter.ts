import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRevisionVatBreakdownRow } from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../domain/invoiceLegacyDeliveryReviewRequiredError.js';
import { validateLegacyInvoiceRevisionTotals } from '../domain/validateLegacyInvoiceRevisionTotals.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { toInvoiceContentRevision } from './invoiceContentRevisionMapping.js';
import { hasUnresolvedInvoiceDeliveryHistory } from './invoiceLegacyResendEligibility.js';
import { readInvoiceLegacyPromotionSnapshot } from './readInvoiceLegacyPromotionSnapshot.js';
import { requiresLegacyInvoiceDeliveryReview } from './requiresLegacyInvoiceDeliveryReview.js';

export class SqliteInvoiceLegacyRevisionPromoter implements InvoiceLegacyRevisionPromoter {
  constructor(private readonly database: DatabaseConnection) {}

  async promoteLegacyRevisionIfCurrent(expected: InvoiceRevisionKey): Promise<InvoiceContentRevision> {
    if ([expected.companyId, expected.invoiceId, expected.revisionId].some(
      value => typeof value !== 'string' || value.length === 0 || value.trim() !== value,
    )) throw new InvoiceDeliveryConflictError();
    return this.database.transaction(() => {
      const snapshot = readInvoiceLegacyPromotionSnapshot(this.database, expected);
      if (requiresLegacyInvoiceDeliveryReview(this.database, expected)) {
        throw new InvoiceLegacyDeliveryReviewRequiredError();
      }
      if (hasUnresolvedInvoiceDeliveryHistory(this.database, expected)
        || this.database.prepare<[string, string], { id: string }>(`
          SELECT id FROM invoice_delivery_events WHERE company_id = ? AND invoice_id = ?
            AND provider = 'smtp' LIMIT 1
        `).get(expected.companyId, expected.invoiceId) !== undefined) throw new InvoiceDeliveryConflictError();

      const totals = validateTotals(snapshot.content);
      const revisionId = randomUUID();
      const header = { ...snapshot.header, id: revisionId,
        origin: 'validatedLegacySnapshot' as const, vat_breakdown_state: 'authoritative' as const };
      const lines = snapshot.lines.map(line => ({ ...line, revision_id: revisionId }));
      const vat: InvoiceRevisionVatBreakdownRow[] = totals.vatBreakdown.map(group => ({
        company_id: expected.companyId, invoice_id: expected.invoiceId, revision_id: revisionId,
        vat_rate_basis_points: group.vatRateBasisPoints,
        net_cents: group.netCents, vat_cents: group.vatCents, gross_cents: group.grossCents,
      }));
      const promoted = toInvoiceContentRevision(header, lines, vat);
      // Columns originate only from the explicit internal mapper, never the caller or SELECT *.
      const lineColumns = Object.keys(lines[0]!);
      const insertLine = this.database.prepare(`
        INSERT INTO invoice_revision_lines (${lineColumns.join(', ')})
        VALUES (${lineColumns.map(column => '@' + column).join(', ')})
      `);
      for (const line of lines) insertLine.run(line);
      const insertVat = this.database.prepare<InvoiceRevisionVatBreakdownRow>(`
        INSERT INTO invoice_revision_vat_breakdown (
          company_id, invoice_id, revision_id, vat_rate_basis_points, net_cents, vat_cents, gross_cents
        ) VALUES (@company_id, @invoice_id, @revision_id, @vat_rate_basis_points, @net_cents, @vat_cents, @gross_cents)
      `);
      for (const group of vat) insertVat.run(group);
      const columns = Object.keys(header);
      // The header seals the children; pointer failure rolls the complete publication back.
      this.database.prepare(`
        INSERT INTO invoice_content_revisions (${columns.join(', ')})
        VALUES (${columns.map(column => '@' + column).join(', ')})
      `).run(header);
      const result = this.database.prepare(`
        UPDATE invoice_current_revisions SET revision_id = ?
        WHERE company_id = ? AND invoice_id = ? AND revision_id = ?
      `).run(revisionId, expected.companyId, expected.invoiceId, expected.revisionId);
      if (result.changes !== 1) throw new InvoiceDeliveryConflictError();
      return promoted;
    }).immediate();
  }
}

function validateTotals(content: InvoiceContentRevision) {
  try {
    return validateLegacyInvoiceRevisionTotals(content);
  } catch {
    throw new InvoiceContentRevisionIntegrityError();
  }
}
