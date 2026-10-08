import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
} from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceContentRevisionLine } from '../domain/invoiceContentRevision.js';
import { validateInvoiceContentRevision } from './validateInvoiceContentRevision.js';

export function toInvoiceContentRevision(
  row: InvoiceContentRevisionRow,
  lines: readonly InvoiceRevisionLineRow[],
  vat: readonly InvoiceRevisionVatBreakdownRow[],
): InvoiceContentRevision {
  const content = {
    companyId: identifier(row.company_id),
    invoiceId: identifier(row.invoice_id),
    revisionId: identifier(row.id),
    sourceDraftId: identifier(row.source_draft_id),
    invoiceKind: member(row.invoice_kind, ['standard', 'credit']),
    creditedInvoiceId: nullableIdentifier(row.credited_invoice_id),
    creditedRevisionId: nullableIdentifier(row.credited_revision_id),
    creditedInvoiceNumberSnapshot: nullableText(row.credited_invoice_number_snapshot),
    creditedInvoiceDateSnapshot: nullableText(row.credited_invoice_date_snapshot),
    invoiceNumber: text(row.invoice_number),
    referenceNumber: nullableText(row.reference_number),
    referenceNumberType: row.reference_number_type === null
      ? null : member(row.reference_number_type, ['finnishDomestic']),
    seriesKey: identifier(row.series_key),
    sequenceScope: identifier(row.sequence_scope),
    sequenceNumber: integer(row.sequence_number, 1),
    numberingMode: member(row.numbering_mode, ['fiscalYearSequence', 'calendarYearSequence', 'plainSequence']),
    customerId: identifier(row.customer_id),
    customerNumberSnapshot: text(row.customer_number_snapshot),
    customerNameSnapshot: text(row.customer_name_snapshot),
    customerBusinessIdSnapshot: text(row.customer_business_id_snapshot),
    customerTypeSnapshot: text(row.customer_type_snapshot),
    customerEmailSnapshot: text(row.customer_email_snapshot),
    customerPhoneSnapshot: text(row.customer_phone_snapshot),
    customerStreetAddressSnapshot: text(row.customer_street_address_snapshot),
    customerPostalCodeSnapshot: text(row.customer_postal_code_snapshot),
    customerCitySnapshot: text(row.customer_city_snapshot),
    companyNameSnapshot: text(row.company_name_snapshot),
    companyBusinessIdSnapshot: text(row.company_business_id_snapshot),
    companyVatNumberSnapshot: text(row.company_vat_number_snapshot),
    companyStreetAddressSnapshot: text(row.company_street_address_snapshot),
    companyPostalCodeSnapshot: text(row.company_postal_code_snapshot),
    companyCitySnapshot: text(row.company_city_snapshot),
    companyEmailSnapshot: text(row.company_email_snapshot),
    companyPhoneSnapshot: text(row.company_phone_snapshot),
    companyWebsiteSnapshot: text(row.company_website_snapshot),
    companyIbanSnapshot: text(row.company_iban_snapshot),
    companyBicSnapshot: text(row.company_bic_snapshot),
    companyBankNameSnapshot: text(row.company_bank_name_snapshot),
    billingRecipientCustomerId: nullableIdentifier(row.billing_recipient_customer_id),
    billingRecipientCustomerNumberSnapshot: text(row.billing_recipient_customer_number_snapshot),
    billingRecipientNameSnapshot: text(row.billing_recipient_name_snapshot),
    billingRecipientBusinessIdSnapshot: text(row.billing_recipient_business_id_snapshot),
    billingRecipientCustomerTypeSnapshot: text(row.billing_recipient_customer_type_snapshot),
    billingRecipientEmailSnapshot: text(row.billing_recipient_email_snapshot),
    billingRecipientPhoneSnapshot: text(row.billing_recipient_phone_snapshot),
    billingRecipientStreetAddressSnapshot: text(row.billing_recipient_street_address_snapshot),
    billingRecipientPostalCodeSnapshot: text(row.billing_recipient_postal_code_snapshot),
    billingRecipientCitySnapshot: text(row.billing_recipient_city_snapshot),
    invoiceDate: text(row.invoice_date),
    dueDate: text(row.due_date),
    paymentTermDays: integer(row.payment_term_days),
    reminderPeriodDays: integer(row.reminder_period_days, 0, 365),
    latePaymentInterestBasisPoints: integer(row.late_payment_interest_basis_points, 0, 100000),
    priceInputMode: member(row.price_input_mode, ['net', 'gross']),
    subject: text(row.subject),
    orderNumber: text(row.order_number),
    note: text(row.note),
    deliveryAddressText: text(row.delivery_address_text),
    refundIbanSnapshot: text(row.refund_iban_snapshot),
    taxTreatment: member(row.tax_treatment, ['normalVat', 'reverseChargeConstruction']),
    taxTreatmentLabelSnapshot: text(row.tax_treatment_label_snapshot),
    taxLegalBasisSnapshot: text(row.tax_legal_basis_snapshot),
    performanceDate: nullableText(row.performance_date),
    performancePeriodStart: nullableText(row.performance_period_start),
    performancePeriodEnd: nullableText(row.performance_period_end),
    totalNetCents: integer(row.total_net_cents),
    totalVatCents: integer(row.total_vat_cents),
    totalGrossCents: integer(row.total_gross_cents),
    createdAt: text(row.created_at),
    approvedAt: text(row.approved_at),
    lines: lines.map((line) => {
      requireScope(row, line);
      return toRevisionLine(line);
    }),
  };
  const groups = vat.map((group) => {
    requireScope(row, group);
    return {
      vatRateBasisPoints: integer(group.vat_rate_basis_points),
      netCents: integer(group.net_cents),
      vatCents: integer(group.vat_cents),
      grossCents: integer(group.gross_cents),
    };
  });
  let revision: InvoiceContentRevision;
  if (row.origin === 'legacySnapshot') {
    if (row.vat_breakdown_state !== 'unavailable' || groups.length !== 0) fail();
    revision = { ...content, origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null };
  } else {
    const origin = member(row.origin, ['approval', 'validatedLegacySnapshot']);
    if (row.vat_breakdown_state !== 'authoritative') fail();
    revision = { ...content, origin, vatBreakdownState: 'authoritative', vatBreakdown: groups };
  }
  validateInvoiceContentRevision(revision);
  return revision;
}

function toRevisionLine(row: InvoiceRevisionLineRow): InvoiceContentRevisionLine {
  return {
    lineId: identifier(row.line_id),
    invoiceId: identifier(row.invoice_id),
    sourceInvoiceLineId: nullableIdentifier(row.source_invoice_line_id),
    sourceRevisionId: nullableIdentifier(row.source_revision_id),
    lineOrder: integer(row.line_order, 1),
    code: text(row.code),
    description: identifier(row.description),
    quantityHundredths: integer(row.quantity_hundredths),
    unit: identifier(row.unit),
    unitPriceCents: integer(row.unit_price_cents),
    vatRateBasisPoints: row.vat_rate_basis_points === null ? null : integer(row.vat_rate_basis_points),
    discountType: member(row.discount_type, ['none', 'percentage', 'fixed']),
    discountValue: integer(row.discount_value),
    baseCents: integer(row.base_cents),
    discountCents: integer(row.discount_cents),
    netCents: integer(row.net_cents),
    vatCents: integer(row.vat_cents),
    grossCents: integer(row.gross_cents),
    createdAt: text(row.created_at),
  };
}

function requireScope(
  header: InvoiceContentRevisionRow,
  child: InvoiceRevisionLineRow | InvoiceRevisionVatBreakdownRow,
): void {
  if (child.company_id !== header.company_id || child.invoice_id !== header.invoice_id || child.revision_id !== header.id) fail();
}

function text(value: unknown): string {
  if (typeof value !== 'string') fail();
  return value;
}

function identifier(value: unknown): string {
  const result = text(value);
  if (result.trim().length === 0) fail();
  return result;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function nullableIdentifier(value: unknown): string | null {
  return value === null ? null : identifier(value);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail();
  return value as T;
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
