ALTER TABLE company_settings
  ADD COLUMN website TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_website_snapshot TEXT NOT NULL DEFAULT '';
