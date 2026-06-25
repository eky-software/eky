import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  NewInvoiceDraftLineRow,
  NewInvoiceDraftRow,
} from '../../../database/schema.js';
import {
  type InvoiceDraft,
  type InvoiceDraftLine,
  type InvoiceDraftStatus,
  type InvoiceUnit,
} from '../domain/invoiceDraft.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import type {
  InvoiceLineDiscount,
  InvoiceVatBreakdown,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';

type InvoiceDraftInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  number,
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
  string,
  string,
  number,
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

interface StoredDiscount {
  type: 'none' | 'percentage' | 'fixed';
  value: number;
}

type InvoiceDraftSelectParameters = [string, string];

interface InvoiceVatBreakdownRow {
  vat_rate_basis_points: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
}

interface InvoiceDraftSummaryRow {
  id: string;
  customer_id: string;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  price_input_mode: string;
  subject: string;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  updated_at: string;
}

const invoiceDraftSummarySelect = `
  SELECT
    id,
    customer_id,
    status,
    invoice_date,
    due_date,
    payment_term_days,
    price_input_mode,
    subject,
    net_total_cents,
    vat_total_cents,
    gross_total_cents,
    updated_at
  FROM invoice_drafts
`;

function toStoredDiscount(discount: InvoiceLineDiscount): StoredDiscount {
  if (discount.type === 'percentage') {
    return { type: discount.type, value: discount.basisPoints };
  }

  if (discount.type === 'fixed') {
    return { type: discount.type, value: discount.amountCents };
  }

  return { type: discount.type, value: 0 };
}

function toInvoiceLineDiscount(
  discountType: string,
  discountValue: number,
): InvoiceLineDiscount {
  if (discountType === 'none') {
    return { type: 'none' };
  }

  if (discountType === 'percentage') {
    return { type: 'percentage', basisPoints: discountValue };
  }

  if (discountType === 'fixed') {
    return { type: 'fixed', amountCents: discountValue };
  }

  throw new Error('Stored invoice draft discount type is invalid.');
}

function toInvoiceDraftRow(draft: InvoiceDraft): NewInvoiceDraftRow {
  return {
    id: draft.id,
    company_id: draft.companyId,
    customer_id: draft.customerId,
    status: draft.status,
    invoice_date: draft.invoiceDate,
    due_date: draft.dueDate,
    payment_term_days: draft.paymentTermDays,
    price_input_mode: draft.priceInputMode,
    subject: draft.subject,
    order_number: draft.orderNumber,
    note: draft.note,
    net_total_cents: draft.totals.netTotalCents,
    vat_total_cents: draft.totals.vatTotalCents,
    gross_total_cents: draft.totals.grossTotalCents,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

function toInvoiceDraftLineRows(
  draft: InvoiceDraft,
): NewInvoiceDraftLineRow[] {
  return draft.lines.map((line) => {
    const discount = toStoredDiscount(line.discount);

    return {
      id: line.id,
      invoice_draft_id: draft.id,
      position: line.position,
      code: line.code,
      description: line.description,
      quantity_hundredths: line.quantityHundredths,
      unit: line.unit,
      unit_price_cents: line.unitPriceCents,
      vat_rate_basis_points: line.vatRateBasisPoints,
      discount_type: discount.type,
      discount_value: discount.value,
      base_cents: line.baseCents,
      discount_cents: line.discountCents,
      net_cents: line.netCents,
      vat_cents: line.vatCents,
      gross_cents: line.grossCents,
    };
  });
}

function toInvoiceDraftLine(
  row: InvoiceDraftLineTable,
  priceInputMode: PriceInputMode,
): InvoiceDraftLine {
  return {
    id: row.id,
    position: row.position,
    code: row.code,
    description: row.description,
    quantityHundredths: row.quantity_hundredths,
    unit: row.unit as InvoiceUnit,
    unitPriceCents: row.unit_price_cents,
    vatRateBasisPoints: row.vat_rate_basis_points,
    priceInputMode,
    discount: toInvoiceLineDiscount(
      row.discount_type,
      row.discount_value,
    ),
    baseCents: row.base_cents,
    discountCents: row.discount_cents,
    netCents: row.net_cents,
    vatCents: row.vat_cents,
    grossCents: row.gross_cents,
  };
}

function toInvoiceVatBreakdown(
  row: InvoiceVatBreakdownRow,
): InvoiceVatBreakdown {
  return {
    vatRateBasisPoints: row.vat_rate_basis_points,
    netCents: row.net_cents,
    vatCents: row.vat_cents,
    grossCents: row.gross_cents,
  };
}

function toInvoiceDraftSummary(
  row: InvoiceDraftSummaryRow,
): InvoiceDraftSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status as InvoiceDraftStatus,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    paymentTermDays: row.payment_term_days,
    priceInputMode: row.price_input_mode as PriceInputMode,
    subject: row.subject,
    netTotalCents: row.net_total_cents,
    vatTotalCents: row.vat_total_cents,
    grossTotalCents: row.gross_total_cents,
    updatedAt: row.updated_at,
  };
}

export class SqliteInvoiceDraftRepository implements InvoiceDraftRepository {
  constructor(private readonly database: DatabaseConnection) {}

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
          status,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        draftRow.status,
        draftRow.invoice_date,
        draftRow.due_date,
        draftRow.payment_term_days,
        draftRow.price_input_mode,
        draftRow.subject,
        draftRow.order_number,
        draftRow.note,
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
            invoice_date = ?,
            due_date = ?,
            payment_term_days = ?,
            price_input_mode = ?,
            subject = ?,
            order_number = ?,
            note = ?,
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
        draftRow.invoice_date,
        draftRow.due_date,
        draftRow.payment_term_days,
        draftRow.price_input_mode,
        draftRow.subject,
        draftRow.order_number,
        draftRow.note,
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
    const draftRow = this.database
      .prepare<InvoiceDraftSelectParameters, InvoiceDraftTable>(
        `
          SELECT
            id,
            company_id,
            customer_id,
            status,
            invoice_date,
            due_date,
            payment_term_days,
            price_input_mode,
            subject,
            order_number,
            note,
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

    if (draftRow === undefined) {
      return undefined;
    }

    const lineRows = this.database
      .prepare<InvoiceDraftSelectParameters, InvoiceDraftLineTable>(
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
    const vatBreakdownRows = this.database
      .prepare<InvoiceDraftSelectParameters, InvoiceVatBreakdownRow>(
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
    const priceInputMode = draftRow.price_input_mode as PriceInputMode;

    return {
      id: draftRow.id,
      companyId: draftRow.company_id,
      customerId: draftRow.customer_id,
      status: draftRow.status as InvoiceDraftStatus,
      invoiceDate: draftRow.invoice_date,
      dueDate: draftRow.due_date,
      paymentTermDays: draftRow.payment_term_days,
      priceInputMode,
      subject: draftRow.subject,
      orderNumber: draftRow.order_number,
      note: draftRow.note,
      lines: lineRows.map((lineRow) =>
        toInvoiceDraftLine(lineRow, priceInputMode),
      ),
      totals: {
        netTotalCents: draftRow.net_total_cents,
        vatTotalCents: draftRow.vat_total_cents,
        grossTotalCents: draftRow.gross_total_cents,
        vatBreakdown: vatBreakdownRows.map(toInvoiceVatBreakdown),
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
      const rows = this.database
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

      return rows.map(toInvoiceDraftSummary);
    }

    const rows = this.database
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

    return rows.map(toInvoiceDraftSummary);
  }
}
