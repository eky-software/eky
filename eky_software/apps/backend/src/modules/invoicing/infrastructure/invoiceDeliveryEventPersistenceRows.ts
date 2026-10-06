import type {
  InvoiceDeliveryEventRow,
  NewInvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceRecordedDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';

export type InvoiceDeliveryEventInsertParameters = NewInvoiceDeliveryEventRow;

export type InvoiceDeliveryEventSummaryRow = Pick<
  InvoiceDeliveryEventRow,
  | 'id'
  | 'created_at'
  | 'delivery_method'
  | 'provider'
  | 'send_mode'
  | 'binding_kind'
  | 'document_id'
  | 'recipient_email'
  | 'cc_email'
  | 'safe_error_message'
  | 'status'
>;

export function toRow(
  event: InvoiceRecordedDeliveryEvent,
): NewInvoiceDeliveryEventRow {
  return {
    id: event.id,
    company_id: event.companyId,
    invoice_id: event.invoiceId,
    document_id: event.documentId,
    binding_kind: 'revision',
    revision_id: event.target.revisionId,
    send_mode: event.provider,
    document_sha256: event.target.sha256,
    document_size_bytes: event.target.sizeBytes,
    delivery_method: event.deliveryMethod,
    provider: event.provider,
    status: event.status,
    recipient_email: event.recipientEmail,
    cc_email: event.ccEmail,
    subject: event.subject,
    body_preview: event.bodyPreview,
    provider_message_id: event.providerMessageId,
    safe_error_message: event.safeErrorMessage,
    technical_error_code: event.technicalErrorCode,
    created_at: event.createdAt,
    created_by: event.createdBy,
  };
}

export function toInvoiceDeliveryEvent(
  row: InvoiceDeliveryEventRow,
): InvoiceDeliveryEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    invoiceId: row.invoice_id,
    documentId: row.document_id,
    deliveryMethod: row.delivery_method as InvoiceDeliveryEvent['deliveryMethod'],
    provider: row.provider as InvoiceDeliveryEvent['provider'],
    status: row.status as InvoiceDeliveryEvent['status'],
    recipientEmail: row.recipient_email,
    ccEmail: row.cc_email,
    subject: row.subject,
    bodyPreview: row.body_preview,
    providerMessageId: row.provider_message_id,
    safeErrorMessage: row.safe_error_message,
    technicalErrorCode: row.technical_error_code,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function toInvoiceDeliveryEventSummary(
  row: InvoiceDeliveryEventSummaryRow,
): InvoiceDeliveryEventSummary {
  const sendMode = row.send_mode;
  const bindingKind = row.binding_kind;

  if (
    sendMode !== 'customer' &&
    sendMode !== 'smtpTest' &&
    sendMode !== 'dryRun' &&
    sendMode !== 'manual' &&
    sendMode !== 'legacyUnknown'
  ) {
    throw new InvoiceDocumentIntegrityError();
  }
  if (
    (bindingKind !== 'revision' &&
      bindingKind !== 'preservedLegacy' &&
      bindingKind !== 'legacyOriginal') ||
    (bindingKind === 'legacyOriginal' && sendMode !== 'legacyUnknown') ||
    (bindingKind === 'revision' && sendMode === 'legacyUnknown') ||
    (bindingKind === 'preservedLegacy' && sendMode !== 'customer') ||
    (row.document_id === null && bindingKind !== 'legacyOriginal') ||
    (row.document_id !== null &&
      (typeof row.document_id !== 'string' || row.document_id.trim() === ''))
  ) {
    throw new InvoiceDocumentIntegrityError();
  }
  if (
    ((sendMode === 'customer' || sendMode === 'smtpTest') &&
      (row.provider !== 'smtp' || row.delivery_method !== 'email')) ||
    (sendMode === 'dryRun' &&
      (row.provider !== 'dryRun' || row.delivery_method !== 'email')) ||
    (sendMode === 'manual' &&
      (row.provider !== 'manual' ||
        (row.delivery_method !== 'manual' && row.delivery_method !== 'print')))
  ) {
    throw new InvoiceDocumentIntegrityError();
  }

  return {
    ccEmail: row.cc_email,
    createdAt: row.created_at,
    deliveryMethod:
      row.delivery_method as InvoiceDeliveryEventSummary['deliveryMethod'],
    id: row.id,
    provider: row.provider as InvoiceDeliveryEventSummary['provider'],
    sendMode,
    documentSource:
      bindingKind === 'legacyOriginal' && row.document_id === null
        ? 'legacyMissingDocument'
        : bindingKind,
    recipientEmail: row.recipient_email,
    safeErrorMessage: row.safe_error_message,
    status: row.status as InvoiceDeliveryEventSummary['status'],
  };
}
