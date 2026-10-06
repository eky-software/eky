import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

// Only the migrated, still-approved snapshot is held. Neither addresses nor times identify a test send.
export function requiresLegacyInvoiceDeliveryReview(database: DatabaseConnection, scope: InvoiceScope): boolean {
  return database.prepare<[string, string], { id: string }>(`
    SELECT i.id FROM invoices i
    JOIN invoice_current_revisions c ON c.company_id = i.company_id AND c.invoice_id = i.id
    JOIN invoice_content_revisions r ON r.company_id = c.company_id
      AND r.invoice_id = c.invoice_id AND r.id = c.revision_id
    WHERE i.company_id = ? AND i.id = ? AND i.status = 'approved'
      AND r.origin = 'legacySnapshot' AND EXISTS (
        SELECT 1 FROM invoice_delivery_events e
        WHERE e.company_id = i.company_id AND e.invoice_id = i.id
          AND e.binding_kind = 'legacyOriginal' AND e.provider = 'smtp'
      )
    LIMIT 1
  `).get(scope.companyId, scope.invoiceId) !== undefined;
}
