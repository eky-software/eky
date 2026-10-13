import type {
  InvoiceContentRevisionRow,
  InvoiceRevisionLineRow,
  NewInvoiceLineRow,
  NewInvoiceRow,
} from '../../../database/schema.js';

// The persistence writer and bounded catalog share this exact snapshot field contract.
export const invoiceRevisionHeaderCopyFields = [
  'company_id',
  'source_draft_id',
  'invoice_kind',
  'credited_invoice_id',
  'invoice_number',
  'reference_number',
  'reference_number_type',
  'series_key',
  'sequence_scope',
  'sequence_number',
  'numbering_mode',
  'customer_id',
  'customer_number_snapshot',
  'customer_name_snapshot',
  'customer_business_id_snapshot',
  'customer_type_snapshot',
  'customer_email_snapshot',
  'customer_phone_snapshot',
  'customer_street_address_snapshot',
  'customer_postal_code_snapshot',
  'customer_city_snapshot',
  'company_name_snapshot',
  'company_business_id_snapshot',
  'company_vat_number_snapshot',
  'company_street_address_snapshot',
  'company_postal_code_snapshot',
  'company_city_snapshot',
  'company_email_snapshot',
  'company_phone_snapshot',
  'company_website_snapshot',
  'company_iban_snapshot',
  'company_bic_snapshot',
  'company_bank_name_snapshot',
  'billing_recipient_customer_id',
  'billing_recipient_customer_number_snapshot',
  'billing_recipient_name_snapshot',
  'billing_recipient_business_id_snapshot',
  'billing_recipient_customer_type_snapshot',
  'billing_recipient_email_snapshot',
  'billing_recipient_phone_snapshot',
  'billing_recipient_street_address_snapshot',
  'billing_recipient_postal_code_snapshot',
  'billing_recipient_city_snapshot',
  'invoice_date',
  'due_date',
  'payment_term_days',
  'reminder_period_days',
  'late_payment_interest_basis_points',
  'price_input_mode',
  'subject',
  'order_number',
  'note',
  'delivery_address_text',
  'refund_iban_snapshot',
  'tax_treatment',
  'tax_treatment_label_snapshot',
  'tax_legal_basis_snapshot',
  'performance_date',
  'performance_period_start',
  'performance_period_end',
  'total_net_cents',
  'total_vat_cents',
  'total_gross_cents',
  'created_at',
  'approved_at',
] as const satisfies readonly (keyof NewInvoiceRow & keyof InvoiceContentRevisionRow)[];

export const invoiceRevisionLineCopyFields = [
  'invoice_id',
  'source_invoice_line_id',
  'line_order',
  'code',
  'description',
  'quantity_hundredths',
  'unit',
  'unit_price_cents',
  'vat_rate_basis_points',
  'discount_type',
  'discount_value',
  'base_cents',
  'discount_cents',
  'net_cents',
  'vat_cents',
  'gross_cents',
  'created_at',
] as const satisfies readonly (keyof NewInvoiceLineRow & keyof InvoiceRevisionLineRow)[];

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
  validateInvoiceRevisionSourceBinding({
    invoiceKind: invoice.invoice_kind,
    creditedInvoicePresent: invoice.credited_invoice_id !== null,
    sourcePresent: source !== null,
    sourceCompanyMatches: source?.companyId === invoice.company_id,
    sourceInvoiceMatches: source?.invoiceId === invoice.credited_invoice_id,
  });

  // Deliberately exclude live status, payment and cancellation fields.
  return {
    ...Object.fromEntries(invoiceRevisionHeaderCopyFields.map(field => [field, invoice[field]])) as
      Pick<InvoiceContentRevisionRow, typeof invoiceRevisionHeaderCopyFields[number]>,
    id: revisionId,
    invoice_id: invoice.id,
    origin: 'approval',
    vat_breakdown_state: 'authoritative',
    credited_revision_id: source?.revisionId ?? null,
    credited_invoice_number_snapshot: source?.invoiceNumber ?? null,
    credited_invoice_date_snapshot: source?.invoiceDate ?? null,
  };
}

export function createInvoiceRevisionLineRow(
  companyId: string,
  revisionId: string,
  line: NewInvoiceLineRow,
  source: InvoiceRevisionCreditSource | null,
): InvoiceRevisionLineRow {
  return {
    ...Object.fromEntries(invoiceRevisionLineCopyFields.map(field => [field, line[field]])) as
      Pick<InvoiceRevisionLineRow, typeof invoiceRevisionLineCopyFields[number]>,
    company_id: companyId,
    revision_id: revisionId,
    line_id: line.id,
    source_revision_id:
      line.source_invoice_line_id === null ? null : source?.revisionId ?? null,
  };
}

export function validateInvoiceRevisionSourceBinding(facts: {
  invoiceKind: unknown;
  creditedInvoicePresent: boolean;
  sourcePresent: boolean;
  sourceCompanyMatches: boolean;
  sourceInvoiceMatches: boolean;
}): void {
  if ((facts.invoiceKind === 'standard' && (facts.creditedInvoicePresent || facts.sourcePresent)) ||
    (facts.invoiceKind === 'credit' && (!facts.sourcePresent || !facts.sourceCompanyMatches || !facts.sourceInvoiceMatches)) ||
    (facts.invoiceKind !== 'standard' && facts.invoiceKind !== 'credit')) {
    throw new Error('Invoice revision source binding is invalid.');
  }
}
