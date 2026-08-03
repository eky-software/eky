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
  calculateCreditInvoiceDraft,
  type CalculatedCreditDraftLine,
  type PreviousCreditAllocation,
} from '../domain/calculateCreditInvoiceDraft.js';
import {
  calculateReverseChargeCreditInvoiceDraft,
  type ReverseChargeCreditSourceLine,
  type ReverseChargePreviousCreditAllocation,
} from '../domain/calculateReverseChargeCreditInvoiceDraft.js';
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
import type { InvoiceCreditAllocation } from '../ports/invoiceCreditDraftRepository.js';
import { createAuditEventRow } from './invoiceApprovalPersistenceRows.js';
import { SqliteInvoiceApprovalQueries } from './sqliteInvoiceApprovalQueries.js';
import { SqliteInvoiceApprovalStatements } from './sqliteInvoiceApprovalStatements.js';

interface PreviousCreditAllocationRow {
  source_invoice_line_id: string | null;
  quantity_hundredths: number;
  price_input_mode: string;
  vat_rate_basis_points: number | null;
  base_cents: number;
  discount_cents: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
}

interface NumberedApproveCreditInvoiceDraftPersistenceInput
  extends ApproveCreditInvoiceDraftPersistenceInput {
  seriesKey: string;
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

    return transaction.immediate();
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

    if (!hasMatchingTaxTreatment(draft, sourceInvoice)) {
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
    const calculated = calculateCreditDraftForApproval(
      sourceInvoice,
      sourceLines,
      previousAllocations,
      draftLines,
    );
    const settings = this.approvalQueries.getActiveNumberingSettings(
      input.companyId,
    );

    if (settings === undefined) {
      throw new ApproveInvoiceDraftError(
        'Active invoice numbering settings were not found.',
      );
    }

    validateInvoiceNumberingSettings(settings);
    const numberedInput: NumberedApproveCreditInvoiceDraftPersistenceInput = {
      ...input,
      seriesKey: settings.seriesKey,
    };

    const sequenceScope = resolveInvoiceNumberSequenceScope(
      settings,
      draft.invoice_date,
    );
    const currentSequence = this.approvalQueries.getNumberSequence(
      input.companyId,
      settings.seriesKey,
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
      numberedInput,
      draft,
      sourceInvoice,
      invoiceNumber,
      sequenceNumber,
      sequenceScope,
      settings.mode,
      calculated.totals,
    );
    const lineRows = createCreditInvoiceLineRows(
      numberedInput,
      draftLines,
      sourceLines,
      calculated.lines,
    );

    this.approvalStatements.upsertNumberSequence({
      company_id: input.companyId,
      series_key: settings.seriesKey,
      sequence_scope: sequenceScope,
      last_sequence_number: sequenceNumber,
      created_at: currentSequence?.created_at ?? input.approvedAt,
      updated_at: input.approvedAt,
    });
    this.approvalStatements.insertInvoice(invoiceRow);
    this.approvalStatements.insertInvoiceLines(lineRows);
    this.approvalStatements.insertAuditEvent(
      createAuditEventRow(
        numberedInput,
        invoiceNumber,
        'invoice.credit_approved',
        input.approvedAt,
      ),
    );
    this.approvalStatements.markDraftApproved(numberedInput);

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
  ): InvoiceCreditAllocation[] {
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
}

function calculateCreditDraftForApproval(
  sourceInvoice: InvoiceRow,
  sourceLines: readonly InvoiceLineRow[],
  previousAllocations: readonly InvoiceCreditAllocation[],
  draftLines: readonly InvoiceDraftLineTable[],
) {
  const requestedSourceLines = draftLines.flatMap((line) =>
    line.source_invoice_line_id === null
      ? []
      : [
          {
            sourceInvoiceLineId: line.source_invoice_line_id,
            quantityHundredths: line.quantity_hundredths,
          },
        ],
  );

  if (sourceInvoice.tax_treatment === 'reverseChargeConstruction') {
    return calculateReverseChargeCreditInvoiceDraft(
      toReverseChargeSourceLines(sourceInvoice, sourceLines),
      toReverseChargePreviousAllocations(previousAllocations),
      requestedSourceLines,
      draftLines.flatMap((line) => {
        if (line.source_invoice_line_id !== null) {
          return [];
        }
        if (line.vat_rate_basis_points !== null) {
          throw new ApproveInvoiceDraftError(
            'Reverse charge credit invoice line cannot contain a VAT rate.',
          );
        }

        return [
          {
            lineKey: line.id,
            quantityHundredths: line.quantity_hundredths,
            unitPriceCents: line.unit_price_cents,
          },
        ];
      }),
    );
  }

  if (sourceInvoice.tax_treatment !== 'normalVat') {
    throw new ApproveInvoiceDraftError(
      'Credit invoice tax treatment is invalid.',
    );
  }

  return calculateCreditInvoiceDraft(
    toNormalVatSourceLines(sourceInvoice, sourceLines),
    toNormalVatPreviousAllocations(previousAllocations),
    requestedSourceLines,
    draftLines.flatMap((line) => {
      if (line.source_invoice_line_id !== null) {
        return [];
      }
      if (line.vat_rate_basis_points === null) {
        throw new ApproveInvoiceDraftError(
          'Normal VAT credit invoice line requires a VAT rate.',
        );
      }

      return [
        {
          lineKey: line.id,
          quantityHundredths: line.quantity_hundredths,
          unitPriceCents: line.unit_price_cents,
          vatRateBasisPoints: line.vat_rate_basis_points,
        },
      ];
    }),
  );
}

function toNormalVatSourceLines(
  sourceInvoice: InvoiceRow,
  sourceLines: readonly InvoiceLineRow[],
) {
  return sourceLines.map((line) => {
    if (line.vat_rate_basis_points === null) {
      throw new ApproveInvoiceDraftError(
        'Normal VAT source invoice line is invalid.',
      );
    }

    return {
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
    };
  });
}

function toReverseChargeSourceLines(
  sourceInvoice: InvoiceRow,
  sourceLines: readonly InvoiceLineRow[],
): ReverseChargeCreditSourceLine[] {
  if (sourceInvoice.price_input_mode !== 'net') {
    throw new ApproveInvoiceDraftError(
      'Reverse charge source invoice price input mode is invalid.',
    );
  }

  return sourceLines.map((line) => {
    if (
      line.vat_rate_basis_points !== null ||
      line.vat_cents !== 0 ||
      line.net_cents !== line.gross_cents
    ) {
      throw new ApproveInvoiceDraftError(
        'Reverse charge source invoice line is invalid.',
      );
    }

    return {
      id: line.id,
      lineOrder: line.line_order,
      quantityHundredths: line.quantity_hundredths,
      priceInputMode: 'net',
      vatRateBasisPoints: null,
      baseCents: line.base_cents,
      discountCents: line.discount_cents,
      netCents: line.net_cents,
      vatCents: 0,
      grossCents: line.gross_cents,
    };
  });
}

function toNormalVatPreviousAllocations(
  allocations: readonly InvoiceCreditAllocation[],
): PreviousCreditAllocation[] {
  return allocations.map((allocation) => {
    if (allocation.vatRateBasisPoints === null) {
      throw new ApproveInvoiceDraftError(
        'Stored normal VAT credit allocation is invalid.',
      );
    }

    return {
      ...allocation,
      vatRateBasisPoints: allocation.vatRateBasisPoints,
    };
  });
}

function toReverseChargePreviousAllocations(
  allocations: readonly InvoiceCreditAllocation[],
): ReverseChargePreviousCreditAllocation[] {
  return allocations.map((allocation) => {
    if (
      allocation.vatRateBasisPoints !== null ||
      allocation.priceInputMode !== 'net' ||
      allocation.vatCents !== 0 ||
      allocation.netCents !== allocation.grossCents
    ) {
      throw new ApproveInvoiceDraftError(
        'Stored reverse charge credit allocation is invalid.',
      );
    }

    return {
      ...allocation,
      priceInputMode: 'net',
      vatRateBasisPoints: null,
      vatCents: 0,
    };
  });
}

function hasMatchingTaxTreatment(
  draft: InvoiceDraftTable,
  sourceInvoice: InvoiceRow,
): boolean {
  return (
    draft.tax_treatment === sourceInvoice.tax_treatment &&
    draft.price_input_mode === sourceInvoice.price_input_mode &&
    draft.performance_date === sourceInvoice.performance_date &&
    draft.performance_period_start ===
      sourceInvoice.performance_period_start &&
    draft.performance_period_end === sourceInvoice.performance_period_end
  );
}

function createCreditInvoiceRow(
  input: NumberedApproveCreditInvoiceDraftPersistenceInput,
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
    refund_iban_snapshot: draft.refund_iban,
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
  input: NumberedApproveCreditInvoiceDraftPersistenceInput,
  draftLines: readonly InvoiceDraftLineTable[],
  sourceLines: readonly InvoiceLineRow[],
  calculatedLines: readonly CalculatedCreditDraftLine[],
): NewInvoiceLineRow[] {
  const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
  const calculatedBySourceId = new Map(
    calculatedLines.flatMap((line) =>
      line.sourceInvoiceLineId === null
        ? []
        : [[line.sourceInvoiceLineId, line] as const],
    ),
  );
  const calculatedManualByDraftLineId = new Map(
    calculatedLines.flatMap((line) =>
      line.sourceInvoiceLineId === null
        ? [[line.lineKey, line] as const]
        : [],
    ),
  );

  return draftLines.map((draftLine) => {
    const sourceLineId = draftLine.source_invoice_line_id;
    const sourceLine =
      sourceLineId === null ? undefined : sourceById.get(sourceLineId);
    const calculated =
      sourceLineId === null
        ? calculatedManualByDraftLineId.get(draftLine.id)
        : calculatedBySourceId.get(sourceLineId);

    if (
      calculated === undefined ||
      (sourceLineId !== null && sourceLine === undefined)
    ) {
      throw new ApproveInvoiceDraftError(
        'Credit invoice draft source line is invalid.',
      );
    }

    return {
      id: draftLine.id,
      invoice_id: input.invoiceId,
      source_invoice_line_id: sourceLineId,
      line_order: draftLine.position,
      code: sourceLine?.code ?? draftLine.code,
      description: draftLine.description,
      quantity_hundredths: calculated.quantityHundredths,
      unit: sourceLine?.unit ?? draftLine.unit,
      unit_price_cents:
        sourceLine?.unit_price_cents ?? draftLine.unit_price_cents,
      vat_rate_basis_points:
        sourceLine?.vat_rate_basis_points ??
        draftLine.vat_rate_basis_points,
      discount_type: sourceLine?.discount_type ?? 'none',
      discount_value: sourceLine?.discount_value ?? 0,
      base_cents: calculated.baseCents,
      discount_cents: calculated.discountCents,
      net_cents: calculated.netCents,
      vat_cents: calculated.vatCents,
      gross_cents: calculated.grossCents,
      created_at: input.approvedAt,
    };
  });
}
