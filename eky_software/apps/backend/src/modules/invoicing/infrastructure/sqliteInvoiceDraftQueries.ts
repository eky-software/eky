import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
} from '../../../database/schema.js';
import type {
  InvoiceDraftSummaryRow,
  InvoiceVatBreakdownRow,
} from './invoiceDraftPersistenceRows.js';

type InvoiceDraftKeyParameters = [string, string];

const invoiceDraftSummarySelect = `
  SELECT
    id,
    customer_id,
    status,
    invoice_date,
    due_date,
    payment_term_days,
    late_payment_interest_basis_points,
    price_input_mode,
    subject,
    net_total_cents,
    vat_total_cents,
    gross_total_cents,
    updated_at
  FROM invoice_drafts
`;

export class SqliteInvoiceDraftQueries {
  constructor(private readonly database: DatabaseConnection) {}

  getEditableDraft(
    companyId: string,
    invoiceDraftId: string,
  ): InvoiceDraftTable | undefined {
    return this.database
      .prepare<InvoiceDraftKeyParameters, InvoiceDraftTable>(
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
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .get(companyId, invoiceDraftId);
  }

  getDraftLines(
    companyId: string,
    invoiceDraftId: string,
  ): InvoiceDraftLineTable[] {
    return this.database
      .prepare<InvoiceDraftKeyParameters, InvoiceDraftLineTable>(
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
      .all(companyId, invoiceDraftId);
  }

  getVatBreakdown(
    companyId: string,
    invoiceDraftId: string,
  ): InvoiceVatBreakdownRow[] {
    return this.database
      .prepare<InvoiceDraftKeyParameters, InvoiceVatBreakdownRow>(
        `
          SELECT
            invoice_draft_lines.vat_rate_basis_points,
            SUM(invoice_draft_lines.net_cents) AS net_cents,
            SUM(invoice_draft_lines.vat_cents) AS vat_cents,
            SUM(invoice_draft_lines.gross_cents) AS gross_cents
          FROM invoice_draft_lines
          INNER JOIN invoice_drafts
            ON invoice_drafts.id = invoice_draft_lines.invoice_draft_id
          WHERE
            invoice_drafts.company_id = ?
            AND invoice_draft_lines.invoice_draft_id = ?
          GROUP BY invoice_draft_lines.vat_rate_basis_points
          ORDER BY invoice_draft_lines.vat_rate_basis_points
        `,
      )
      .all(companyId, invoiceDraftId);
  }

  listDraftSummaries(companyId: string): InvoiceDraftSummaryRow[] {
    return this.database
      .prepare<[string], InvoiceDraftSummaryRow>(
        `
          ${invoiceDraftSummarySelect}
          WHERE
            company_id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
          ORDER BY updated_at DESC, id DESC
        `,
      )
      .all(companyId);
  }

  listDraftSummariesForCustomer(
    companyId: string,
    customerId: string,
  ): InvoiceDraftSummaryRow[] {
    return this.database
      .prepare<[string, string], InvoiceDraftSummaryRow>(
        `
          ${invoiceDraftSummarySelect}
          WHERE
            company_id = ?
            AND customer_id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
          ORDER BY updated_at DESC, id DESC
        `,
      )
      .all(companyId, customerId);
  }
}
