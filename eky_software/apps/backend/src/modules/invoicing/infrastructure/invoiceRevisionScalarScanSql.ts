import { invoiceKinds } from '../domain/invoiceKind.js';
import { getInvoiceTaxTreatmentSnapshot, invoiceTaxTreatments } from '../domain/invoiceTaxTreatment.js';
import {
  revisionDiscountTypes, revisionNumberingModes, revisionOrigins, revisionPriceInputModes,
  revisionReferenceTypes, revisionVatStates,
} from './invoiceRevisionStoredValues.js';

const plainHeaderText = [
  'invoice_number', 'customer_number_snapshot', 'customer_name_snapshot', 'customer_business_id_snapshot',
  'customer_type_snapshot', 'customer_email_snapshot', 'customer_phone_snapshot', 'customer_street_address_snapshot',
  'customer_postal_code_snapshot', 'customer_city_snapshot', 'company_name_snapshot', 'company_business_id_snapshot',
  'company_vat_number_snapshot', 'company_street_address_snapshot', 'company_postal_code_snapshot', 'company_city_snapshot',
  'company_email_snapshot', 'company_phone_snapshot', 'company_website_snapshot', 'company_iban_snapshot',
  'company_bic_snapshot', 'company_bank_name_snapshot', 'billing_recipient_customer_number_snapshot',
  'billing_recipient_name_snapshot', 'billing_recipient_business_id_snapshot', 'billing_recipient_customer_type_snapshot',
  'billing_recipient_email_snapshot', 'billing_recipient_phone_snapshot', 'billing_recipient_street_address_snapshot',
  'billing_recipient_postal_code_snapshot', 'billing_recipient_city_snapshot', 'invoice_date', 'due_date',
  'subject', 'order_number', 'note', 'delivery_address_text', 'refund_iban_snapshot', 'created_at', 'approved_at',
] as const;
const nullableHeaderText = ['credited_invoice_number_snapshot', 'credited_invoice_date_snapshot', 'reference_number'] as const;
const dates = ['performance_date', 'performance_period_start', 'performance_period_end'] as const;
// The existing date grammar accepts exactly ten ASCII characters. SQLite's
// UTF-16 getter can ignore one odd trailing byte; this is not a new data limit.
const performanceDateByteBound = 10 * 2 + 1;
const headerNumbers = ['sequence_number', 'payment_term_days', 'reminder_period_days', 'late_payment_interest_basis_points',
  'total_net_cents', 'total_vat_cents', 'total_gross_cents'] as const;
const lineNumbers = ['line_order', 'quantity_hundredths', 'unit_price_cents', 'vat_rate_basis_points', 'discount_value',
  'base_cents', 'discount_cents', 'net_cents', 'vat_cents', 'gross_cents'] as const;

// These are closed SQL fragments, not caller-supplied column names. Only fixed facts,
// numeric values and bounded enum/date text cross the native/JS boundary.
function numberValue(column: string): string {
  return `CASE WHEN typeof(${column}) IN ('integer', 'real') THEN ${column} ELSE NULL END AS ${column.split('.')[1]}`;
}
function smallText(column: string, byteBound: number): string {
  return `CASE WHEN typeof(${column}) = 'text' AND length(CAST(${column} AS BLOB)) <= ${byteBound}
    THEN ${column} ELSE NULL END AS ${column.split('.')[1]}`;
}
function closedText(column: string, values: readonly string[]): string {
  // Include a possible trailing odd UTF-16 byte ignored by SQLite's ordinary getter.
  const bytes = Math.max(...values.map(value => Math.max(Buffer.byteLength(value), value.length * 2))) + 1;
  return smallText(column, bytes);
}
function scope(child: string): string {
  return `typeof(${child}.company_id) = 'text' AND typeof(${child}.invoice_id) = 'text'
    AND typeof(${child}.revision_id) = 'text' AND ${child}.company_id = header.company_id
    AND ${child}.invoice_id = header.invoice_id AND ${child}.revision_id = header.id`;
}
const hasLines = 'EXISTS(SELECT 1 FROM invoice_revision_lines line WHERE line.revision_id = header.id)';
const hasVat = 'EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown vat WHERE vat.revision_id = header.id)';
const lineRatesHaveGroups = `NOT EXISTS(SELECT 1 FROM invoice_revision_lines line WHERE line.revision_id = header.id
  AND NOT EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown vat
    WHERE vat.revision_id = header.id AND vat.vat_rate_basis_points = line.vat_rate_basis_points))`;
const taxSnapshots = invoiceTaxTreatments.map(getInvoiceTaxTreatmentSnapshot);

export const invoiceRevisionHeaderScanSql = `SELECT
  ${plainHeaderText.map(field => `typeof(header.${field}) = 'text'`).join(' AND ')}
    AND ${nullableHeaderText.map(field => `typeof(header.${field}) IN ('null', 'text')`).join(' AND ')} AS text_types_valid,
  ${headerNumbers.map(field => numberValue(`header.${field}`)).join(',\n  ')},
  ${closedText('header.invoice_kind', invoiceKinds)},
  ${closedText('header.origin', revisionOrigins)},
  ${closedText('header.vat_breakdown_state', revisionVatStates)},
  ${closedText('header.numbering_mode', revisionNumberingModes)},
  ${closedText('header.reference_number_type', revisionReferenceTypes)},
  ${closedText('header.price_input_mode', revisionPriceInputModes)},
  ${closedText('header.tax_treatment', invoiceTaxTreatments)},
  ${closedText('header.tax_treatment_label_snapshot', taxSnapshots.map(value => value.label))},
  ${closedText('header.tax_legal_basis_snapshot', taxSnapshots.map(value => value.legalBasis))},
  ${dates.map(field => smallText(`header.${field}`, performanceDateByteBound)).join(',\n  ')},
  ${dates.map(field => `(header.${field} IS NULL OR (typeof(header.${field}) = 'text'
    AND length(CAST(header.${field} AS BLOB)) <= ${performanceDateByteBound}))`).join(' AND ')} AS date_types_valid,
  header.credited_invoice_id IS NOT NULL AS credit_invoice_present,
  header.credited_revision_id IS NOT NULL AS credit_revision_present,
  header.credited_invoice_number_snapshot IS NOT NULL AS credit_number_present,
  header.credited_invoice_date_snapshot IS NOT NULL AS credit_date_present,
  header.credited_invoice_id IS header.invoice_id AS credit_is_self,
  header.reference_number IS NOT NULL AS reference_present,
  header.reference_number_type IS NOT NULL AS reference_type_present,
  ${hasLines} AS has_lines, ${hasVat} AS has_vat_groups,
  ${lineRatesHaveGroups} AS line_rates_have_groups
FROM invoice_content_revisions header`;

export const invoiceRevisionLineScanSql = `SELECT
  typeof(line.code) = 'text' AND typeof(line.created_at) = 'text' AS text_types_valid,
  ${lineNumbers.map(field => numberValue(`line.${field}`)).join(',\n  ')},
  line.vat_rate_basis_points IS NULL AS vat_rate_absent,
  ${closedText('line.discount_type', revisionDiscountTypes)},
  ${closedText('header.invoice_kind', invoiceKinds)},
  ${closedText('header.origin', revisionOrigins)},
  ${closedText('header.tax_treatment', invoiceTaxTreatments)},
  COALESCE(${scope('line')}, 0) AS scope_matches,
  line.source_invoice_line_id IS NOT NULL AS source_line_present,
  line.source_revision_id IS NOT NULL AS source_revision_present,
  line.source_revision_id IS header.credited_revision_id AS source_matches_credit
FROM invoice_revision_lines line LEFT JOIN invoice_content_revisions header ON header.id = line.revision_id`;

export const invoiceRevisionVatScanSql = `SELECT
  ${['vat_rate_basis_points', 'net_cents', 'vat_cents', 'gross_cents'].map(field => numberValue(`vat.${field}`)).join(',\n  ')},
  ${['total_net_cents', 'total_vat_cents', 'total_gross_cents'].map(field => numberValue(`header.${field}`)).join(',\n  ')},
  COALESCE(${scope('vat')}, 0) AS scope_matches,
  EXISTS(SELECT 1 FROM invoice_revision_lines line WHERE line.revision_id = vat.revision_id
    AND line.vat_rate_basis_points = vat.vat_rate_basis_points) AS rate_has_line,
  NOT EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown next
    WHERE next.revision_id = vat.revision_id AND next.vat_rate_basis_points > vat.vat_rate_basis_points) AS last_group
FROM invoice_revision_vat_breakdown vat
LEFT JOIN invoice_content_revisions header ON header.id = vat.revision_id
ORDER BY vat.revision_id, vat.vat_rate_basis_points`;
