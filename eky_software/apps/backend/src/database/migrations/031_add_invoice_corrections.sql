ALTER TABLE invoice_delivery_events RENAME TO invoice_delivery_events_before_corrections;
ALTER TABLE invoice_documents RENAME TO invoice_documents_before_corrections;
ALTER TABLE invoice_lines RENAME TO invoice_lines_before_corrections;
ALTER TABLE invoice_audit_events RENAME TO invoice_audit_events_before_corrections;
ALTER TABLE invoices RENAME TO invoices_before_corrections;

DROP INDEX IF EXISTS invoice_delivery_events_company_invoice_created_index;
DROP INDEX IF EXISTS invoice_documents_company_invoice_index;
DROP INDEX IF EXISTS invoice_lines_invoice_order_index;
DROP INDEX IF EXISTS invoice_audit_events_company_created_at_index;
DROP INDEX IF EXISTS invoices_company_approved_at_index;
DROP INDEX IF EXISTS invoices_company_reference_number_unique_index;
DROP INDEX IF EXISTS invoices_company_status_invoice_date_id_index;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source_draft_id TEXT NOT NULL,
  invoice_kind TEXT NOT NULL DEFAULT 'standard'
    CHECK (invoice_kind IN ('standard', 'credit')),
  credited_invoice_id TEXT,
  invoice_number TEXT NOT NULL,
  reference_number TEXT,
  reference_number_type TEXT,
  series_key TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  numbering_mode TEXT NOT NULL CHECK (
    numbering_mode IN ('fiscalYearSequence', 'calendarYearSequence', 'plainSequence')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('approved', 'reopened_for_edit', 'sent', 'cancelled')
  ),
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
  company_website_snapshot TEXT NOT NULL DEFAULT '',
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
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  FOREIGN KEY (source_draft_id) REFERENCES invoice_drafts (id) ON DELETE RESTRICT,
  FOREIGN KEY (credited_invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  UNIQUE (company_id, invoice_number),
  UNIQUE (company_id, source_draft_id),
  CHECK (
    (invoice_kind = 'standard' AND credited_invoice_id IS NULL)
    OR (invoice_kind = 'credit' AND credited_invoice_id IS NOT NULL)
  ),
  CHECK (credited_invoice_id IS NULL OR credited_invoice_id <> id),
  CHECK (
    (
      status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND length(trim(cancelled_by)) > 0
      AND cancellation_reason IS NOT NULL
      AND length(trim(cancellation_reason)) > 0
      AND length(cancellation_reason) <= 500
    )
    OR (
      status <> 'cancelled'
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancellation_reason IS NULL
    )
  )
);

INSERT INTO invoices (
  id,
  company_id,
  source_draft_id,
  invoice_kind,
  credited_invoice_id,
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
  company_website_snapshot,
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
  updated_at,
  cancelled_at,
  cancelled_by,
  cancellation_reason
)
SELECT
  id,
  company_id,
  source_draft_id,
  'standard',
  NULL,
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
  company_website_snapshot,
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
  updated_at,
  NULL,
  NULL,
  NULL
FROM invoices_before_corrections;

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  source_invoice_line_id TEXT,
  line_order INTEGER NOT NULL CHECK (line_order >= 1),
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity_hundredths INTEGER NOT NULL CHECK (quantity_hundredths >= 0),
  unit TEXT NOT NULL CHECK (length(trim(unit)) > 0 AND length(trim(unit)) <= 8),
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
  FOREIGN KEY (source_invoice_line_id) REFERENCES invoice_lines (id) ON DELETE RESTRICT,
  UNIQUE (invoice_id, line_order)
);

INSERT INTO invoice_lines (
  id,
  invoice_id,
  source_invoice_line_id,
  line_order,
  code,
  description,
  quantity_hundredths,
  unit,
  unit_price_cents,
  vat_rate_basis_points,
  discount_type,
  discount_value,
  base_cents,
  discount_cents,
  net_cents,
  vat_cents,
  gross_cents,
  created_at
)
SELECT
  id,
  invoice_id,
  NULL,
  line_order,
  code,
  description,
  quantity_hundredths,
  unit,
  unit_price_cents,
  vat_rate_basis_points,
  discount_type,
  discount_value,
  base_cents,
  discount_cents,
  net_cents,
  vat_cents,
  gross_cents,
  created_at
FROM invoice_lines_before_corrections;

CREATE TABLE invoice_audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'invoice.approved',
      'invoice.reopened_for_edit',
      'invoice.reapproved',
      'invoice.marked_sent_manually',
      'invoice.cancelled',
      'invoice.credit_draft_created',
      'invoice.credit_approved',
      'invoice.credit_reapproved'
    )
  ),
  draft_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
);

INSERT INTO invoice_audit_events
SELECT * FROM invoice_audit_events_before_corrections;

CREATE TABLE invoice_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('approved_invoice_pdf')),
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
  storage_path TEXT NOT NULL CHECK (length(trim(storage_path)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  UNIQUE (company_id, invoice_id, document_type)
);

INSERT INTO invoice_documents
SELECT * FROM invoice_documents_before_corrections;

CREATE TABLE invoice_delivery_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  document_id TEXT,
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('email', 'manual', 'print', 'other')),
  provider TEXT NOT NULL CHECK (provider IN ('dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other')),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown')),
  recipient_email TEXT NOT NULL DEFAULT '' CHECK (length(recipient_email) <= 320),
  cc_email TEXT NOT NULL DEFAULT '' CHECK (length(cc_email) <= 320),
  subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 200),
  body_preview TEXT NOT NULL DEFAULT '' CHECK (length(body_preview) <= 500),
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 500),
  safe_error_message TEXT CHECK (safe_error_message IS NULL OR length(safe_error_message) <= 500),
  technical_error_code TEXT CHECK (technical_error_code IS NULL OR length(technical_error_code) <= 120),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '' CHECK (length(created_by) <= 120),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id) REFERENCES invoice_documents (id) ON DELETE SET NULL
);

INSERT INTO invoice_delivery_events
SELECT * FROM invoice_delivery_events_before_corrections;

DROP TABLE invoice_delivery_events_before_corrections;
DROP TABLE invoice_documents_before_corrections;
DROP TABLE invoice_lines_before_corrections;
DROP TABLE invoice_audit_events_before_corrections;
DROP TABLE invoices_before_corrections;

ALTER TABLE invoice_drafts
  ADD COLUMN invoice_kind TEXT NOT NULL DEFAULT 'standard'
    CHECK (invoice_kind IN ('standard', 'credit'));

ALTER TABLE invoice_drafts
  ADD COLUMN credited_invoice_id TEXT
    REFERENCES invoices (id) ON DELETE RESTRICT;

ALTER TABLE invoice_draft_lines
  ADD COLUMN source_invoice_line_id TEXT
    REFERENCES invoice_lines (id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX invoice_drafts_company_active_credit_unique_index
  ON invoice_drafts (company_id, credited_invoice_id)
  WHERE (
    invoice_kind = 'credit'
    AND credited_invoice_id IS NOT NULL
    AND approved_invoice_id IS NULL
  );

CREATE INDEX invoice_drafts_company_credited_invoice_index
  ON invoice_drafts (company_id, credited_invoice_id);

CREATE INDEX invoice_draft_lines_source_invoice_line_index
  ON invoice_draft_lines (source_invoice_line_id);

CREATE INDEX invoices_company_approved_at_index
  ON invoices (company_id, approved_at);

CREATE UNIQUE INDEX invoices_company_reference_number_unique_index
  ON invoices (company_id, reference_number)
  WHERE reference_number IS NOT NULL;

CREATE INDEX invoices_company_status_invoice_date_id_index
  ON invoices (company_id, status, invoice_date DESC, id DESC);

CREATE INDEX invoices_company_credited_invoice_index
  ON invoices (company_id, credited_invoice_id, status);

CREATE INDEX invoice_lines_invoice_order_index
  ON invoice_lines (invoice_id, line_order);

CREATE INDEX invoice_lines_source_invoice_line_index
  ON invoice_lines (source_invoice_line_id);

CREATE INDEX invoice_audit_events_company_created_at_index
  ON invoice_audit_events (company_id, created_at);

CREATE INDEX invoice_documents_company_invoice_index
  ON invoice_documents (company_id, invoice_id);

CREATE INDEX invoice_delivery_events_company_invoice_created_index
  ON invoice_delivery_events (company_id, invoice_id, created_at);
