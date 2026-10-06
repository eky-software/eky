import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
  NewInvoiceLineRow,
  NewInvoiceRow,
} from '../../../database/schema.js';

export interface InvoiceRevisionCreditSource {
  companyId: string;
  invoiceId: string;
  revisionId: string;
  invoiceNumber: string;
  invoiceDate: string;
}

export function createInvoiceContentRevisionRow(
  invoice: NewInvoiceRow,
  revisionId: string,
  source: InvoiceRevisionCreditSource | null,
): InvoiceContentRevisionRow {
  if (
    (invoice.invoice_kind === 'standard' &&
      (invoice.credited_invoice_id !== null || source !== null)) ||
    (invoice.invoice_kind === 'credit' &&
      (source === null || source.companyId !== invoice.company_id ||
        source.invoiceId !== invoice.credited_invoice_id)) ||
    !['standard', 'credit'].includes(invoice.invoice_kind)
  ) {
    throw new Error('Invoice revision source binding is invalid.');
  }

  // Deliberately exclude live status, payment and cancellation fields.
  return {
    id: revisionId,
    company_id: invoice.company_id,
    invoice_id: invoice.id,
    origin: 'approval',
    vat_breakdown_state: 'authoritative',
    source_draft_id: invoice.source_draft_id,
    invoice_kind: invoice.invoice_kind,
    credited_invoice_id: invoice.credited_invoice_id,
    credited_revision_id: source?.revisionId ?? null,
    credited_invoice_number_snapshot: source?.invoiceNumber ?? null,
    credited_invoice_date_snapshot: source?.invoiceDate ?? null,
    invoice_number: invoice.invoice_number,
    reference_number: invoice.reference_number,
    reference_number_type: invoice.reference_number_type,
    series_key: invoice.series_key,
    sequence_scope: invoice.sequence_scope,
    sequence_number: invoice.sequence_number,
    numbering_mode: invoice.numbering_mode,
    customer_id: invoice.customer_id,
    customer_number_snapshot: invoice.customer_number_snapshot,
    customer_name_snapshot: invoice.customer_name_snapshot,
    customer_business_id_snapshot: invoice.customer_business_id_snapshot,
    customer_type_snapshot: invoice.customer_type_snapshot,
    customer_email_snapshot: invoice.customer_email_snapshot,
    customer_phone_snapshot: invoice.customer_phone_snapshot,
    customer_street_address_snapshot: invoice.customer_street_address_snapshot,
    customer_postal_code_snapshot: invoice.customer_postal_code_snapshot,
    customer_city_snapshot: invoice.customer_city_snapshot,
    company_name_snapshot: invoice.company_name_snapshot,
    company_business_id_snapshot: invoice.company_business_id_snapshot,
    company_vat_number_snapshot: invoice.company_vat_number_snapshot,
    company_street_address_snapshot: invoice.company_street_address_snapshot,
    company_postal_code_snapshot: invoice.company_postal_code_snapshot,
    company_city_snapshot: invoice.company_city_snapshot,
    company_email_snapshot: invoice.company_email_snapshot,
    company_phone_snapshot: invoice.company_phone_snapshot,
    company_website_snapshot: invoice.company_website_snapshot,
    company_iban_snapshot: invoice.company_iban_snapshot,
    company_bic_snapshot: invoice.company_bic_snapshot,
    company_bank_name_snapshot: invoice.company_bank_name_snapshot,
    billing_recipient_customer_id: invoice.billing_recipient_customer_id,
    billing_recipient_customer_number_snapshot:
      invoice.billing_recipient_customer_number_snapshot,
    billing_recipient_name_snapshot: invoice.billing_recipient_name_snapshot,
    billing_recipient_business_id_snapshot:
      invoice.billing_recipient_business_id_snapshot,
    billing_recipient_customer_type_snapshot:
      invoice.billing_recipient_customer_type_snapshot,
    billing_recipient_email_snapshot: invoice.billing_recipient_email_snapshot,
    billing_recipient_phone_snapshot: invoice.billing_recipient_phone_snapshot,
    billing_recipient_street_address_snapshot:
      invoice.billing_recipient_street_address_snapshot,
    billing_recipient_postal_code_snapshot:
      invoice.billing_recipient_postal_code_snapshot,
    billing_recipient_city_snapshot: invoice.billing_recipient_city_snapshot,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    payment_term_days: invoice.payment_term_days,
    reminder_period_days: invoice.reminder_period_days,
    late_payment_interest_basis_points: invoice.late_payment_interest_basis_points,
    price_input_mode: invoice.price_input_mode,
    subject: invoice.subject,
    order_number: invoice.order_number,
    note: invoice.note,
    delivery_address_text: invoice.delivery_address_text,
    refund_iban_snapshot: invoice.refund_iban_snapshot,
    tax_treatment: invoice.tax_treatment,
    tax_treatment_label_snapshot: invoice.tax_treatment_label_snapshot,
    tax_legal_basis_snapshot: invoice.tax_legal_basis_snapshot,
    performance_date: invoice.performance_date,
    performance_period_start: invoice.performance_period_start,
    performance_period_end: invoice.performance_period_end,
    total_net_cents: invoice.total_net_cents,
    total_vat_cents: invoice.total_vat_cents,
    total_gross_cents: invoice.total_gross_cents,
    created_at: invoice.created_at,
    approved_at: invoice.approved_at,
  };
}

export function createInvoiceRevisionLineRow(
  companyId: string,
  revisionId: string,
  line: NewInvoiceLineRow,
  source: InvoiceRevisionCreditSource | null,
): InvoiceRevisionLineRow {
  return {
    company_id: companyId,
    invoice_id: line.invoice_id,
    revision_id: revisionId,
    line_id: line.id,
    source_invoice_line_id: line.source_invoice_line_id,
    source_revision_id:
      line.source_invoice_line_id === null ? null : source?.revisionId ?? null,
    line_order: line.line_order,
    code: line.code,
    description: line.description,
    quantity_hundredths: line.quantity_hundredths,
    unit: line.unit,
    unit_price_cents: line.unit_price_cents,
    vat_rate_basis_points: line.vat_rate_basis_points,
    discount_type: line.discount_type,
    discount_value: line.discount_value,
    base_cents: line.base_cents,
    discount_cents: line.discount_cents,
    net_cents: line.net_cents,
    vat_cents: line.vat_cents,
    gross_cents: line.gross_cents,
    created_at: line.created_at,
  };
}
