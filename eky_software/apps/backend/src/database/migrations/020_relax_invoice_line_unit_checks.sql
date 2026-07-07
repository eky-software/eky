ALTER TABLE invoice_draft_lines RENAME TO invoice_draft_lines_old;
ALTER TABLE invoice_lines RENAME TO invoice_lines_old;

DROP INDEX IF EXISTS invoice_draft_lines_draft_position_index;
DROP INDEX IF EXISTS invoice_lines_invoice_order_index;

CREATE TABLE invoice_draft_lines (
  id TEXT PRIMARY KEY,
  invoice_draft_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
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
  FOREIGN KEY (invoice_draft_id) REFERENCES invoice_drafts (id) ON DELETE CASCADE,
  UNIQUE (invoice_draft_id, position)
);

INSERT INTO invoice_draft_lines (
  id,
  invoice_draft_id,
  position,
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
  gross_cents
)
SELECT
  id,
  invoice_draft_id,
  position,
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
  gross_cents
FROM invoice_draft_lines_old;

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
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
  UNIQUE (invoice_id, line_order)
);

INSERT INTO invoice_lines (
  id,
  invoice_id,
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
FROM invoice_lines_old;

DROP TABLE invoice_draft_lines_old;
DROP TABLE invoice_lines_old;

CREATE INDEX invoice_draft_lines_draft_position_index
  ON invoice_draft_lines (invoice_draft_id, position);

CREATE INDEX invoice_lines_invoice_order_index
  ON invoice_lines (invoice_id, line_order);
