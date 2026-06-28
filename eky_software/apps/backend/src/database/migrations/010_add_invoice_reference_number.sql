ALTER TABLE invoices
  ADD COLUMN reference_number TEXT;

ALTER TABLE invoices
  ADD COLUMN reference_number_type TEXT;

CREATE UNIQUE INDEX invoices_company_reference_number_unique_index
  ON invoices (company_id, reference_number)
  WHERE reference_number IS NOT NULL;
