ALTER TABLE customers ADD COLUMN managed_by_customer_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS customers_company_managed_by_customer_id_index
  ON customers (company_id, managed_by_customer_id);
