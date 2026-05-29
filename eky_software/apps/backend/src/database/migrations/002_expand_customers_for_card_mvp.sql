ALTER TABLE customers ADD COLUMN customer_number TEXT;
ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'company';
ALTER TABLE customers ADD COLUMN business_id TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN street_address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN comment TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

UPDATE customers
SET customer_number = substr(id, 1, 8)
WHERE customer_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_company_customer_number_unique
  ON customers (company_id, customer_number);
