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
import { SqliteInvoiceDraftStatements } from './sqliteInvoiceDraftStatements.js';

export class SqliteInvoiceDraftRepository implements InvoiceDraftRepository {
  private readonly queries: SqliteInvoiceDraftQueries;
  private readonly statements: SqliteInvoiceDraftStatements;

  constructor(private readonly database: DatabaseConnection) {
    this.queries = new SqliteInvoiceDraftQueries(database);
    this.statements = new SqliteInvoiceDraftStatements(database);
  }

  async deleteDraft(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<boolean> {
    return this.statements.deleteEditableDraft(companyId, invoiceDraftId);
  }

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    const saveTransaction = this.database.transaction(
      (draftWithinTransaction: InvoiceDraft) =>
        this.saveDraftWithinTransaction(draftWithinTransaction),
    );

    saveTransaction(draft);

    return draft;
  }

  async updateDraft(
    draft: InvoiceDraft,
  ): Promise<InvoiceDraft | undefined> {
    const updateTransaction = this.database.transaction(
      (draftWithinTransaction: InvoiceDraft) =>
        this.updateDraftWithinTransaction(draftWithinTransaction),
    );

    return updateTransaction(draft) ? draft : undefined;
  }

  private saveDraftWithinTransaction(draft: InvoiceDraft): void {
    this.statements.insertDraft(toInvoiceDraftRow(draft));
    this.statements.insertDraftLines(toInvoiceDraftLineRows(draft));
  }

  private updateDraftWithinTransaction(draft: InvoiceDraft): boolean {
    const draftRow = toInvoiceDraftRow(draft);

    if (!this.statements.updateEditableDraft(draftRow)) {
      return false;
    }

    this.statements.deleteDraftLines(draftRow.id);
    this.statements.insertDraftLines(toInvoiceDraftLineRows(draft));

    return true;
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
