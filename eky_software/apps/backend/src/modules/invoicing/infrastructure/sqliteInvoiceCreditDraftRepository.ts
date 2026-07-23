import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { PreviousCreditAllocation } from '../domain/calculateCreditInvoiceDraft.js';
import {
  type CreateCreditDraftPersistenceInput,
  type CreateCreditDraftPersistenceResult,
  type InvoiceCreditDraftRepository,
} from '../ports/invoiceCreditDraftRepository.js';
import {
  toInvoiceDraftLineRows,
  toInvoiceDraftRow,
} from './invoiceDraftPersistenceRows.js';
import { SqliteInvoiceDraftStatements } from './sqliteInvoiceDraftStatements.js';

interface ActiveCreditDraftRow {
  id: string;
}

interface CreditSourceInvoiceRow {
  invoice_number: string;
}

interface PreviousCreditAllocationRow {
  source_invoice_line_id: string | null;
  quantity_hundredths: number;
  price_input_mode: string;
  vat_rate_basis_points: number;
  base_cents: number;
  discount_cents: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
}

export class SqliteInvoiceCreditDraftRepository
  implements InvoiceCreditDraftRepository
{
  private readonly draftStatements: SqliteInvoiceDraftStatements;

  constructor(private readonly database: DatabaseConnection) {
    this.draftStatements = new SqliteInvoiceDraftStatements(database);
  }

  async createCreditDraft(
    input: CreateCreditDraftPersistenceInput,
  ): Promise<CreateCreditDraftPersistenceResult> {
    const transaction = this.database.transaction(() =>
      this.createCreditDraftWithinTransaction(input),
    );

    return transaction();
  }

  async listPreviousCreditLineAllocations(
    companyId: string,
    sourceInvoiceId: string,
  ): Promise<PreviousCreditAllocation[]> {
    return this.database
      .prepare<[string, string], PreviousCreditAllocationRow>(
        `
          SELECT
            invoice_lines.source_invoice_line_id,
            invoice_lines.quantity_hundredths,
            credit_invoices.price_input_mode,
            invoice_lines.vat_rate_basis_points,
            invoice_lines.base_cents,
            invoice_lines.discount_cents,
            invoice_lines.net_cents,
            invoice_lines.vat_cents,
            invoice_lines.gross_cents
          FROM invoices AS credit_invoices
          INNER JOIN invoice_lines
            ON invoice_lines.invoice_id = credit_invoices.id
          WHERE
            credit_invoices.company_id = ?
            AND credit_invoices.invoice_kind = 'credit'
            AND credit_invoices.credited_invoice_id = ?
            AND credit_invoices.status <> 'cancelled'
          ORDER BY
            credit_invoices.approved_at,
            credit_invoices.id,
            invoice_lines.line_order
        `,
      )
      .all(companyId, sourceInvoiceId)
      .map((row) => ({
        sourceInvoiceLineId: row.source_invoice_line_id,
        quantityHundredths: row.quantity_hundredths,
        priceInputMode: row.price_input_mode as 'net' | 'gross',
        vatRateBasisPoints: row.vat_rate_basis_points,
        baseCents: row.base_cents,
        discountCents: row.discount_cents,
        netCents: row.net_cents,
        vatCents: row.vat_cents,
        grossCents: row.gross_cents,
      }));
  }

  private createCreditDraftWithinTransaction(
    input: CreateCreditDraftPersistenceInput,
  ): CreateCreditDraftPersistenceResult {
    const existingDraft = this.getActiveCreditDraft(
      input.draft.companyId,
      input.sourceInvoiceId,
    );

    if (existingDraft !== undefined) {
      return { outcome: 'existing', draftId: existingDraft.id };
    }

    const sourceInvoice = this.database
      .prepare<[string, string], CreditSourceInvoiceRow>(
        `
          SELECT invoice_number
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND invoice_kind = 'standard'
            AND status = 'sent'
        `,
      )
      .get(input.draft.companyId, input.sourceInvoiceId);

    if (sourceInvoice === undefined) {
      return { outcome: 'notEligible' };
    }

    this.draftStatements.insertDraft(toInvoiceDraftRow(input.draft));
    this.draftStatements.insertDraftLines(
      toInvoiceDraftLineRows(input.draft),
    );
    this.database
      .prepare<{
        actorUserId: string;
        auditEventId: string;
        companyId: string;
        createdAt: string;
        draftId: string;
        invoiceId: string;
        invoiceNumber: string;
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
            @auditEventId,
            @companyId,
            @actorUserId,
            'invoice.credit_draft_created',
            @draftId,
            @invoiceId,
            @invoiceNumber,
            @createdAt
          )
        `,
      )
      .run({
        actorUserId: input.actorUserId,
        auditEventId: input.auditEventId,
        companyId: input.draft.companyId,
        createdAt: input.draft.createdAt,
        draftId: input.draft.id,
        invoiceId: input.sourceInvoiceId,
        invoiceNumber: sourceInvoice.invoice_number,
      });

    return { outcome: 'created', draftId: input.draft.id };
  }

  private getActiveCreditDraft(
    companyId: string,
    sourceInvoiceId: string,
  ): ActiveCreditDraftRow | undefined {
    return this.database
      .prepare<[string, string], ActiveCreditDraftRow>(
        `
          SELECT id
          FROM invoice_drafts
          WHERE
            company_id = ?
            AND invoice_kind = 'credit'
            AND credited_invoice_id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .get(companyId, sourceInvoiceId);
  }
}
