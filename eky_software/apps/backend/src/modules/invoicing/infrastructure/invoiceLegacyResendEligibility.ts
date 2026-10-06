import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';

export function hasUnresolvedInvoiceDeliveryHistory(database: DatabaseConnection, scope: InvoiceScope): boolean {
  return database.prepare<[string, string], { id: string }>(`
    SELECT id FROM invoice_delivery_events WHERE company_id = ? AND invoice_id = ?
      AND (status IN ('attempted', 'outcomeUnknown')
        OR (binding_kind = 'legacyOriginal' AND provider = 'smtp' AND status = 'failed')) LIMIT 1
  `).get(scope.companyId, scope.invoiceId) !== undefined;
}

// The caller owns the read/publication/reservation transaction. No recipient-based mode inference.
export function readLegacyResendSourceId(database: DatabaseConnection, scope: InvoiceScope): string | undefined {
  if (hasUnresolvedInvoiceDeliveryHistory(database, scope)) return undefined;
  const references = database.prepare<[string, string], { document_id: string | null }>(`
    SELECT DISTINCT e.document_id FROM invoices i
    JOIN invoice_current_revisions c ON c.company_id = i.company_id AND c.invoice_id = i.id
    JOIN invoice_content_revisions r ON r.company_id = c.company_id
      AND r.invoice_id = c.invoice_id AND r.id = c.revision_id
    JOIN invoice_delivery_events e ON e.company_id = i.company_id AND e.invoice_id = i.id
    WHERE i.company_id = ? AND i.id = ? AND i.status = 'sent'
      AND r.origin = 'legacySnapshot' AND r.vat_breakdown_state = 'unavailable'
      AND e.binding_kind = 'legacyOriginal'
    LIMIT 2
  `).all(scope.companyId, scope.invoiceId);
  return references.length === 1 ? references[0]?.document_id ?? undefined : undefined;
}
