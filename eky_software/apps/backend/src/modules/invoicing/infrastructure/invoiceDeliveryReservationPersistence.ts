import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDeliveryReservation, InvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { isDocumentEvidence } from './invoiceDocumentPersistenceMapping.js';
import { hasUnresolvedInvoiceDeliveryHistory, readLegacyResendSourceId } from './invoiceLegacyResendEligibility.js';
import { readInvoiceDocumentMetadata } from './readInvoiceDocumentMetadata.js';
import { requiresLegacyInvoiceDeliveryReview } from './requiresLegacyInvoiceDeliveryReview.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../domain/invoiceLegacyDeliveryReviewRequiredError.js';

export function assertInvoiceDeliveryReservation(reservation: InvoiceDeliveryReservation): void {
  const target = reservation.target;
  if ((reservation.mode !== 'customer' && reservation.mode !== 'smtpTest')
    || (target.kind !== 'revision' && target.kind !== 'preservedLegacy')
    || (target.kind === 'preservedLegacy' && reservation.mode !== 'customer')
    ) throw new InvoiceDeliveryConflictError();
  assertInvoiceDeliveryTarget(target);
  if (typeof reservation.eventId !== 'string'
    || requireIdentifier(reservation.eventId, 'Delivery identity') !== reservation.eventId) {
    throw new InvoiceDeliveryConflictError();
  }
}

export function assertInvoiceDeliveryTarget(target: InvoiceDeliveryTarget): void {
  if (target === undefined || target === null
    || (target.kind !== 'revision' && target.kind !== 'preservedLegacy')
    || !isDocumentEvidence(target.sha256, target.sizeBytes)) throw new InvoiceDeliveryConflictError();
  const identifiers = [target.companyId, target.invoiceId, target.documentId,
    target.kind === 'revision' ? target.revisionId : target.sourceDocumentId];
  if (identifiers.some((value) => typeof value !== 'string'
    || requireIdentifier(value, 'Delivery identity') !== value)) throw new InvoiceDeliveryConflictError();
}

export function documentMatchesDeliveryTarget(
  document: StoredInvoiceDocumentMetadata,
  target: InvoiceDeliveryTarget,
): boolean {
  return document.companyId === target.companyId && document.invoiceId === target.invoiceId
    && document.id === target.documentId && document.sha256 === target.sha256
    && document.sizeBytes === target.sizeBytes
    && ((target.kind === 'revision' && document.binding.kind === 'revision'
      && target.revisionId === document.binding.revisionId)
      || (target.kind === 'preservedLegacy' && document.binding.kind === 'preservedLegacy'
        && target.sourceDocumentId === document.binding.sourceDocumentId));
}

export function readDeliveryTarget(database: DatabaseConnection, target: InvoiceDeliveryTarget): boolean {
  const document = readInvoiceDocumentMetadata(database, target);
  return document !== undefined && documentMatchesDeliveryTarget(document, target);
}

// Call inside the same write transaction as reservation or successful completion.
export function readEligibleDeliveryInvoice(
  database: DatabaseConnection,
  target: InvoiceDeliveryTarget,
): { status: 'approved' | 'sent' } | undefined {
  if (requiresLegacyInvoiceDeliveryReview(database, target)) {
    throw new InvoiceLegacyDeliveryReviewRequiredError();
  }
  const invoice = database.prepare<[string, string], {
    status: 'approved' | 'sent'; revision_id: string | null; origin: string | null;
  }>(`
    SELECT i.status, c.revision_id, r.origin FROM invoices i
    LEFT JOIN invoice_current_revisions c ON c.company_id = i.company_id AND c.invoice_id = i.id
    LEFT JOIN invoice_content_revisions r ON r.company_id = c.company_id
      AND r.invoice_id = c.invoice_id AND r.id = c.revision_id
    WHERE i.company_id = ? AND i.id = ? AND i.status IN ('approved', 'sent')
  `).get(target.companyId, target.invoiceId);
  if (invoice === undefined) return undefined;
  if (target.kind === 'revision') {
    return invoice.revision_id === target.revisionId
      && (invoice.origin === 'approval' || invoice.origin === 'validatedLegacySnapshot') ? invoice : undefined;
  }
  return invoice.status === 'sent' && invoice.origin === 'legacySnapshot' ? invoice : undefined;
}

export function hasBlockingDeliveryHistory(database: DatabaseConnection, target: InvoiceDeliveryTarget): boolean {
  const scope = [target.companyId, target.invoiceId] as [string, string];
  if (target.kind === 'preservedLegacy') {
    return readLegacyResendSourceId(database, target) !== target.sourceDocumentId;
  }
  if (hasUnresolvedInvoiceDeliveryHistory(database, target)) return true;
  if (target.kind === 'revision') {
    // Unknown legacy SMTP mode is not inferred from the recipient or invoice state.
    return database.prepare<[string, string], { id: string }>(`
      SELECT id FROM invoice_delivery_events WHERE company_id = ? AND invoice_id = ?
        AND binding_kind = 'legacyOriginal' AND provider = 'smtp' LIMIT 1
    `).get(...scope) !== undefined;
  }
  return true;
}
