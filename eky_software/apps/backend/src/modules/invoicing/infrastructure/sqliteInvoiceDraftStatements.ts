import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  NewInvoiceDraftLineRow,
  NewInvoiceDraftRow,
} from '../../../database/schema.js';

type InvoiceDraftInsertParameters = [
  string,
  string,
  string,
  string | null,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
];

type InvoiceDraftLineInsertParameters = [
  string,
  string,
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
];

type InvoiceDraftUpdateParameters = [
  string,
  string | null,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
  string,
];

export class SqliteInvoiceDraftStatements {
  constructor(private readonly database: DatabaseConnection) {}

  insertDraft(draft: NewInvoiceDraftRow): void {
    this.database
      .prepare<InvoiceDraftInsertParameters>(
        `
          INSERT INTO invoice_drafts (
            id,
            company_id,
            customer_id,
            billing_recipient_customer_id,
            status,
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
            net_total_cents,
            vat_total_cents,
            gross_total_cents,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        draft.id,
        draft.company_id,
        draft.customer_id,
        draft.billing_recipient_customer_id,
        draft.status,
        draft.invoice_date,
        draft.due_date,
        draft.payment_term_days,
        draft.reminder_period_days,
        draft.late_payment_interest_basis_points,
        draft.price_input_mode,
        draft.subject,
        draft.order_number,
        draft.note,
        draft.delivery_address_text,
        draft.net_total_cents,
        draft.vat_total_cents,
        draft.gross_total_cents,
        draft.created_at,
        draft.updated_at,
      );
  }

  insertDraftLines(lines: NewInvoiceDraftLineRow[]): void {
    const insertLine =
      this.database.prepare<InvoiceDraftLineInsertParameters>(
        `
          INSERT INTO invoice_draft_lines (
            id,
            invoice_draft_id,
            position,
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
            gross_cents
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );

    for (const line of lines) {
      insertLine.run(
        line.id,
        line.invoice_draft_id,
        line.position,
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
      );
    }
  }

  updateEditableDraft(draft: NewInvoiceDraftRow): boolean {
    const result = this.database
      .prepare<InvoiceDraftUpdateParameters>(
        `
          UPDATE invoice_drafts
          SET
            customer_id = ?,
            billing_recipient_customer_id = ?,
            invoice_date = ?,
            due_date = ?,
            payment_term_days = ?,
            reminder_period_days = ?,
            late_payment_interest_basis_points = ?,
            price_input_mode = ?,
            subject = ?,
            order_number = ?,
            note = ?,
            delivery_address_text = ?,
            net_total_cents = ?,
            vat_total_cents = ?,
            gross_total_cents = ?,
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .run(
        draft.customer_id,
        draft.billing_recipient_customer_id,
        draft.invoice_date,
        draft.due_date,
        draft.payment_term_days,
        draft.reminder_period_days,
        draft.late_payment_interest_basis_points,
        draft.price_input_mode,
        draft.subject,
        draft.order_number,
        draft.note,
        draft.delivery_address_text,
        draft.net_total_cents,
        draft.vat_total_cents,
        draft.gross_total_cents,
        draft.updated_at,
        draft.company_id,
        draft.id,
      );

    return result.changes === 1;
  }

  deleteDraftLines(invoiceDraftId: string): void {
    this.database
      .prepare<[string]>(
        'DELETE FROM invoice_draft_lines WHERE invoice_draft_id = ?',
      )
      .run(invoiceDraftId);
  }

  deleteEditableDraft(companyId: string, invoiceDraftId: string): boolean {
    const result = this.database
      .prepare<[string, string]>(
        `
          DELETE FROM invoice_drafts
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .run(companyId, invoiceDraftId);

    return result.changes === 1;
  }
}
