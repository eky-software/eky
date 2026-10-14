import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
} from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceContentRevisionLine } from '../domain/invoiceContentRevision.js';
import { invoiceKinds } from '../domain/invoiceKind.js';
import { invoiceTaxTreatments } from '../domain/invoiceTaxTreatment.js';
import {
  revisionDiscountTypes, revisionNumberingModes, revisionPriceInputModes, revisionProvenance, revisionReferenceTypes,
  revisionIdentifier as identifier,
  revisionInteger as integer,
  revisionMember as member,
  revisionNullableIdentifier as nullableIdentifier,
  revisionNullableText as nullableText,
  revisionText as text,
} from './invoiceRevisionStoredValues.js';
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
    invoiceKind: member(row.invoice_kind, invoiceKinds),
    creditedInvoiceId: nullableIdentifier(row.credited_invoice_id),
    creditedRevisionId: nullableIdentifier(row.credited_revision_id),
    creditedInvoiceNumberSnapshot: nullableText(row.credited_invoice_number_snapshot),
    creditedInvoiceDateSnapshot: nullableText(row.credited_invoice_date_snapshot),
    invoiceNumber: text(row.invoice_number),
    referenceNumber: nullableText(row.reference_number),
    referenceNumberType: row.reference_number_type === null
      ? null : member(row.reference_number_type, revisionReferenceTypes),
    seriesKey: identifier(row.series_key),
    sequenceScope: identifier(row.sequence_scope),
    sequenceNumber: integer(row.sequence_number, 1),
    numberingMode: member(row.numbering_mode, revisionNumberingModes),
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
    priceInputMode: member(row.price_input_mode, revisionPriceInputModes),
    subject: text(row.subject),
    orderNumber: text(row.order_number),
    note: text(row.note),
    deliveryAddressText: text(row.delivery_address_text),
    refundIbanSnapshot: text(row.refund_iban_snapshot),
    taxTreatment: member(row.tax_treatment, invoiceTaxTreatments),
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
  const provenance = revisionProvenance(row.origin, row.vat_breakdown_state, groups.length > 0);
  const revision: InvoiceContentRevision = provenance.vatBreakdownState === 'unavailable'
    ? { ...content, ...provenance, vatBreakdown: null }
    : { ...content, ...provenance, vatBreakdown: groups };
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
    discountType: member(row.discount_type, revisionDiscountTypes),
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

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
