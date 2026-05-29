export interface CustomerTable {
  id: string;
  company_id: string;
  customer_number: string;
  name: string;
  customer_type: string;
  business_id: string;
  street_address: string;
  postal_code: string;
  city: string;
  email: string;
  phone: string;
  comment: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SchemaMigrationTable {
  name: string;
  run_at: string;
}

export type CustomerRow = CustomerTable;
export type NewCustomerRow = CustomerTable;
