import type { Insertable, Selectable } from 'kysely';

export interface DatabaseSchema {
  customers: CustomerTable;
  schema_migrations: SchemaMigrationTable;
}

export interface CustomerTable {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SchemaMigrationTable {
  name: string;
  run_at: string;
}

export type CustomerRow = Selectable<CustomerTable>;
export type NewCustomerRow = Insertable<CustomerTable>;
