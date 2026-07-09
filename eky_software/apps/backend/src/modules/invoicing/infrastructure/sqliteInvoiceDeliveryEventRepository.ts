import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDeliveryEventRow,
  NewInvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

type InvoiceDeliveryEventInsertParameters = NewInvoiceDeliveryEventRow;

export class SqliteInvoiceDeliveryEventRepository
  implements InvoiceDeliveryEventRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    this.database
      .prepare<InvoiceDeliveryEventInsertParameters>(
        `
          INSERT INTO invoice_delivery_events (
            id,
            company_id,
            invoice_id,
            document_id,
            delivery_method,
            provider,
            status,
            recipient_email,
            cc_email,
            subject,
            body_preview,
            provider_message_id,
            safe_error_message,
            technical_error_code,
            created_at,
            created_by
          )
          VALUES (
            @id,
            @company_id,
            @invoice_id,
            @document_id,
            @delivery_method,
            @provider,
            @status,
            @recipient_email,
            @cc_email,
            @subject,
            @body_preview,
            @provider_message_id,
            @safe_error_message,
            @technical_error_code,
            @created_at,
            @created_by
          )
        `,
      )
      .run(toRow(event));

    return event;
  }
}

function toRow(event: InvoiceDeliveryEvent): NewInvoiceDeliveryEventRow {
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
