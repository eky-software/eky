export interface CustomerTable {
  id: string;
  company_id: string;
  customer_number: string;
  name: string;
  customer_type: string;
  managed_by_customer_id: string;
  business_id: string;
  street_address: string;
  postal_code: string;
  city: string;
  email: string;
  phone: string;
  comment: string;
  hourly_rate_override_cents: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CompanySettingsTable {
  id: string;
  company_id: string;
  company_name: string;
  business_id: string;
  vat_number: string;
  street_address: string;
  postal_code: string;
  city: string;
  email: string;
  phone: string;
  iban: string;
  bic: string;
  bank_name: string;
  default_hourly_rate_cents: number | null;
  hourly_rate_shortcut: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceDraftTable {
  id: string;
  company_id: string;
  customer_id: string;
  billing_recipient_customer_id: string | null;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  reminder_period_days: number;
  late_payment_interest_basis_points: number;
  price_input_mode: string;
  subject: string;
  order_number: string;
  note: string;
  delivery_address_text: string;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  created_at: string;
  updated_at: string;
  approved_invoice_id: string | null;
  approved_at: string | null;
}

export interface InvoiceDraftLineTable {
  id: string;
  invoice_draft_id: string;
  position: number;
  code: string;
  description: string;
  quantity_hundredths: number;
  unit: string;
  unit_price_cents: number;
  vat_rate_basis_points: number;
  discount_type: string;
  discount_value: number;
  base_cents: number;
  discount_cents: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
}

export interface InvoiceNumberingSettingsTable {
  company_id: string;
  series_key: string;
  mode: string;
  fiscal_year_start_month: number;
  sequence_padding: number;
  first_sequence_number: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceNumberSequenceTable {
  company_id: string;
  series_key: string;
  sequence_scope: string;
  last_sequence_number: number;
  created_at: string;
  updated_at: string;
}

export interface InvoicePaymentSettingsTable {
  company_id: string;
  default_late_payment_interest_basis_points: number;
  default_reminder_period_days: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceTable {
  id: string;
  company_id: string;
  source_draft_id: string;
  invoice_number: string;
  reference_number: string | null;
  reference_number_type: string | null;
  series_key: string;
  sequence_scope: string;
  sequence_number: number;
  numbering_mode: string;
  status: string;
  customer_id: string;
  customer_number_snapshot: string;
  customer_name_snapshot: string;
  customer_business_id_snapshot: string;
  customer_type_snapshot: string;
  customer_email_snapshot: string;
  customer_phone_snapshot: string;
  customer_street_address_snapshot: string;
  customer_postal_code_snapshot: string;
  customer_city_snapshot: string;
  company_name_snapshot: string;
  company_business_id_snapshot: string;
  company_vat_number_snapshot: string;
  company_street_address_snapshot: string;
  company_postal_code_snapshot: string;
  company_city_snapshot: string;
  company_email_snapshot: string;
  company_phone_snapshot: string;
  company_iban_snapshot: string;
  company_bic_snapshot: string;
  company_bank_name_snapshot: string;
  billing_recipient_customer_id: string | null;
  billing_recipient_customer_number_snapshot: string;
  billing_recipient_name_snapshot: string;
  billing_recipient_business_id_snapshot: string;
  billing_recipient_customer_type_snapshot: string;
  billing_recipient_email_snapshot: string;
  billing_recipient_phone_snapshot: string;
  billing_recipient_street_address_snapshot: string;
  billing_recipient_postal_code_snapshot: string;
  billing_recipient_city_snapshot: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  reminder_period_days: number;
  late_payment_interest_basis_points: number;
  price_input_mode: string;
  subject: string;
  order_number: string;
  note: string;
  delivery_address_text: string;
  total_net_cents: number;
  total_vat_cents: number;
  total_gross_cents: number;
  created_at: string;
  approved_at: string;
  updated_at: string;
}

export interface InvoiceLineTable {
  id: string;
  invoice_id: string;
  line_order: number;
  code: string;
  description: string;
  quantity_hundredths: number;
  unit: string;
  unit_price_cents: number;
  vat_rate_basis_points: number;
  discount_type: string;
  discount_value: number;
  base_cents: number;
  discount_cents: number;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
  created_at: string;
}

export interface InvoiceAuditEventTable {
  id: string;
  company_id: string;
  actor_user_id: string;
  action: string;
  draft_id: string;
  invoice_id: string;
  invoice_number: string;
  created_at: string;
}

export interface SchemaMigrationTable {
  name: string;
  run_at: string;
}

export type CustomerRow = CustomerTable;
export type NewCustomerRow = CustomerTable;
export type CompanySettingsRow = CompanySettingsTable;
export type NewCompanySettingsRow = CompanySettingsTable;
export type NewInvoiceDraftRow = Omit<
  InvoiceDraftTable,
  'approved_at' | 'approved_invoice_id'
>;
export type NewInvoiceDraftLineRow = InvoiceDraftLineTable;
export type InvoiceNumberingSettingsRow = InvoiceNumberingSettingsTable;
export type NewInvoiceNumberingSettingsRow = InvoiceNumberingSettingsTable;
export type InvoiceNumberSequenceRow = InvoiceNumberSequenceTable;
export type NewInvoiceNumberSequenceRow = InvoiceNumberSequenceTable;
export type InvoicePaymentSettingsRow = InvoicePaymentSettingsTable;
export type NewInvoicePaymentSettingsRow = InvoicePaymentSettingsTable;
export type InvoiceRow = InvoiceTable;
export type NewInvoiceRow = InvoiceTable;
export type InvoiceLineRow = InvoiceLineTable;
export type NewInvoiceLineRow = InvoiceLineTable;
export type InvoiceAuditEventRow = InvoiceAuditEventTable;
export type NewInvoiceAuditEventRow = InvoiceAuditEventTable;
