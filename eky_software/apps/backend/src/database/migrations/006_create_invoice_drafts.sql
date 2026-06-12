CREATE TABLE invoice_drafts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'draft'),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_term_days INTEGER NOT NULL CHECK (payment_term_days >= 0),
  price_input_mode TEXT NOT NULL CHECK (price_input_mode IN ('net', 'gross')),
  subject TEXT NOT NULL DEFAULT '',
  order_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  net_total_cents INTEGER NOT NULL CHECK (net_total_cents >= 0),
  vat_total_cents INTEGER NOT NULL CHECK (vat_total_cents >= 0),
  gross_total_cents INTEGER NOT NULL CHECK (gross_total_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX invoice_drafts_company_updated_at_index
  ON invoice_drafts (company_id, updated_at);

CREATE INDEX invoice_drafts_company_customer_index
  ON invoice_drafts (company_id, customer_id);

CREATE TABLE invoice_draft_lines (
  id TEXT PRIMARY KEY,
  invoice_draft_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
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
  FOREIGN KEY (invoice_draft_id) REFERENCES invoice_drafts (id) ON DELETE CASCADE,
  UNIQUE (invoice_draft_id, position)
);

CREATE INDEX invoice_draft_lines_draft_position_index
  ON invoice_draft_lines (invoice_draft_id, position);
