import type { InvoiceLineRow, InvoiceRow } from '../../../database/schema.js';
import type {
  ApprovedInvoiceListSort,
  ApprovedInvoiceSummary,
} from '../domain/approvedInvoiceSummary.js';
import type {
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../domain/approvedInvoiceView.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
import type { InvoiceUnit } from '../domain/invoiceDraft.js';
import type { InvoiceKind } from '../domain/invoiceKind.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import type { InvoicePaymentReadModel } from '../domain/invoicePayment.js';
import { fromInvoicePerformancePeriodColumns } from '../domain/invoicePerformancePeriod.js';
import type { ReferenceNumberType } from '../domain/invoiceReferenceNumber.js';
import { resolveInvoiceTaxTreatment } from '../domain/invoiceTaxTreatment.js';

export interface CreditedInvoiceIdentityRow {
  invoice_number: string;
  invoice_date: string;
}

export function getApprovedInvoiceListOrderBy(
  sort: ApprovedInvoiceListSort,
): string {
  switch (sort) {
    case 'invoiceDateAsc':
      return 'invoice_date ASC, id ASC';
    case 'dueDateAsc':
      return 'due_date ASC, id ASC';
    case 'customerNameAsc':
      return 'customer_name_snapshot COLLATE NOCASE ASC, invoice_date DESC, id DESC';
    case 'invoiceDateDesc':
      return 'invoice_date DESC, id DESC';
  }
}

export function toApprovedInvoiceSummary(
  invoice: InvoiceRow,
): ApprovedInvoiceSummary {
  return {
    id: invoice.id,
    invoiceKind: invoice.invoice_kind as InvoiceKind,
    creditedInvoiceId: invoice.credited_invoice_id,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    status: invoice.status as 'approved' | 'sent' | 'cancelled',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    subject: invoice.subject,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    grossTotalCents: invoice.total_gross_cents,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
    cancelledAt: invoice.cancelled_at,
    ...toInvoicePaymentReadModel(invoice),
  };
}

export function toApprovedInvoiceView(
  invoice: InvoiceRow,
  lines: InvoiceLineRow[],
  creditedInvoice: CreditedInvoiceIdentityRow | undefined,
): ApprovedInvoiceView {
  const taxTreatment = resolveInvoiceTaxTreatment(invoice.tax_treatment);
  const vatBreakdown =
    taxTreatment === 'normalVat' ? createVatBreakdown(lines) : [];

  return {
    id: invoice.id,
    companyId: invoice.company_id,
    sourceDraftId: invoice.source_draft_id,
    invoiceKind: invoice.invoice_kind as InvoiceKind,
    creditedInvoiceId: invoice.credited_invoice_id,
    creditedInvoiceNumber: creditedInvoice?.invoice_number ?? null,
    creditedInvoiceDate: creditedInvoice?.invoice_date ?? null,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    referenceNumberType:
      (invoice.reference_number_type ?? 'none') as ReferenceNumberType,
    seriesKey: invoice.series_key,
    sequenceScope: invoice.sequence_scope,
    sequenceNumber: invoice.sequence_number,
    numberingMode: invoice.numbering_mode as InvoiceNumberingMode,
    status: invoice.status as 'approved' | 'sent' | 'cancelled',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    customerBusinessIdSnapshot: invoice.customer_business_id_snapshot,
    customerTypeSnapshot: invoice.customer_type_snapshot,
    customerEmailSnapshot: invoice.customer_email_snapshot,
    customerPhoneSnapshot: invoice.customer_phone_snapshot,
    customerStreetAddressSnapshot: invoice.customer_street_address_snapshot,
    customerPostalCodeSnapshot: invoice.customer_postal_code_snapshot,
    customerCitySnapshot: invoice.customer_city_snapshot,
    companyNameSnapshot: invoice.company_name_snapshot,
    companyBusinessIdSnapshot: invoice.company_business_id_snapshot,
    companyVatNumberSnapshot: invoice.company_vat_number_snapshot,
    companyStreetAddressSnapshot: invoice.company_street_address_snapshot,
    companyPostalCodeSnapshot: invoice.company_postal_code_snapshot,
    companyCitySnapshot: invoice.company_city_snapshot,
    companyEmailSnapshot: invoice.company_email_snapshot,
    companyPhoneSnapshot: invoice.company_phone_snapshot,
    companyWebsiteSnapshot: invoice.company_website_snapshot,
    companyIbanSnapshot: invoice.company_iban_snapshot,
    companyBicSnapshot: invoice.company_bic_snapshot,
    companyBankNameSnapshot: invoice.company_bank_name_snapshot,
    billingRecipientCustomerId: invoice.billing_recipient_customer_id,
    billingRecipientCustomerNumberSnapshot:
      invoice.billing_recipient_customer_number_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    billingRecipientBusinessIdSnapshot:
      invoice.billing_recipient_business_id_snapshot,
    billingRecipientCustomerTypeSnapshot:
      invoice.billing_recipient_customer_type_snapshot,
    billingRecipientEmailSnapshot: invoice.billing_recipient_email_snapshot,
    billingRecipientPhoneSnapshot: invoice.billing_recipient_phone_snapshot,
    billingRecipientStreetAddressSnapshot:
      invoice.billing_recipient_street_address_snapshot,
    billingRecipientPostalCodeSnapshot:
      invoice.billing_recipient_postal_code_snapshot,
    billingRecipientCitySnapshot: invoice.billing_recipient_city_snapshot,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    paymentTermDays: invoice.payment_term_days,
    reminderPeriodDays: invoice.reminder_period_days,
    latePaymentInterestBasisPoints: invoice.late_payment_interest_basis_points,
    priceInputMode: invoice.price_input_mode as 'net' | 'gross',
    taxTreatment,
    taxTreatmentLabelSnapshot: invoice.tax_treatment_label_snapshot,
    taxLegalBasisSnapshot: invoice.tax_legal_basis_snapshot,
    performancePeriod: fromInvoicePerformancePeriodColumns({
      performanceDate: invoice.performance_date,
      performancePeriodStart: invoice.performance_period_start,
      performancePeriodEnd: invoice.performance_period_end,
    }),
    subject: invoice.subject,
    orderNumber: invoice.order_number,
    note: invoice.note,
    deliveryAddressText: invoice.delivery_address_text,
    refundIbanSnapshot: invoice.refund_iban_snapshot,
    lines: lines.map(toApprovedInvoiceViewLine),
    totals: {
      netTotalCents: invoice.total_net_cents,
      vatTotalCents: invoice.total_vat_cents,
      grossTotalCents: invoice.total_gross_cents,
      vatBreakdown,
    },
    vatBreakdown,
    createdAt: invoice.created_at,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
    cancelledAt: invoice.cancelled_at,
    cancelledBy: invoice.cancelled_by,
    cancellationReason: invoice.cancellation_reason,
    ...toInvoicePaymentReadModel(invoice),
  };
}

function toInvoicePaymentReadModel(
  invoice: InvoiceRow,
): InvoicePaymentReadModel {
  if (invoice.invoice_kind === 'credit') {
    return {
      paidAmountCents: null,
      paidOn: null,
      paymentSource: null,
      paymentState: 'notApplicable',
    };
  }

  if (
    invoice.payment_state === 'unpaid' &&
    invoice.paid_on === null &&
    invoice.paid_amount_cents === null &&
    invoice.payment_source === null
  ) {
    return {
      paidAmountCents: null,
      paidOn: null,
      paymentSource: null,
      paymentState: 'unpaid',
    };
  }

  if (
    invoice.payment_state === 'paid' &&
    invoice.paid_on !== null &&
    invoice.paid_amount_cents !== null &&
    invoice.paid_amount_cents > 0 &&
    invoice.payment_source === 'manual'
  ) {
    return {
      paidAmountCents: invoice.paid_amount_cents,
      paidOn: invoice.paid_on,
      paymentSource: 'manual',
      paymentState: 'paid',
    };
  }

  throw new Error('Invoice payment state is invalid.');
}

function toApprovedInvoiceViewLine(line: InvoiceLineRow): ApprovedInvoiceViewLine {
  return {
    id: line.id,
    sourceInvoiceLineId: line.source_invoice_line_id,
    lineOrder: line.line_order,
    code: line.code,
    description: line.description,
    quantityHundredths: line.quantity_hundredths,
    unit: line.unit as InvoiceUnit,
    unitPriceCents: line.unit_price_cents,
    vatRateBasisPoints: line.vat_rate_basis_points,
    discount: toDiscount(line),
    baseCents: line.base_cents,
    discountCents: line.discount_cents,
    netCents: line.net_cents,
    vatCents: line.vat_cents,
    grossCents: line.gross_cents,
  };
}

function toDiscount(line: InvoiceLineRow): InvoiceLineDiscount {
  if (line.discount_type === 'none') {
    return { type: 'none' };
  }

  if (line.discount_type === 'percentage') {
    return { type: 'percentage', basisPoints: line.discount_value };
  }

  if (line.discount_type === 'fixed') {
    return { type: 'fixed', amountCents: line.discount_value };
  }

  throw new Error('Stored invoice line discount type is invalid.');
}

function createVatBreakdown(
  lines: InvoiceLineRow[],
): ApprovedInvoiceVatBreakdown[] {
  const breakdownByRate = new Map<number, ApprovedInvoiceVatBreakdown>();

  for (const line of lines) {
    if (line.vat_rate_basis_points === null) {
      throw new Error(
        'Stored normal VAT invoice line is missing its VAT rate.',
      );
    }

    const vatRateBasisPoints = line.vat_rate_basis_points;
    const current = breakdownByRate.get(vatRateBasisPoints) ?? {
      vatRateBasisPoints,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };

    breakdownByRate.set(vatRateBasisPoints, {
      vatRateBasisPoints,
      netCents: current.netCents + line.net_cents,
      vatCents: current.vatCents + line.vat_cents,
      grossCents: current.grossCents + line.gross_cents,
    });
  }

  return [...breakdownByRate.values()].sort(
    (first, second) => first.vatRateBasisPoints - second.vatRateBasisPoints,
  );
}
