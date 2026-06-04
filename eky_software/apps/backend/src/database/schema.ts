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
