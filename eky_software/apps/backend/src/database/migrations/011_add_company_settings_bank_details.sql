ALTER TABLE company_settings
  ADD COLUMN iban TEXT NOT NULL DEFAULT '';

ALTER TABLE company_settings
  ADD COLUMN bic TEXT NOT NULL DEFAULT '';

ALTER TABLE company_settings
  ADD COLUMN bank_name TEXT NOT NULL DEFAULT '';
