import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  NewInvoiceDraftLineRow,
  NewInvoiceDraftRow,
} from '../../../database/schema.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
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

interface StoredDiscount {
  type: 'none' | 'percentage' | 'fixed';
  value: number;
}

function toStoredDiscount(discount: InvoiceLineDiscount): StoredDiscount {
  if (discount.type === 'percentage') {
    return { type: discount.type, value: discount.basisPoints };
  }

  if (discount.type === 'fixed') {
    return { type: discount.type, value: discount.amountCents };
  }

  return { type: discount.type, value: 0 };
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

export class SqliteInvoiceDraftRepository implements InvoiceDraftRepository {
  constructor(private readonly database: DatabaseConnection) {}

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
}
