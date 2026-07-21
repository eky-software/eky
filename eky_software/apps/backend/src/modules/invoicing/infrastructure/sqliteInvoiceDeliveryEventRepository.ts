import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDeliveryEventRow,
  NewInvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { CompleteInvoiceDeliveryEventInput } from '../ports/invoiceDeliveryEventRepository.js';
import type {
  CompleteSuccessfulInvoiceEmailDeliveryInput,
  CompleteSuccessfulInvoiceEmailDeliveryResult,
  InvoiceEmailDeliveryFinalizer,
} from '../ports/invoiceEmailDeliveryFinalizer.js';
import type {
  CompleteManualInvoiceDeliveryInput,
  CompleteManualInvoiceDeliveryResult,
  InvoiceManualDeliveryFinalizer,
} from '../ports/invoiceManualDeliveryFinalizer.js';

type InvoiceDeliveryEventInsertParameters = NewInvoiceDeliveryEventRow;

export class SqliteInvoiceDeliveryEventRepository
  implements
    InvoiceDeliveryEventRepository,
    InvoiceDeliveryEventReader,
    InvoiceEmailDeliveryFinalizer,
    InvoiceManualDeliveryFinalizer
{
  constructor(private readonly database: DatabaseConnection) {}

  async completeSuccessfulEmailDelivery(
    input: CompleteSuccessfulInvoiceEmailDeliveryInput,
  ): Promise<CompleteSuccessfulInvoiceEmailDeliveryResult> {
    const completeTransaction = this.database.transaction(() => {
      const invoice = this.database
        .prepare<
          { company_id: string; id: string },
          { status: 'approved' | 'sent'; updated_at: string }
        >(
          `
            SELECT status, updated_at
            FROM invoices
            WHERE
              company_id = @company_id
              AND id = @id
              AND status IN ('approved', 'sent')
          `,
        )
        .get({ company_id: input.companyId, id: input.invoiceId });

      if (invoice === undefined) {
        throw new Error('Approved invoice could not be finalized after delivery.');
      }

      const eventResult = this.database
        .prepare<{
          company_id: string;
          id: string;
          invoice_id: string;
          provider_message_id: string | null;
        }>(
          `
            UPDATE invoice_delivery_events
            SET
              status = 'succeeded',
              provider_message_id = @provider_message_id,
              safe_error_message = NULL,
              technical_error_code = NULL
            WHERE
              id = @id
              AND company_id = @company_id
              AND invoice_id = @invoice_id
              AND status = 'attempted'
          `,
        )
        .run({
          company_id: input.companyId,
          id: input.eventId,
          invoice_id: input.invoiceId,
          provider_message_id: input.providerMessageId,
        });

      if (eventResult.changes !== 1) {
        throw new Error('Invoice delivery event could not be completed.');
      }

      if (invoice.status === 'approved') {
        const invoiceResult = this.database
          .prepare<{
            company_id: string;
            id: string;
            sent_at: string;
          }>(
            `
              UPDATE invoices
              SET status = 'sent', updated_at = @sent_at
              WHERE
                company_id = @company_id
                AND id = @id
                AND status = 'approved'
            `,
          )
          .run({
            company_id: input.companyId,
            id: input.invoiceId,
            sent_at: input.sentAt,
          });

        if (invoiceResult.changes !== 1) {
          throw new Error('Approved invoice could not be marked sent.');
        }
      }

      return {
        invoiceStatus: 'sent' as const,
        updatedAt:
          invoice.status === 'approved' ? input.sentAt : invoice.updated_at,
        wasResend: invoice.status === 'sent',
      };
    });

    return completeTransaction();
  }

  async completeDeliveryEvent(
    input: CompleteInvoiceDeliveryEventInput,
  ): Promise<void> {
    const result = this.database
      .prepare<{
        company_id: string;
        id: string;
        provider_message_id: string | null;
        safe_error_message: string | null;
        status: CompleteInvoiceDeliveryEventInput['status'];
        technical_error_code: string | null;
      }>(
        `
          UPDATE invoice_delivery_events
          SET
            status = @status,
            provider_message_id = @provider_message_id,
            safe_error_message = @safe_error_message,
            technical_error_code = @technical_error_code
          WHERE id = @id AND company_id = @company_id AND status = 'attempted'
        `,
      )
      .run({
        company_id: input.companyId,
        id: input.eventId,
        provider_message_id: input.providerMessageId,
        safe_error_message: input.safeErrorMessage,
        status: input.status,
        technical_error_code: input.technicalErrorCode,
      });

    if (result.changes !== 1) {
      throw new Error('Invoice delivery event could not be completed.');
    }
  }

  async completeManualDelivery(
    input: CompleteManualInvoiceDeliveryInput,
  ): Promise<CompleteManualInvoiceDeliveryResult | undefined> {
    const completeTransaction = this.database.transaction(() => {
      const invoice = this.database
        .prepare<
          { company_id: string; id: string },
          {
            invoice_number: string;
            source_draft_id: string;
            status: 'approved' | 'sent';
            updated_at: string;
          }
        >(
          `
            SELECT status, source_draft_id, invoice_number, updated_at
            FROM invoices
            WHERE
              company_id = @company_id
              AND id = @id
              AND status IN ('approved', 'sent')
          `,
        )
        .get({ company_id: input.companyId, id: input.invoiceId });

      if (invoice === undefined) {
        return undefined;
      }

      if (invoice.status === 'sent') {
        return { updatedAt: invoice.updated_at };
      }

      const unresolvedDeliveryEvent = this.database
        .prepare<
          { company_id: string; invoice_id: string },
          { present: number }
        >(
          `
            SELECT 1 AS present
            FROM invoice_delivery_events
            WHERE
              company_id = @company_id
              AND invoice_id = @invoice_id
              AND status IN ('attempted', 'outcomeUnknown')
            LIMIT 1
          `,
        )
        .get({ company_id: input.companyId, invoice_id: input.invoiceId });

      if (unresolvedDeliveryEvent !== undefined) {
        throw new InvoiceDeliveryConflictError();
      }

      this.insertDeliveryEvent({
        bodyPreview: '',
        ccEmail: '',
        companyId: input.companyId,
        createdAt: input.deliveredAt,
        createdBy: input.actorUserId,
        deliveryMethod: input.deliveryMethod,
        documentId: input.documentId,
        id: input.deliveryEventId,
        invoiceId: input.invoiceId,
        provider: 'manual',
        providerMessageId: null,
        recipientEmail: '',
        safeErrorMessage: null,
        status: 'succeeded',
        subject: '',
        technicalErrorCode: null,
      });

      const invoiceResult = this.database
        .prepare<{
          company_id: string;
          id: string;
          sent_at: string;
        }>(
          `
            UPDATE invoices
            SET status = 'sent', updated_at = @sent_at
            WHERE company_id = @company_id AND id = @id AND status = 'approved'
          `,
        )
        .run({
          company_id: input.companyId,
          id: input.invoiceId,
          sent_at: input.deliveredAt,
        });

      if (invoiceResult.changes !== 1) {
        throw new Error('Approved invoice could not be marked sent.');
      }

      this.database
        .prepare<{
          action: string;
          actor_user_id: string;
          company_id: string;
          created_at: string;
          draft_id: string;
          id: string;
          invoice_id: string;
          invoice_number: string;
        }>(
          `
            INSERT INTO invoice_audit_events (
              id,
              company_id,
              actor_user_id,
              action,
              draft_id,
              invoice_id,
              invoice_number,
              created_at
            )
            VALUES (
              @id,
              @company_id,
              @actor_user_id,
              @action,
              @draft_id,
              @invoice_id,
              @invoice_number,
              @created_at
            )
          `,
        )
        .run({
          action: 'invoice.marked_sent_manually',
          actor_user_id: input.actorUserId,
          company_id: input.companyId,
          created_at: input.deliveredAt,
          draft_id: invoice.source_draft_id,
          id: input.auditEventId,
          invoice_id: input.invoiceId,
          invoice_number: invoice.invoice_number,
        });

      return { updatedAt: input.deliveredAt };
    });

    return completeTransaction();
  }

  async hasUnresolvedDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): Promise<boolean> {
    const row = this.database
      .prepare<
        { company_id: string; invoice_id: string },
        { present: number }
      >(
        `
          SELECT 1 AS present
          FROM invoice_delivery_events
          WHERE
            company_id = @company_id
            AND invoice_id = @invoice_id
            AND status IN ('attempted', 'outcomeUnknown')
          LIMIT 1
        `,
      )
      .get({ company_id: companyId, invoice_id: invoiceId });

    return row !== undefined;
  }

  async listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceDeliveryEventSummary[]> {
    const rows = this.database
      .prepare<
        { company_id: string; invoice_id: string },
        Pick<
          InvoiceDeliveryEventRow,
          | 'id'
          | 'created_at'
          | 'delivery_method'
          | 'provider'
          | 'recipient_email'
          | 'cc_email'
          | 'safe_error_message'
          | 'status'
        >
      >(
        `
          SELECT
            id,
            created_at,
            delivery_method,
            provider,
            recipient_email,
            cc_email,
            safe_error_message,
            status
          FROM invoice_delivery_events
          WHERE company_id = @company_id AND invoice_id = @invoice_id
          ORDER BY created_at DESC, id DESC
        `,
      )
      .all({ company_id: companyId, invoice_id: invoiceId });

    return rows.map((row) => ({
      ccEmail: row.cc_email,
      createdAt: row.created_at,
      deliveryMethod:
        row.delivery_method as InvoiceDeliveryEventSummary['deliveryMethod'],
      id: row.id,
      provider: row.provider as InvoiceDeliveryEventSummary['provider'],
      recipientEmail: row.recipient_email,
      safeErrorMessage: row.safe_error_message,
      status: row.status as InvoiceDeliveryEventSummary['status'],
    }));
  }

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    this.insertDeliveryEvent(event);

    return event;
  }

  private insertDeliveryEvent(event: InvoiceDeliveryEvent): void {
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
