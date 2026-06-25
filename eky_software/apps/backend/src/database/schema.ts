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
  street_address: string;
  postal_code: string;
  city: string;
  email: string;
  phone: string;
  default_hourly_rate_cents: number | null;
  hourly_rate_shortcut: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceDraftTable {
  id: string;
  company_id: string;
  customer_id: string;
  status: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  price_input_mode: string;
  subject: string;
  order_number: string;
  note: string;
  net_total_cents: number;
  vat_total_cents: number;
  gross_total_cents: number;
  created_at: string;
  updated_at: string;
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

export interface SchemaMigrationTable {
  name: string;
  run_at: string;
}

export type CustomerRow = CustomerTable;
export type NewCustomerRow = CustomerTable;
export type CompanySettingsRow = CompanySettingsTable;
export type NewCompanySettingsRow = CompanySettingsTable;
export type NewInvoiceDraftRow = InvoiceDraftTable;
export type NewInvoiceDraftLineRow = InvoiceDraftLineTable;
export type InvoiceNumberingSettingsRow = InvoiceNumberingSettingsTable;
export type NewInvoiceNumberingSettingsRow = InvoiceNumberingSettingsTable;
export type InvoiceNumberSequenceRow = InvoiceNumberSequenceTable;
export type NewInvoiceNumberSequenceRow = InvoiceNumberSequenceTable;
