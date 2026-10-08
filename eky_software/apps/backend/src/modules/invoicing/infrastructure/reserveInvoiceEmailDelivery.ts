import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryReservation } from '../domain/invoiceDeliveryReservation.js';
import { normalizeDeliveryBodyPreview, normalizeDeliveryCreatedBy, normalizeDeliveryEmail, normalizeDeliverySubject } from '../domain/invoiceDeliveryEventRules.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ReserveEmailDeliveryInput, ReserveEmailDeliveryResult } from '../ports/invoiceDeliveryEventRepository.js';
import { assertInvoiceDeliveryReservation, hasBlockingDeliveryHistory, readDeliveryTarget, readEligibleDeliveryInvoice } from './invoiceDeliveryReservationPersistence.js';

export function reserveInvoiceEmailDelivery(
  database: DatabaseConnection,
  input: ReserveEmailDeliveryInput,
): ReserveEmailDeliveryResult {
  assertInvoiceDeliveryReservation(input);
  const fields = {
    recipient_email: normalizeDeliveryEmail(input.recipientEmail),
    cc_email: normalizeDeliveryEmail(input.ccEmail),
    subject: normalizeDeliverySubject(input.subject),
    body_preview: normalizeDeliveryBodyPreview(input.bodyPreview),
    created_at: requireIdentifier(input.createdAt, 'Delivery timestamp'),
    created_by: normalizeDeliveryCreatedBy(input.createdBy),
  };
  if (fields.recipient_email.length === 0 || (input.mode === 'smtpTest' && fields.cc_email !== '')) {
    throw new InvoiceDeliveryConflictError();
  }
  return database.transaction((): ReserveEmailDeliveryResult => {
    const target = input.target;
    const invoice = readEligibleDeliveryInvoice(database, target);
    if (invoice === undefined || hasBlockingDeliveryHistory(database, target)
      || !readDeliveryTarget(database, target)
      || database.prepare<[string], { id: string }>(
        'SELECT id FROM invoice_delivery_events WHERE id = ?',
      ).get(input.eventId) !== undefined) return { outcome: 'conflict' };
    database.prepare(`
      INSERT INTO invoice_delivery_events (
        id, company_id, invoice_id, document_id, delivery_method, provider, status,
        recipient_email, cc_email, subject, body_preview, created_at, created_by,
        binding_kind, revision_id, send_mode, document_sha256, document_size_bytes
      ) VALUES (
        @id, @company_id, @invoice_id, @document_id, 'email', 'smtp', 'attempted',
        @recipient_email, @cc_email, @subject, @body_preview, @created_at, @created_by,
        @binding_kind, @revision_id, @send_mode, @document_sha256, @document_size_bytes
      )
    `).run({
      ...fields, id: input.eventId, company_id: target.companyId, invoice_id: target.invoiceId,
      document_id: target.documentId, binding_kind: target.kind,
      revision_id: target.kind === 'revision' ? target.revisionId : null,
      send_mode: input.mode, document_sha256: target.sha256, document_size_bytes: target.sizeBytes,
    });
    const reservation: InvoiceDeliveryReservation = input.mode === 'smtpTest'
      ? { eventId: input.eventId, mode: input.mode, target: { ...input.target } }
      : { eventId: input.eventId, mode: input.mode, target: { ...input.target } };
    return { outcome: 'reserved', reservation, invoiceStatusAtReservation: invoice.status };
  }).immediate();
}
