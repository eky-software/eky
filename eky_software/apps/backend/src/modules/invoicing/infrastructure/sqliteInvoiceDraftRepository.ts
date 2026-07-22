import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraft,
  InvoiceDraftStatus,
} from '../domain/invoiceDraft.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import type { PriceInputMode } from '../domain/invoiceCalculation.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import {
  toInvoiceDraftLine,
  toInvoiceDraftLineRows,
  toInvoiceDraftRow,
  toInvoiceDraftSummary,
  toInvoiceVatBreakdown,
} from './invoiceDraftPersistenceRows.js';
import { SqliteInvoiceDraftQueries } from './sqliteInvoiceDraftQueries.js';

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

export class SqliteInvoiceDraftRepository implements InvoiceDraftRepository {
  private readonly queries: SqliteInvoiceDraftQueries;

  constructor(private readonly database: DatabaseConnection) {
    this.queries = new SqliteInvoiceDraftQueries(database);
  }

  async deleteDraft(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<boolean> {
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

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    const draftRow = toInvoiceDraftRow(draft);
    const lineRows = toInvoiceDraftLineRows(draft);
    const insertDraft = this.database.prepare<InvoiceDraftInsertParameters>(
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
    );
    const insertLine = this.database.prepare<InvoiceDraftLineInsertParameters>(
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
    const saveTransaction = this.database.transaction(() => {
      insertDraft.run(
        draftRow.id,
        draftRow.company_id,
        draftRow.customer_id,
        draftRow.billing_recipient_customer_id,
        draftRow.status,
        draftRow.invoice_date,
        draftRow.due_date,
        draftRow.payment_term_days,
        draftRow.reminder_period_days,
        draftRow.late_payment_interest_basis_points,
        draftRow.price_input_mode,
        draftRow.subject,
        draftRow.order_number,
        draftRow.note,
        draftRow.delivery_address_text,
        draftRow.net_total_cents,
        draftRow.vat_total_cents,
        draftRow.gross_total_cents,
        draftRow.created_at,
        draftRow.updated_at,
      );

      for (const lineRow of lineRows) {
        insertLine.run(
          lineRow.id,
          lineRow.invoice_draft_id,
          lineRow.position,
          lineRow.code,
          lineRow.description,
          lineRow.quantity_hundredths,
          lineRow.unit,
          lineRow.unit_price_cents,
          lineRow.vat_rate_basis_points,
          lineRow.discount_type,
          lineRow.discount_value,
          lineRow.base_cents,
          lineRow.discount_cents,
          lineRow.net_cents,
          lineRow.vat_cents,
          lineRow.gross_cents,
        );
      }
    });

    saveTransaction();

    return draft;
  }

  async updateDraft(
    draft: InvoiceDraft,
  ): Promise<InvoiceDraft | undefined> {
    const draftRow = toInvoiceDraftRow(draft);
    const lineRows = toInvoiceDraftLineRows(draft);
    const updateDraft =
      this.database.prepare<InvoiceDraftUpdateParameters>(
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
      );
    const deleteLines = this.database.prepare<[string]>(
      'DELETE FROM invoice_draft_lines WHERE invoice_draft_id = ?',
    );
    const insertLine = this.database.prepare<InvoiceDraftLineInsertParameters>(
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
    const updateTransaction = this.database.transaction(() => {
      const result = updateDraft.run(
        draftRow.customer_id,
        draftRow.billing_recipient_customer_id,
        draftRow.invoice_date,
        draftRow.due_date,
        draftRow.payment_term_days,
        draftRow.reminder_period_days,
        draftRow.late_payment_interest_basis_points,
        draftRow.price_input_mode,
        draftRow.subject,
        draftRow.order_number,
        draftRow.note,
        draftRow.delivery_address_text,
        draftRow.net_total_cents,
        draftRow.vat_total_cents,
        draftRow.gross_total_cents,
        draftRow.updated_at,
        draftRow.company_id,
        draftRow.id,
      );

      if (result.changes !== 1) {
        return false;
      }

      deleteLines.run(draftRow.id);

      for (const lineRow of lineRows) {
        insertLine.run(
          lineRow.id,
          lineRow.invoice_draft_id,
          lineRow.position,
          lineRow.code,
          lineRow.description,
          lineRow.quantity_hundredths,
          lineRow.unit,
          lineRow.unit_price_cents,
          lineRow.vat_rate_basis_points,
          lineRow.discount_type,
          lineRow.discount_value,
          lineRow.base_cents,
          lineRow.discount_cents,
          lineRow.net_cents,
          lineRow.vat_cents,
          lineRow.gross_cents,
        );
      }

      return true;
    });

    return updateTransaction() ? draft : undefined;
  }

  async getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined> {
    const draftRow = this.queries.getEditableDraft(
      companyId,
      invoiceDraftId,
    );

    if (draftRow === undefined) {
      return undefined;
    }

    const lineRows = this.queries.getDraftLines(companyId, invoiceDraftId);
    const vatBreakdownRows = this.queries.getVatBreakdown(
      companyId,
      invoiceDraftId,
    );
    const priceInputMode = draftRow.price_input_mode as PriceInputMode;
    const lines = lineRows.map((lineRow) =>
      toInvoiceDraftLine(lineRow, priceInputMode),
    );
    const vatBreakdown = vatBreakdownRows.map(toInvoiceVatBreakdown);

    return {
      id: draftRow.id,
      companyId: draftRow.company_id,
      customerId: draftRow.customer_id,
      billingRecipientCustomerId: draftRow.billing_recipient_customer_id,
      status: draftRow.status as InvoiceDraftStatus,
      invoiceDate: draftRow.invoice_date,
      dueDate: draftRow.due_date,
      paymentTermDays: draftRow.payment_term_days,
      reminderPeriodDays: draftRow.reminder_period_days,
      latePaymentInterestBasisPoints:
        draftRow.late_payment_interest_basis_points,
      priceInputMode,
      subject: draftRow.subject,
      orderNumber: draftRow.order_number,
      note: draftRow.note,
      deliveryAddressText: draftRow.delivery_address_text,
      lines,
      totals: {
        netTotalCents: draftRow.net_total_cents,
        vatTotalCents: draftRow.vat_total_cents,
        grossTotalCents: draftRow.gross_total_cents,
        vatBreakdown,
      },
      createdAt: draftRow.created_at,
      updatedAt: draftRow.updated_at,
    };
  }

  async listDraftSummaries(
    companyId: string,
    customerId?: string,
  ): Promise<InvoiceDraftSummary[]> {
    if (customerId === undefined) {
      const rows = this.queries.listDraftSummaries(companyId);

      return rows.map(toInvoiceDraftSummary);
    }

    const rows = this.queries.listDraftSummariesForCustomer(
      companyId,
      customerId,
    );

    return rows.map(toInvoiceDraftSummary);
  }
}
