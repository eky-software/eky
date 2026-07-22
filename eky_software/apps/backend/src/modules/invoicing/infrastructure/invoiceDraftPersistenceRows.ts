import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  NewInvoiceDraftLineRow,
  NewInvoiceDraftRow,
} from '../../../database/schema.js';
import type {
  InvoiceDraft,
  InvoiceDraftLine,
  InvoiceDraftStatus,
  InvoiceUnit,
} from '../domain/invoiceDraft.js';
import type { InvoiceDraftSummary } from '../domain/invoiceDraftSummary.js';
import type {
  InvoiceLineDiscount,
  InvoiceVatBreakdown,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';

interface StoredDiscount {
  type: 'none' | 'percentage' | 'fixed';
  value: number;
}

export interface InvoiceDraftSummaryRow {
  id: string;
  customer_id: string;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  late_payment_interest_basis_points: number;
  price_input_mode: string;
  subject: string;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  updated_at: string;
}

export interface InvoiceVatBreakdownRow {
  vat_rate_basis_points: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
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

export function toInvoiceDraftRow(draft: InvoiceDraft): NewInvoiceDraftRow {
  return {
    id: draft.id,
    company_id: draft.companyId,
    customer_id: draft.customerId,
    billing_recipient_customer_id: draft.billingRecipientCustomerId,
    status: draft.status,
    invoice_date: draft.invoiceDate,
    due_date: draft.dueDate,
    payment_term_days: draft.paymentTermDays,
    reminder_period_days: draft.reminderPeriodDays,
    late_payment_interest_basis_points:
      draft.latePaymentInterestBasisPoints,
    price_input_mode: draft.priceInputMode,
    subject: draft.subject,
    order_number: draft.orderNumber,
    note: draft.note,
    delivery_address_text: draft.deliveryAddressText,
    net_total_cents: draft.totals.netTotalCents,
    vat_total_cents: draft.totals.vatTotalCents,
    gross_total_cents: draft.totals.grossTotalCents,
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

export function toInvoiceDraftLineRows(
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

export function toInvoiceDraftLine(
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

export function toInvoiceDraftSummary(
  row: InvoiceDraftSummaryRow,
): InvoiceDraftSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status as InvoiceDraftStatus,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    paymentTermDays: row.payment_term_days,
    latePaymentInterestBasisPoints:
      row.late_payment_interest_basis_points,
    priceInputMode: row.price_input_mode as PriceInputMode,
    subject: row.subject,
    netTotalCents: row.net_total_cents,
    vatTotalCents: row.vat_total_cents,
    grossTotalCents: row.gross_total_cents,
    updatedAt: row.updated_at,
  };
}

export function toInvoiceVatBreakdown(
  row: InvoiceVatBreakdownRow,
): InvoiceVatBreakdown {
  return {
    vatRateBasisPoints: row.vat_rate_basis_points,
    netCents: row.net_cents,
    vatCents: row.vat_cents,
    grossCents: row.gross_cents,
  };
}
