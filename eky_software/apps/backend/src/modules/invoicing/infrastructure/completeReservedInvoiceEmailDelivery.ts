import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { normalizeDeliveryProviderMessageId, normalizeDeliverySafeErrorMessage, normalizeDeliveryTechnicalErrorCode } from '../domain/invoiceDeliveryEventRules.js';
import type { CustomerEmailCompletionInput, OtherEmailCompletionInput, EmailCompletionResult } from '../domain/invoiceDeliveryReservation.js';
import { assertInvoiceDeliveryReservation, readDeliveryTarget, readEligibleDeliveryInvoice } from './invoiceDeliveryReservationPersistence.js';

export function completeReservedInvoiceEmailDelivery(
  database: DatabaseConnection,
  input: CustomerEmailCompletionInput | OtherEmailCompletionInput,
  customerSuccess: boolean,
): EmailCompletionResult {
  const { reservation, result } = input;
  assertInvoiceDeliveryReservation(reservation);
  if (!['succeeded', 'failed', 'outcomeUnknown'].includes(result.status)
    || customerSuccess !== (reservation.mode === 'customer' && result.status === 'succeeded')) {
    throw new InvoiceDeliveryConflictError();
  }
  const outcome = {
    status: result.status,
    provider_message_id: result.status === 'succeeded' ? normalizeDeliveryProviderMessageId(result.providerMessageId) : null,
    safe_error_message: result.status === 'succeeded' ? null : normalizeDeliverySafeErrorMessage(result.safeErrorMessage),
    technical_error_code: result.status === 'succeeded' ? null : normalizeDeliveryTechnicalErrorCode(result.technicalErrorCode),
  };
  return database.transaction((): EmailCompletionResult => {
    const target = reservation.target;
    const event = database.prepare<[string, string, string], InvoiceDeliveryEventRow>(`
      SELECT * FROM invoice_delivery_events WHERE company_id = ? AND invoice_id = ? AND id = ?
    `).get(target.companyId, target.invoiceId, reservation.eventId);
    if (event === undefined || event.provider !== 'smtp' || event.delivery_method !== 'email'
      || event.send_mode !== reservation.mode || event.binding_kind !== target.kind
      || event.document_id !== target.documentId || event.document_sha256 !== target.sha256
      || event.document_size_bytes !== target.sizeBytes
      || event.revision_id !== (target.kind === 'revision' ? target.revisionId : null)
      || !readDeliveryTarget(database, target)) throw new InvoiceDeliveryConflictError();
    if (event.status !== 'attempted') {
      if (event.status === outcome.status && event.provider_message_id === outcome.provider_message_id
        && event.safe_error_message === outcome.safe_error_message
        && event.technical_error_code === outcome.technical_error_code) return { outcome: 'alreadyCompleted' };
      throw new InvoiceDeliveryConflictError();
    }
    const invoice = outcome.status === 'succeeded' ? readEligibleDeliveryInvoice(database, target) : undefined;
    if (outcome.status === 'succeeded' && invoice === undefined) throw new InvoiceDeliveryConflictError();
    const update = database.prepare(`
      UPDATE invoice_delivery_events SET status = @status, provider_message_id = @provider_message_id,
        safe_error_message = @safe_error_message, technical_error_code = @technical_error_code
      WHERE company_id = @company_id AND invoice_id = @invoice_id AND id = @id AND status = 'attempted'
    `).run({ ...outcome, company_id: target.companyId, invoice_id: target.invoiceId, id: reservation.eventId });
    if (update.changes !== 1) throw new InvoiceDeliveryConflictError();
    if (customerSuccess && invoice?.status === 'approved') {
      const updated = database.prepare(`
        UPDATE invoices SET status = 'sent', updated_at = ? WHERE company_id = ? AND id = ? AND status = 'approved'
      `).run(event.created_at, target.companyId, target.invoiceId);
      if (updated.changes !== 1) throw new InvoiceDeliveryConflictError();
    }
    return { outcome: 'completed' };
  }).immediate();
}
