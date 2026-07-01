ALTER TABLE invoices
  ADD COLUMN company_vat_number_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_street_address_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_postal_code_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_city_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_email_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_phone_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_iban_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_bic_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN company_bank_name_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN customer_email_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN customer_phone_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN customer_street_address_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN customer_postal_code_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN customer_city_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_customer_id TEXT;

ALTER TABLE invoices
  ADD COLUMN billing_recipient_customer_number_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_name_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_business_id_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_customer_type_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_email_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_phone_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_street_address_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_postal_code_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN billing_recipient_city_snapshot TEXT NOT NULL DEFAULT '';

ALTER TABLE invoices
  ADD COLUMN late_payment_interest_basis_points INTEGER NOT NULL DEFAULT 0
    CHECK (
      late_payment_interest_basis_points >= 0
      AND late_payment_interest_basis_points <= 100000
    );

ALTER TABLE invoices
  ADD COLUMN reminder_period_days INTEGER NOT NULL DEFAULT 0
    CHECK (
      reminder_period_days >= 0
      AND reminder_period_days <= 365
    );

ALTER TABLE invoices
  ADD COLUMN delivery_address_text TEXT NOT NULL DEFAULT '';
