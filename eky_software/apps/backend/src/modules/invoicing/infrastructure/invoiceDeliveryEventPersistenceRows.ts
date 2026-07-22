import type {
  InvoiceDeliveryEventRow,
  NewInvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';

export type InvoiceDeliveryEventInsertParameters = NewInvoiceDeliveryEventRow;

export type InvoiceDeliveryEventSummaryRow = Pick<
  InvoiceDeliveryEventRow,
  | 'id'
  | 'created_at'
  | 'delivery_method'
  | 'provider'
  | 'recipient_email'
  | 'cc_email'
  | 'safe_error_message'
  | 'status'
>;

export function toRow(
  event: InvoiceDeliveryEvent,
): NewInvoiceDeliveryEventRow {
  return {
    id: event.id,
    company_id: event.companyId,
    invoice_id: event.invoiceId,
    document_id: event.documentId,
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
  return {
    ccEmail: row.cc_email,
    createdAt: row.created_at,
    deliveryMethod:
      row.delivery_method as InvoiceDeliveryEventSummary['deliveryMethod'],
    id: row.id,
    provider: row.provider as InvoiceDeliveryEventSummary['provider'],
    recipientEmail: row.recipient_email,
    safeErrorMessage: row.safe_error_message,
    status: row.status as InvoiceDeliveryEventSummary['status'],
  };
}
