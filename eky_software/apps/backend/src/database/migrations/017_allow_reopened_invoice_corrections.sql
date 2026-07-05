ALTER TABLE invoices RENAME TO invoices_old;
ALTER TABLE invoice_lines RENAME TO invoice_lines_old;
ALTER TABLE invoice_audit_events RENAME TO invoice_audit_events_old;

DROP INDEX IF EXISTS invoices_company_approved_at_index;
DROP INDEX IF EXISTS invoices_company_reference_number_unique_index;
DROP INDEX IF EXISTS invoice_lines_invoice_order_index;
DROP INDEX IF EXISTS invoice_audit_events_company_created_at_index;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source_draft_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  reference_number TEXT,
  reference_number_type TEXT,
  series_key TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  numbering_mode TEXT NOT NULL CHECK (numbering_mode IN ('fiscalYearSequence', 'calendarYearSequence', 'plainSequence')),
  status TEXT NOT NULL CHECK (status IN ('approved', 'reopened_for_edit')),
  customer_id TEXT NOT NULL,
  customer_number_snapshot TEXT NOT NULL DEFAULT '',
  customer_name_snapshot TEXT NOT NULL DEFAULT '',
  customer_business_id_snapshot TEXT NOT NULL DEFAULT '',
  customer_type_snapshot TEXT NOT NULL DEFAULT '',
  customer_email_snapshot TEXT NOT NULL DEFAULT '',
  customer_phone_snapshot TEXT NOT NULL DEFAULT '',
  customer_street_address_snapshot TEXT NOT NULL DEFAULT '',
  customer_postal_code_snapshot TEXT NOT NULL DEFAULT '',
  customer_city_snapshot TEXT NOT NULL DEFAULT '',
  company_name_snapshot TEXT NOT NULL DEFAULT '',
  company_business_id_snapshot TEXT NOT NULL DEFAULT '',
  company_vat_number_snapshot TEXT NOT NULL DEFAULT '',
  company_street_address_snapshot TEXT NOT NULL DEFAULT '',
  company_postal_code_snapshot TEXT NOT NULL DEFAULT '',
  company_city_snapshot TEXT NOT NULL DEFAULT '',
  company_email_snapshot TEXT NOT NULL DEFAULT '',
  company_phone_snapshot TEXT NOT NULL DEFAULT '',
  company_iban_snapshot TEXT NOT NULL DEFAULT '',
  company_bic_snapshot TEXT NOT NULL DEFAULT '',
  company_bank_name_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_customer_id TEXT,
  billing_recipient_customer_number_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_name_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_business_id_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_customer_type_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_email_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_phone_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_street_address_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_postal_code_snapshot TEXT NOT NULL DEFAULT '',
  billing_recipient_city_snapshot TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_term_days INTEGER NOT NULL CHECK (payment_term_days >= 0),
  reminder_period_days INTEGER NOT NULL DEFAULT 0
    CHECK (reminder_period_days >= 0 AND reminder_period_days <= 365),
  late_payment_interest_basis_points INTEGER NOT NULL DEFAULT 0
    CHECK (
      late_payment_interest_basis_points >= 0
      AND late_payment_interest_basis_points <= 100000
    ),
  price_input_mode TEXT NOT NULL CHECK (price_input_mode IN ('net', 'gross')),
  subject TEXT NOT NULL DEFAULT '',
  order_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  delivery_address_text TEXT NOT NULL DEFAULT '',
  total_net_cents INTEGER NOT NULL CHECK (total_net_cents >= 0),
  total_vat_cents INTEGER NOT NULL CHECK (total_vat_cents >= 0),
  total_gross_cents INTEGER NOT NULL CHECK (total_gross_cents >= 0),
  created_at TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_draft_id) REFERENCES invoice_drafts (id) ON DELETE RESTRICT,
  UNIQUE (company_id, invoice_number),
  UNIQUE (company_id, source_draft_id)
);

INSERT INTO invoices (
  id,
  company_id,
  source_draft_id,
  invoice_number,
  reference_number,
  reference_number_type,
  series_key,
  sequence_scope,
  sequence_number,
  numbering_mode,
  status,
  customer_id,
  customer_number_snapshot,
  customer_name_snapshot,
  customer_business_id_snapshot,
  customer_type_snapshot,
  customer_email_snapshot,
  customer_phone_snapshot,
  customer_street_address_snapshot,
  customer_postal_code_snapshot,
  customer_city_snapshot,
  company_name_snapshot,
  company_business_id_snapshot,
  company_vat_number_snapshot,
  company_street_address_snapshot,
  company_postal_code_snapshot,
  company_city_snapshot,
  company_email_snapshot,
  company_phone_snapshot,
  company_iban_snapshot,
  company_bic_snapshot,
  company_bank_name_snapshot,
  billing_recipient_customer_id,
  billing_recipient_customer_number_snapshot,
  billing_recipient_name_snapshot,
  billing_recipient_business_id_snapshot,
  billing_recipient_customer_type_snapshot,
  billing_recipient_email_snapshot,
  billing_recipient_phone_snapshot,
  billing_recipient_street_address_snapshot,
  billing_recipient_postal_code_snapshot,
  billing_recipient_city_snapshot,
  invoice_date,
  due_date,
  payment_term_days,
  reminder_period_days,
  late_payment_interest_basis_points,
  price_input_mode,
  subject,
  order_number,
  note,
  delivery_address_text,
  total_net_cents,
  total_vat_cents,
  total_gross_cents,
  created_at,
  approved_at,
  updated_at
)
SELECT
  id,
  company_id,
  source_draft_id,
  invoice_number,
  reference_number,
  reference_number_type,
  series_key,
  sequence_scope,
  sequence_number,
  numbering_mode,
  status,
  customer_id,
  customer_number_snapshot,
  customer_name_snapshot,
  customer_business_id_snapshot,
  customer_type_snapshot,
  customer_email_snapshot,
  customer_phone_snapshot,
  customer_street_address_snapshot,
  customer_postal_code_snapshot,
  customer_city_snapshot,
  company_name_snapshot,
  company_business_id_snapshot,
  company_vat_number_snapshot,
  company_street_address_snapshot,
  company_postal_code_snapshot,
  company_city_snapshot,
  company_email_snapshot,
  company_phone_snapshot,
  company_iban_snapshot,
  company_bic_snapshot,
  company_bank_name_snapshot,
  billing_recipient_customer_id,
  billing_recipient_customer_number_snapshot,
  billing_recipient_name_snapshot,
  billing_recipient_business_id_snapshot,
  billing_recipient_customer_type_snapshot,
  billing_recipient_email_snapshot,
  billing_recipient_phone_snapshot,
  billing_recipient_street_address_snapshot,
  billing_recipient_postal_code_snapshot,
  billing_recipient_city_snapshot,
  invoice_date,
  due_date,
  payment_term_days,
  reminder_period_days,
  late_payment_interest_basis_points,
  price_input_mode,
  subject,
  order_number,
  note,
  delivery_address_text,
  total_net_cents,
  total_vat_cents,
  total_gross_cents,
  created_at,
  approved_at,
  updated_at
FROM invoices_old;

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  line_order INTEGER NOT NULL CHECK (line_order >= 1),
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity_hundredths INTEGER NOT NULL CHECK (quantity_hundredths >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('h', 'kpl', 'pv', 'km', 'erä')),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  vat_rate_basis_points INTEGER NOT NULL CHECK (vat_rate_basis_points >= 0),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('none', 'percentage', 'fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  UNIQUE (invoice_id, line_order)
);

INSERT INTO invoice_lines
SELECT * FROM invoice_lines_old;

CREATE TABLE invoice_audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'invoice.approved',
      'invoice.reopened_for_edit',
      'invoice.reapproved'
    )
  ),
  draft_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
);

INSERT INTO invoice_audit_events
SELECT * FROM invoice_audit_events_old;

DROP TABLE invoice_lines_old;
DROP TABLE invoice_audit_events_old;
DROP TABLE invoices_old;

CREATE INDEX invoices_company_approved_at_index
  ON invoices (company_id, approved_at);

CREATE UNIQUE INDEX invoices_company_reference_number_unique_index
  ON invoices (company_id, reference_number)
  WHERE reference_number IS NOT NULL;

CREATE INDEX invoice_lines_invoice_order_index
  ON invoice_lines (invoice_id, line_order);

CREATE INDEX invoice_audit_events_company_created_at_index
  ON invoice_audit_events (company_id, created_at);
