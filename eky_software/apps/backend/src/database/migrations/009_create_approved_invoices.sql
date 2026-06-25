ALTER TABLE invoice_drafts
  ADD COLUMN approved_invoice_id TEXT;

ALTER TABLE invoice_drafts
  ADD COLUMN approved_at TEXT;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source_draft_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  series_key TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  numbering_mode TEXT NOT NULL CHECK (numbering_mode IN ('fiscalYearSequence', 'calendarYearSequence', 'plainSequence')),
  status TEXT NOT NULL CHECK (status = 'approved'),
  customer_id TEXT NOT NULL,
  customer_number_snapshot TEXT NOT NULL DEFAULT '',
  customer_name_snapshot TEXT NOT NULL DEFAULT '',
  customer_business_id_snapshot TEXT NOT NULL DEFAULT '',
  customer_type_snapshot TEXT NOT NULL DEFAULT '',
  company_name_snapshot TEXT NOT NULL DEFAULT '',
  company_business_id_snapshot TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_term_days INTEGER NOT NULL CHECK (payment_term_days >= 0),
  price_input_mode TEXT NOT NULL CHECK (price_input_mode IN ('net', 'gross')),
  subject TEXT NOT NULL DEFAULT '',
  order_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
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

CREATE INDEX invoices_company_approved_at_index
  ON invoices (company_id, approved_at);

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

CREATE INDEX invoice_lines_invoice_order_index
  ON invoice_lines (invoice_id, line_order);

CREATE TABLE invoice_audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'invoice.approved'),
  draft_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
);

CREATE INDEX invoice_audit_events_company_created_at_index
  ON invoice_audit_events (company_id, created_at);
