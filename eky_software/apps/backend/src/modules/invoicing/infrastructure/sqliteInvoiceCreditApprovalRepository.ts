import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  InvoiceLineRow,
  InvoiceRow,
  NewInvoiceLineRow,
  NewInvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import {
  calculateCreditInvoice,
  type PreviousCreditLineAllocation,
} from '../domain/calculateCreditInvoice.js';
import {
  formatInvoiceNumber,
  resolveInvoiceNumberSequenceScope,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
} from '../domain/invoiceNumbering.js';
import type {
  ApproveCreditInvoiceDraftPersistenceInput,
  ApproveCreditInvoiceDraftPersistenceResult,
  InvoiceCreditApprovalRepository,
} from '../ports/invoiceCreditApprovalRepository.js';
import { createAuditEventRow } from './invoiceApprovalPersistenceRows.js';
import { SqliteInvoiceApprovalQueries } from './sqliteInvoiceApprovalQueries.js';
import { SqliteInvoiceApprovalStatements } from './sqliteInvoiceApprovalStatements.js';

interface PreviousCreditAllocationRow {
  source_invoice_line_id: string;
  quantity_hundredths: number;
  base_cents: number;
  discount_cents: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
}

export class SqliteInvoiceCreditApprovalRepository
  implements InvoiceCreditApprovalRepository
{
  private readonly approvalQueries: SqliteInvoiceApprovalQueries;
  private readonly approvalStatements: SqliteInvoiceApprovalStatements;

  constructor(private readonly database: DatabaseConnection) {
    this.approvalQueries = new SqliteInvoiceApprovalQueries(database);
    this.approvalStatements = new SqliteInvoiceApprovalStatements(database);
  }

  async approveCreditDraft(
    input: ApproveCreditInvoiceDraftPersistenceInput,
  ): Promise<ApproveCreditInvoiceDraftPersistenceResult> {
    const transaction = this.database.transaction(() =>
      this.approveCreditDraftWithinTransaction(input),
    );

    return transaction();
  }

  private approveCreditDraftWithinTransaction(
    input: ApproveCreditInvoiceDraftPersistenceInput,
  ): ApproveCreditInvoiceDraftPersistenceResult {
    const draft = this.approvalQueries.getDraftForApproval(
      input.companyId,
      input.draftId,
    );

    if (
      draft === undefined ||
      draft.invoice_kind !== 'credit' ||
      draft.credited_invoice_id === null ||
      draft.status !== 'draft' ||
      draft.approved_invoice_id !== null
    ) {
      return { outcome: 'notFound' };
    }

    const sourceInvoice = this.getSourceInvoice(
      input.companyId,
      draft.credited_invoice_id,
    );

    if (sourceInvoice === undefined) {
      return { outcome: 'conflict' };
    }

    const draftLines = this.approvalQueries.getDraftLinesForApproval(
      input.companyId,
      input.draftId,
    );

    if (draftLines.length === 0) {
      return { outcome: 'conflict' };
    }

    const sourceLines = this.getSourceLines(sourceInvoice.id);
    const previousAllocations = this.getPreviousAllocations(
      input.companyId,
      sourceInvoice.id,
    );
    const calculated = calculateCreditInvoice(
      sourceLines.map((line) => ({
        id: line.id,
        lineOrder: line.line_order,
        quantityHundredths: line.quantity_hundredths,
        priceInputMode: sourceInvoice.price_input_mode as 'gross' | 'net',
        vatRateBasisPoints: line.vat_rate_basis_points,
        baseCents: line.base_cents,
        discountCents: line.discount_cents,
        netCents: line.net_cents,
        vatCents: line.vat_cents,
        grossCents: line.gross_cents,
      })),
      previousAllocations,
      draftLines.map((line) => {
        if (line.source_invoice_line_id === null) {
          throw new ApproveInvoiceDraftError(
            'Credit invoice draft source line is missing.',
          );
        }

        return {
          sourceInvoiceLineId: line.source_invoice_line_id,
          quantityHundredths: line.quantity_hundredths,
        };
      }),
    );
    const settings = this.approvalQueries.getNumberingSettings(
      input.companyId,
      input.seriesKey,
    );

    if (settings === undefined) {
      throw new ApproveInvoiceDraftError(
        'Invoice numbering settings were not found.',
      );
    }

    validateInvoiceNumberingSettings(settings);

    const sequenceScope = resolveInvoiceNumberSequenceScope(
      settings,
      draft.invoice_date,
    );
    const currentSequence = this.approvalQueries.getNumberSequence(
      input.companyId,
      input.seriesKey,
      sequenceScope,
    );
    const sequenceNumber =
      currentSequence === undefined
        ? settings.firstSequenceNumber
        : currentSequence.last_sequence_number + 1;

    validateInvoiceSequenceNumber(sequenceNumber);

    const invoiceNumber = formatInvoiceNumber(
      settings,
      draft.invoice_date,
      sequenceNumber,
    );
    const invoiceRow = createCreditInvoiceRow(
      input,
      draft,
      sourceInvoice,
      invoiceNumber,
      sequenceNumber,
      sequenceScope,
      settings.mode,
      calculated.totals,
    );
    const lineRows = createCreditInvoiceLineRows(
      input,
      draftLines,
      sourceLines,
      calculated.lines,
    );

    this.approvalStatements.upsertNumberSequence({
      company_id: input.companyId,
      series_key: input.seriesKey,
      sequence_scope: sequenceScope,
      last_sequence_number: sequenceNumber,
      created_at: currentSequence?.created_at ?? input.approvedAt,
      updated_at: input.approvedAt,
    });
    this.approvalStatements.insertInvoice(invoiceRow);
    this.approvalStatements.insertInvoiceLines(lineRows);
    this.approvalStatements.insertAuditEvent(
      createAuditEventRow(
        input,
        invoiceNumber,
        'invoice.credit_approved',
        input.approvedAt,
      ),
    );
    this.approvalStatements.markDraftApproved(input);

    return {
      outcome: 'approved',
      invoice: {
        invoiceId: input.invoiceId,
        draftId: input.draftId,
        invoiceNumber,
        sequenceNumber,
        sequenceScope,
        numberingMode: settings.mode,
        status: 'approved',
      },
    };
  }

  private getSourceInvoice(
    companyId: string,
    invoiceId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<[string, string], InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND invoice_kind = 'standard'
            AND status = 'sent'
        `,
      )
      .get(companyId, invoiceId);
  }

  private getSourceLines(invoiceId: string): InvoiceLineRow[] {
    return this.database
      .prepare<[string], InvoiceLineRow>(
        `
          SELECT *
          FROM invoice_lines
          WHERE invoice_id = ?
          ORDER BY line_order
        `,
      )
      .all(invoiceId);
  }

  private getPreviousAllocations(
    companyId: string,
    sourceInvoiceId: string,
  ): PreviousCreditLineAllocation[] {
    return this.database
      .prepare<[string, string], PreviousCreditAllocationRow>(
        `
          SELECT
            invoice_lines.source_invoice_line_id,
            invoice_lines.quantity_hundredths,
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
            AND invoice_lines.source_invoice_line_id IS NOT NULL
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
        baseCents: row.base_cents,
        discountCents: row.discount_cents,
        netCents: row.net_cents,
        vatCents: row.vat_cents,
        grossCents: row.gross_cents,
      }));
  }
}

function createCreditInvoiceRow(
  input: ApproveCreditInvoiceDraftPersistenceInput,
  draft: InvoiceDraftTable,
  sourceInvoice: InvoiceRow,
  invoiceNumber: string,
  sequenceNumber: number,
  sequenceScope: string,
  numberingMode: NewInvoiceRow['numbering_mode'],
  totals: {
    netTotalCents: number;
    vatTotalCents: number;
    grossTotalCents: number;
  },
): NewInvoiceRow {
  return {
    ...sourceInvoice,
    id: input.invoiceId,
    source_draft_id: input.draftId,
    invoice_kind: 'credit',
    credited_invoice_id: sourceInvoice.id,
    invoice_number: invoiceNumber,
    reference_number: null,
    reference_number_type: null,
    series_key: input.seriesKey,
    sequence_scope: sequenceScope,
    sequence_number: sequenceNumber,
    numbering_mode: numberingMode,
    status: 'approved',
    invoice_date: draft.invoice_date,
    due_date: draft.invoice_date,
    payment_term_days: 0,
    reminder_period_days: 0,
    late_payment_interest_basis_points: 0,
    subject: draft.subject,
    order_number: sourceInvoice.order_number,
    note: draft.note,
    delivery_address_text: sourceInvoice.delivery_address_text,
    total_net_cents: totals.netTotalCents,
    total_vat_cents: totals.vatTotalCents,
    total_gross_cents: totals.grossTotalCents,
    created_at: input.approvedAt,
    approved_at: input.approvedAt,
    updated_at: input.approvedAt,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
  };
}

function createCreditInvoiceLineRows(
  input: ApproveCreditInvoiceDraftPersistenceInput,
  draftLines: readonly InvoiceDraftLineTable[],
  sourceLines: readonly InvoiceLineRow[],
  calculatedLines: readonly {
    sourceInvoiceLineId: string;
    quantityHundredths: number;
    baseCents: number;
    discountCents: number;
    netCents: number;
    vatCents: number;
    grossCents: number;
  }[],
): NewInvoiceLineRow[] {
  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const calculatedBySourceId = new Map(
    calculatedLines.map((line) => [line.sourceInvoiceLineId, line]),
  );

  return draftLines.map((draftLine) => {
    const sourceLineId = draftLine.source_invoice_line_id;
    const sourceLine =
      sourceLineId === null ? undefined : sourceById.get(sourceLineId);
    const calculated =
      sourceLineId === null
        ? undefined
        : calculatedBySourceId.get(sourceLineId);

    if (sourceLine === undefined || calculated === undefined) {
      throw new ApproveInvoiceDraftError(
        'Credit invoice draft source line is invalid.',
      );
    }

    return {
      id: draftLine.id,
      invoice_id: input.invoiceId,
      source_invoice_line_id: sourceLine.id,
      line_order: draftLine.position,
      code: sourceLine.code,
      description: draftLine.description,
      quantity_hundredths: calculated.quantityHundredths,
      unit: sourceLine.unit,
      unit_price_cents: sourceLine.unit_price_cents,
      vat_rate_basis_points: sourceLine.vat_rate_basis_points,
      discount_type: sourceLine.discount_type,
      discount_value: sourceLine.discount_value,
      base_cents: calculated.baseCents,
      discount_cents: calculated.discountCents,
      net_cents: calculated.netCents,
      vat_cents: calculated.vatCents,
      gross_cents: calculated.grossCents,
      created_at: input.approvedAt,
    };
  });
}
