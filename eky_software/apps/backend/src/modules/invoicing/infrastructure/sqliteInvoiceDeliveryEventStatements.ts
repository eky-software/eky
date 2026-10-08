import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRecordedDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import {
  type InvoiceDeliveryEventInsertParameters,
  toRow,
} from './invoiceDeliveryEventPersistenceRows.js';

export interface MarkApprovedInvoiceSentPersistenceInput {
  companyId: string;
  invoiceId: string;
  sentAt: string;
}

export interface InsertManualDeliveryAuditEventInput {
  action: 'invoice.marked_sent_manually';
  actorUserId: string;
  companyId: string;
  createdAt: string;
  draftId: string;
  id: string;
  invoiceId: string;
  invoiceNumber: string;
}

export class SqliteInvoiceDeliveryEventStatements {
  constructor(private readonly database: DatabaseConnection) {}

  markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentPersistenceInput,
  ): void {
    const result = this.database
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

    if (result.changes !== 1) {
      throw new Error('Approved invoice could not be marked sent.');
    }
  }

  insertDeliveryEvent(event: InvoiceRecordedDeliveryEvent): void {
    this.database
      .prepare<InvoiceDeliveryEventInsertParameters>(
        `
          INSERT INTO invoice_delivery_events (
            id,
            company_id,
            invoice_id,
            document_id,
            binding_kind, revision_id, send_mode, document_sha256, document_size_bytes,
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
            @binding_kind, @revision_id, @send_mode, @document_sha256, @document_size_bytes,
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

  insertManualDeliveryAuditEvent(
    input: InsertManualDeliveryAuditEventInput,
  ): void {
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
        action: input.action,
        actor_user_id: input.actorUserId,
        company_id: input.companyId,
        created_at: input.createdAt,
        draft_id: input.draftId,
        id: input.id,
        invoice_id: input.invoiceId,
        invoice_number: input.invoiceNumber,
      });
  }
}
