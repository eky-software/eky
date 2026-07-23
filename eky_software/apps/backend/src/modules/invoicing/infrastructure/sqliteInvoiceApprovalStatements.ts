import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  NewInvoiceAuditEventRow,
  NewInvoiceLineRow,
  NewInvoiceNumberSequenceRow,
  NewInvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type {
  ApproveInvoiceDraftPersistenceInput,
  MarkApprovedInvoiceSentPersistenceInput,
  ReopenApprovedInvoicePersistenceInput,
} from '../ports/invoiceApprovalRepository.js';

type InvoiceNumberSequenceUpsertParameters = [
  string,
  string,
  string,
  number,
  string,
  string,
];

type InvoiceInsertParameters = NewInvoiceRow;
type InvoiceUpdateParameters = NewInvoiceRow;
type InvoiceDocumentDeleteParameters = [string, string];
type InvoiceLineDeleteParameters = [string];

type InvoiceLineInsertParameters = [
  string,
  string,
  string | null,
  number,
  string,
  string,
  number,
  string,
  number,
  number,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
];

type InvoiceAuditEventInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

type InvoiceDraftApproveParameters = [string, string, string, string, string];
type InvoiceDraftUnlockParameters = [string, string, string, string];
type InvoiceStatusUpdateParameters = [string, string, string];
type MarkInvoiceSentParameters = [string, string, string];

interface InvoiceDocumentStoragePathRow {
  storage_path: string;
}

export class SqliteInvoiceApprovalStatements {
  constructor(private readonly database: DatabaseConnection) {}

  upsertNumberSequence(sequence: NewInvoiceNumberSequenceRow): void {
    this.database
      .prepare<InvoiceNumberSequenceUpsertParameters>(
        `
          INSERT INTO invoice_number_sequences (
            company_id,
            series_key,
            sequence_scope,
            last_sequence_number,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(company_id, series_key, sequence_scope) DO UPDATE SET
            last_sequence_number = excluded.last_sequence_number,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        sequence.company_id,
        sequence.series_key,
        sequence.sequence_scope,
        sequence.last_sequence_number,
        sequence.created_at,
        sequence.updated_at,
      );
  }

  insertInvoice(invoice: NewInvoiceRow): void {
    this.database
      .prepare<InvoiceInsertParameters>(
        `
          INSERT INTO invoices (
            id,
            company_id,
            source_draft_id,
            invoice_kind,
            credited_invoice_id,
            invoice_number,
            reference_number,
            reference_number_type,
            series_key,
            sequence_scope,
            sequence_number,
            numbering_mode,
            status,
            customer_id,
            customer_number_snapshot,
            customer_name_snapshot,
            customer_business_id_snapshot,
            customer_type_snapshot,
            customer_email_snapshot,
            customer_phone_snapshot,
            customer_street_address_snapshot,
            customer_postal_code_snapshot,
            customer_city_snapshot,
            company_name_snapshot,
            company_business_id_snapshot,
            company_vat_number_snapshot,
            company_street_address_snapshot,
            company_postal_code_snapshot,
            company_city_snapshot,
            company_email_snapshot,
            company_phone_snapshot,
            company_website_snapshot,
            company_iban_snapshot,
            company_bic_snapshot,
            company_bank_name_snapshot,
            billing_recipient_customer_id,
            billing_recipient_customer_number_snapshot,
            billing_recipient_name_snapshot,
            billing_recipient_business_id_snapshot,
            billing_recipient_customer_type_snapshot,
            billing_recipient_email_snapshot,
            billing_recipient_phone_snapshot,
            billing_recipient_street_address_snapshot,
            billing_recipient_postal_code_snapshot,
            billing_recipient_city_snapshot,
            invoice_date,
            due_date,
            payment_term_days,
            reminder_period_days,
            late_payment_interest_basis_points,
            price_input_mode,
            subject,
            order_number,
            note,
            delivery_address_text,
            total_net_cents,
            total_vat_cents,
            total_gross_cents,
            created_at,
            approved_at,
            updated_at,
            cancelled_at,
            cancelled_by,
            cancellation_reason
          )
          VALUES (
            @id,
            @company_id,
            @source_draft_id,
            @invoice_kind,
            @credited_invoice_id,
            @invoice_number,
            @reference_number,
            @reference_number_type,
            @series_key,
            @sequence_scope,
            @sequence_number,
            @numbering_mode,
            @status,
            @customer_id,
            @customer_number_snapshot,
            @customer_name_snapshot,
            @customer_business_id_snapshot,
            @customer_type_snapshot,
            @customer_email_snapshot,
            @customer_phone_snapshot,
            @customer_street_address_snapshot,
            @customer_postal_code_snapshot,
            @customer_city_snapshot,
            @company_name_snapshot,
            @company_business_id_snapshot,
            @company_vat_number_snapshot,
            @company_street_address_snapshot,
            @company_postal_code_snapshot,
            @company_city_snapshot,
            @company_email_snapshot,
            @company_phone_snapshot,
            @company_website_snapshot,
            @company_iban_snapshot,
            @company_bic_snapshot,
            @company_bank_name_snapshot,
            @billing_recipient_customer_id,
            @billing_recipient_customer_number_snapshot,
            @billing_recipient_name_snapshot,
            @billing_recipient_business_id_snapshot,
            @billing_recipient_customer_type_snapshot,
            @billing_recipient_email_snapshot,
            @billing_recipient_phone_snapshot,
            @billing_recipient_street_address_snapshot,
            @billing_recipient_postal_code_snapshot,
            @billing_recipient_city_snapshot,
            @invoice_date,
            @due_date,
            @payment_term_days,
            @reminder_period_days,
            @late_payment_interest_basis_points,
            @price_input_mode,
            @subject,
            @order_number,
            @note,
            @delivery_address_text,
            @total_net_cents,
            @total_vat_cents,
            @total_gross_cents,
            @created_at,
            @approved_at,
            @updated_at,
            @cancelled_at,
            @cancelled_by,
            @cancellation_reason
          )
        `,
      )
      .run(invoice);
  }

  updateInvoice(invoice: NewInvoiceRow): void {
    const result = this.database
      .prepare<InvoiceUpdateParameters>(
        `
          UPDATE invoices
          SET
            status = @status,
            customer_id = @customer_id,
            customer_number_snapshot = @customer_number_snapshot,
            customer_name_snapshot = @customer_name_snapshot,
            customer_business_id_snapshot = @customer_business_id_snapshot,
            customer_type_snapshot = @customer_type_snapshot,
            customer_email_snapshot = @customer_email_snapshot,
            customer_phone_snapshot = @customer_phone_snapshot,
            customer_street_address_snapshot = @customer_street_address_snapshot,
            customer_postal_code_snapshot = @customer_postal_code_snapshot,
            customer_city_snapshot = @customer_city_snapshot,
            company_name_snapshot = @company_name_snapshot,
            company_business_id_snapshot = @company_business_id_snapshot,
            company_vat_number_snapshot = @company_vat_number_snapshot,
            company_street_address_snapshot = @company_street_address_snapshot,
            company_postal_code_snapshot = @company_postal_code_snapshot,
            company_city_snapshot = @company_city_snapshot,
            company_email_snapshot = @company_email_snapshot,
            company_phone_snapshot = @company_phone_snapshot,
            company_website_snapshot = @company_website_snapshot,
            company_iban_snapshot = @company_iban_snapshot,
            company_bic_snapshot = @company_bic_snapshot,
            company_bank_name_snapshot = @company_bank_name_snapshot,
            billing_recipient_customer_id = @billing_recipient_customer_id,
            billing_recipient_customer_number_snapshot = @billing_recipient_customer_number_snapshot,
            billing_recipient_name_snapshot = @billing_recipient_name_snapshot,
            billing_recipient_business_id_snapshot = @billing_recipient_business_id_snapshot,
            billing_recipient_customer_type_snapshot = @billing_recipient_customer_type_snapshot,
            billing_recipient_email_snapshot = @billing_recipient_email_snapshot,
            billing_recipient_phone_snapshot = @billing_recipient_phone_snapshot,
            billing_recipient_street_address_snapshot = @billing_recipient_street_address_snapshot,
            billing_recipient_postal_code_snapshot = @billing_recipient_postal_code_snapshot,
            billing_recipient_city_snapshot = @billing_recipient_city_snapshot,
            invoice_date = @invoice_date,
            due_date = @due_date,
            payment_term_days = @payment_term_days,
            reminder_period_days = @reminder_period_days,
            late_payment_interest_basis_points = @late_payment_interest_basis_points,
            price_input_mode = @price_input_mode,
            subject = @subject,
            order_number = @order_number,
            note = @note,
            delivery_address_text = @delivery_address_text,
            total_net_cents = @total_net_cents,
            total_vat_cents = @total_vat_cents,
            total_gross_cents = @total_gross_cents,
            approved_at = @approved_at,
            updated_at = @updated_at
          WHERE
            company_id = @company_id
            AND id = @id
            AND status = 'reopened_for_edit'
        `,
      )
      .run(invoice);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Reopened invoice could not be reapproved.',
      );
    }
  }

  insertInvoiceLines(lines: NewInvoiceLineRow[]): void {
    const insertLine = this.database.prepare<InvoiceLineInsertParameters>(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          source_invoice_line_id,
          line_order,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const line of lines) {
      insertLine.run(
        line.id,
        line.invoice_id,
        line.source_invoice_line_id,
        line.line_order,
        line.code,
        line.description,
        line.quantity_hundredths,
        line.unit,
        line.unit_price_cents,
        line.vat_rate_basis_points,
        line.discount_type,
        line.discount_value,
        line.base_cents,
        line.discount_cents,
        line.net_cents,
        line.vat_cents,
        line.gross_cents,
        line.created_at,
      );
    }
  }

  deleteInvoiceLines(invoiceId: string): void {
    this.database
      .prepare<InvoiceLineDeleteParameters>(
        `
          DELETE FROM invoice_lines
          WHERE invoice_id = ?
        `,
      )
      .run(invoiceId);
  }

  deleteApprovedInvoicePdfDocumentRows(
    companyId: string,
    invoiceId: string,
  ): string[] {
    const rows = this.database
      .prepare<InvoiceDocumentDeleteParameters, InvoiceDocumentStoragePathRow>(
        `
          SELECT storage_path
          FROM invoice_documents
          WHERE
            company_id = ?
            AND invoice_id = ?
            AND document_type = 'approved_invoice_pdf'
        `,
      )
      .all(companyId, invoiceId);

    this.database
      .prepare<InvoiceDocumentDeleteParameters>(
        `
          DELETE FROM invoice_documents
          WHERE
            company_id = ?
            AND invoice_id = ?
            AND document_type = 'approved_invoice_pdf'
        `,
      )
      .run(companyId, invoiceId);

    return rows.map((row) => row.storage_path);
  }

  insertAuditEvent(auditEvent: NewInvoiceAuditEventRow): void {
    this.database
      .prepare<InvoiceAuditEventInsertParameters>(
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        auditEvent.id,
        auditEvent.company_id,
        auditEvent.actor_user_id,
        auditEvent.action,
        auditEvent.draft_id,
        auditEvent.invoice_id,
        auditEvent.invoice_number,
        auditEvent.created_at,
      );
  }

  markDraftApproved(input: ApproveInvoiceDraftPersistenceInput): void {
    const result = this.database
      .prepare<InvoiceDraftApproveParameters>(
        `
          UPDATE invoice_drafts
          SET
            approved_invoice_id = ?,
            approved_at = ?,
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .run(
        input.invoiceId,
        input.approvedAt,
        input.approvedAt,
        input.companyId,
        input.draftId,
      );

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Invoice draft could not be marked as approved.',
      );
    }
  }

  markInvoiceReopenedForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): void {
    const result = this.database
      .prepare<InvoiceStatusUpdateParameters>(
        `
          UPDATE invoices
          SET
            status = 'reopened_for_edit',
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .run(input.reopenedAt, input.companyId, input.invoiceId);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Approved invoice could not be reopened for editing.',
      );
    }
  }

  markInvoiceSent(input: MarkApprovedInvoiceSentPersistenceInput): void {
    const result = this.database
      .prepare<MarkInvoiceSentParameters>(
        `
          UPDATE invoices
          SET
            status = 'sent',
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .run(input.markedSentAt, input.companyId, input.invoiceId);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Approved invoice could not be marked sent.',
      );
    }
  }

  unlockSourceDraftForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
    draftId: string,
  ): void {
    const result = this.database
      .prepare<InvoiceDraftUnlockParameters>(
        `
          UPDATE invoice_drafts
          SET
            approved_invoice_id = NULL,
            approved_at = NULL,
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND approved_invoice_id = ?
        `,
      )
      .run(input.reopenedAt, input.companyId, draftId, input.invoiceId);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Approved invoice source draft could not be reopened for editing.',
      );
    }
  }
}
