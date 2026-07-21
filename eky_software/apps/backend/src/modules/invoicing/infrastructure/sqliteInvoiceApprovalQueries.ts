import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  InvoiceRow,
} from '../../../database/schema.js';
import type { StoredInvoiceNumberingSettings } from '../domain/invoiceNumbering.js';
import {
  toNumberingSettings,
  type InvoiceNumberingSettingsRow,
  type InvoiceNumberSequenceRow,
} from './invoiceApprovalPersistenceRows.js';

type InvoiceDraftApprovalKeyParameters = [string, string];
type InvoiceNumberingSettingsKeyParameters = [string, string];
type InvoiceNumberSequenceKeyParameters = [string, string, string];
type ReopenedInvoiceDraftKeyParameters = [string, string];
type ReopenedInvoiceKeyParameters = [string, string];

export class SqliteInvoiceApprovalQueries {
  constructor(private readonly database: DatabaseConnection) {}

  getDraftForApproval(
    companyId: string,
    draftId: string,
  ): InvoiceDraftTable | undefined {
    return this.database
      .prepare<InvoiceDraftApprovalKeyParameters, InvoiceDraftTable>(
        `
          SELECT
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
            updated_at,
            approved_invoice_id,
            approved_at
          FROM invoice_drafts
          WHERE company_id = ? AND id = ?
        `,
      )
      .get(companyId, draftId);
  }

  getApprovedInvoiceForReopen(
    companyId: string,
    invoiceId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ReopenedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .get(companyId, invoiceId);
  }

  getApprovedInvoiceForMarkSent(
    companyId: string,
    invoiceId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ReopenedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND status IN ('approved', 'sent')
        `,
      )
      .get(companyId, invoiceId);
  }

  getReopenedInvoiceForDraft(
    companyId: string,
    draftId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ReopenedInvoiceDraftKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND source_draft_id = ?
            AND status = 'reopened_for_edit'
        `,
      )
      .get(companyId, draftId);
  }

  getDraftLinesForApproval(
    companyId: string,
    draftId: string,
  ): InvoiceDraftLineTable[] {
    return this.database
      .prepare<InvoiceDraftApprovalKeyParameters, InvoiceDraftLineTable>(
        `
          SELECT
            invoice_draft_lines.id,
            invoice_draft_lines.invoice_draft_id,
            invoice_draft_lines.position,
            invoice_draft_lines.code,
            invoice_draft_lines.description,
            invoice_draft_lines.quantity_hundredths,
            invoice_draft_lines.unit,
            invoice_draft_lines.unit_price_cents,
            invoice_draft_lines.vat_rate_basis_points,
            invoice_draft_lines.discount_type,
            invoice_draft_lines.discount_value,
            invoice_draft_lines.base_cents,
            invoice_draft_lines.discount_cents,
            invoice_draft_lines.net_cents,
            invoice_draft_lines.vat_cents,
            invoice_draft_lines.gross_cents
          FROM invoice_draft_lines
          INNER JOIN invoice_drafts
            ON invoice_drafts.id = invoice_draft_lines.invoice_draft_id
          WHERE
            invoice_drafts.company_id = ?
            AND invoice_draft_lines.invoice_draft_id = ?
          ORDER BY invoice_draft_lines.position
        `,
      )
      .all(companyId, draftId);
  }

  getNumberingSettings(
    companyId: string,
    seriesKey: string,
  ): StoredInvoiceNumberingSettings | undefined {
    const row = this.database
      .prepare<InvoiceNumberingSettingsKeyParameters, InvoiceNumberingSettingsRow>(
        `
          SELECT
            mode,
            fiscal_year_start_month,
            sequence_padding,
            first_sequence_number,
            created_at,
            updated_at
          FROM invoice_numbering_settings
          WHERE company_id = ? AND series_key = ?
        `,
      )
      .get(companyId, seriesKey);

    return row === undefined
      ? undefined
      : toNumberingSettings(companyId, seriesKey, row);
  }

  getNumberSequence(
    companyId: string,
    seriesKey: string,
    sequenceScope: string,
  ): InvoiceNumberSequenceRow | undefined {
    return this.database
      .prepare<InvoiceNumberSequenceKeyParameters, InvoiceNumberSequenceRow>(
        `
          SELECT
            last_sequence_number,
            created_at,
            updated_at
          FROM invoice_number_sequences
          WHERE
            company_id = ?
            AND series_key = ?
            AND sequence_scope = ?
        `,
      )
      .get(companyId, seriesKey, sequenceScope);
  }
}
