ALTER TABLE invoice_drafts
ADD COLUMN tax_treatment TEXT NOT NULL DEFAULT 'normalVat'
CHECK (
  tax_treatment IN ('normalVat', 'reverseChargeConstruction')
  AND (
    tax_treatment = 'normalVat'
    OR (
      price_input_mode = 'net'
      AND vat_total_cents = 0
      AND net_total_cents = gross_total_cents
    )
  )
);

ALTER TABLE invoice_drafts
ADD COLUMN performance_date TEXT;

ALTER TABLE invoice_drafts
ADD COLUMN performance_period_start TEXT;

ALTER TABLE invoice_drafts
ADD COLUMN performance_period_end TEXT
CHECK (
  (
    performance_date IS NULL
    AND performance_period_start IS NULL
    AND performance_period_end IS NULL
  )
  OR (
    performance_date IS NOT NULL
    AND date(performance_date) IS performance_date
    AND performance_period_start IS NULL
    AND performance_period_end IS NULL
  )
  OR (
    performance_date IS NULL
    AND performance_period_start IS NOT NULL
    AND date(performance_period_start) IS performance_period_start
    AND performance_period_end IS NOT NULL
    AND date(performance_period_end) IS performance_period_end
    AND performance_period_start <= performance_period_end
  )
);

ALTER TABLE invoices
ADD COLUMN tax_treatment TEXT NOT NULL DEFAULT 'normalVat'
CHECK (
  tax_treatment IN ('normalVat', 'reverseChargeConstruction')
  AND (
    tax_treatment = 'normalVat'
    OR (
      price_input_mode = 'net'
      AND total_vat_cents = 0
      AND total_net_cents = total_gross_cents
    )
  )
);

ALTER TABLE invoices
ADD COLUMN tax_treatment_label_snapshot TEXT NOT NULL DEFAULT ''
CHECK (
  (
    tax_treatment = 'normalVat'
    AND tax_treatment_label_snapshot = ''
  )
  OR (
    tax_treatment = 'reverseChargeConstruction'
    AND tax_treatment_label_snapshot = 'Käännetty verovelvollisuus'
  )
);

ALTER TABLE invoices
ADD COLUMN tax_legal_basis_snapshot TEXT NOT NULL DEFAULT ''
CHECK (
  (
    tax_treatment = 'normalVat'
    AND tax_legal_basis_snapshot = ''
  )
  OR (
    tax_treatment = 'reverseChargeConstruction'
    AND tax_legal_basis_snapshot = 'AVL 8 c §'
  )
);

ALTER TABLE invoices
ADD COLUMN performance_date TEXT;

ALTER TABLE invoices
ADD COLUMN performance_period_start TEXT;

ALTER TABLE invoices
ADD COLUMN performance_period_end TEXT
CHECK (
  (
    performance_date IS NULL
    AND performance_period_start IS NULL
    AND performance_period_end IS NULL
  )
  OR (
    performance_date IS NOT NULL
    AND date(performance_date) IS performance_date
    AND performance_period_start IS NULL
    AND performance_period_end IS NULL
  )
  OR (
    performance_date IS NULL
    AND performance_period_start IS NOT NULL
    AND date(performance_period_start) IS performance_period_start
    AND performance_period_end IS NOT NULL
    AND date(performance_period_end) IS performance_period_end
    AND performance_period_start <= performance_period_end
  )
);

DROP INDEX IF EXISTS invoice_draft_lines_draft_position_index;
DROP INDEX IF EXISTS invoice_draft_lines_source_invoice_line_index;
DROP INDEX IF EXISTS invoice_lines_invoice_order_index;
DROP INDEX IF EXISTS invoice_lines_source_invoice_line_index;

PRAGMA legacy_alter_table = ON;
PRAGMA defer_foreign_keys = ON;

ALTER TABLE invoice_draft_lines
RENAME TO invoice_draft_lines_before_tax_treatments;

ALTER TABLE invoice_lines
RENAME TO invoice_lines_before_tax_treatments;

PRAGMA legacy_alter_table = OFF;

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
  vat_rate_basis_points INTEGER CHECK (
    vat_rate_basis_points IS NULL OR vat_rate_basis_points >= 0
  ),
  discount_type TEXT NOT NULL CHECK (
    discount_type IN ('none', 'percentage', 'fixed')
  ),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  FOREIGN KEY (source_invoice_line_id) REFERENCES invoice_lines (id)
    ON DELETE RESTRICT,
  UNIQUE (invoice_id, line_order),
  CHECK (
    vat_rate_basis_points IS NOT NULL
    OR (vat_cents = 0 AND net_cents = gross_cents)
  )
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
FROM invoice_lines_before_tax_treatments;

CREATE TABLE invoice_draft_lines (
  id TEXT PRIMARY KEY,
  invoice_draft_id TEXT NOT NULL,
  source_invoice_line_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 1),
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  quantity_hundredths INTEGER NOT NULL CHECK (quantity_hundredths >= 0),
  unit TEXT NOT NULL CHECK (length(trim(unit)) > 0 AND length(trim(unit)) <= 8),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  vat_rate_basis_points INTEGER CHECK (
    vat_rate_basis_points IS NULL OR vat_rate_basis_points >= 0
  ),
  discount_type TEXT NOT NULL CHECK (
    discount_type IN ('none', 'percentage', 'fixed')
  ),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  FOREIGN KEY (invoice_draft_id) REFERENCES invoice_drafts (id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_invoice_line_id) REFERENCES invoice_lines (id)
    ON DELETE RESTRICT,
  UNIQUE (invoice_draft_id, position),
  CHECK (
    vat_rate_basis_points IS NOT NULL
    OR (vat_cents = 0 AND net_cents = gross_cents)
  )
);

INSERT INTO invoice_draft_lines (
  id,
  invoice_draft_id,
  source_invoice_line_id,
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
  source_invoice_line_id,
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
FROM invoice_draft_lines_before_tax_treatments;

DROP TABLE invoice_draft_lines_before_tax_treatments;
DROP TABLE invoice_lines_before_tax_treatments;

CREATE INDEX invoice_draft_lines_draft_position_index
  ON invoice_draft_lines (invoice_draft_id, position);

CREATE INDEX invoice_draft_lines_source_invoice_line_index
  ON invoice_draft_lines (source_invoice_line_id);

CREATE INDEX invoice_lines_invoice_order_index
  ON invoice_lines (invoice_id, line_order);

CREATE INDEX invoice_lines_source_invoice_line_index
  ON invoice_lines (source_invoice_line_id);

CREATE TRIGGER invoice_draft_lines_tax_treatment_insert_guard
BEFORE INSERT ON invoice_draft_lines
BEGIN
  SELECT CASE
    WHEN (
      SELECT tax_treatment
      FROM invoice_drafts
      WHERE id = NEW.invoice_draft_id
    ) = 'normalVat'
    AND NEW.vat_rate_basis_points IS NULL
    THEN RAISE(ABORT, 'normal VAT draft line requires a VAT rate')
    WHEN (
      SELECT tax_treatment
      FROM invoice_drafts
      WHERE id = NEW.invoice_draft_id
    ) = 'reverseChargeConstruction'
    AND NEW.vat_rate_basis_points IS NOT NULL
    THEN RAISE(ABORT, 'reverse charge draft line cannot contain a VAT rate')
  END;
END;

CREATE TRIGGER invoice_draft_lines_tax_treatment_update_guard
BEFORE UPDATE OF invoice_draft_id, vat_rate_basis_points
ON invoice_draft_lines
BEGIN
  SELECT CASE
    WHEN (
      SELECT tax_treatment
      FROM invoice_drafts
      WHERE id = NEW.invoice_draft_id
    ) = 'normalVat'
    AND NEW.vat_rate_basis_points IS NULL
    THEN RAISE(ABORT, 'normal VAT draft line requires a VAT rate')
    WHEN (
      SELECT tax_treatment
      FROM invoice_drafts
      WHERE id = NEW.invoice_draft_id
    ) = 'reverseChargeConstruction'
    AND NEW.vat_rate_basis_points IS NOT NULL
    THEN RAISE(ABORT, 'reverse charge draft line cannot contain a VAT rate')
  END;
END;

CREATE TRIGGER invoice_drafts_tax_treatment_update_guard
BEFORE UPDATE OF tax_treatment ON invoice_drafts
WHEN EXISTS (
  SELECT 1
  FROM invoice_draft_lines
  WHERE invoice_draft_id = NEW.id
    AND (
      (
        NEW.tax_treatment = 'normalVat'
        AND vat_rate_basis_points IS NULL
      )
      OR (
        NEW.tax_treatment = 'reverseChargeConstruction'
        AND vat_rate_basis_points IS NOT NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invoice draft lines do not match tax treatment');
END;

CREATE TRIGGER invoice_lines_tax_treatment_insert_guard
BEFORE INSERT ON invoice_lines
BEGIN
  SELECT CASE
    WHEN (
      SELECT tax_treatment
      FROM invoices
      WHERE id = NEW.invoice_id
    ) = 'normalVat'
    AND NEW.vat_rate_basis_points IS NULL
    THEN RAISE(ABORT, 'normal VAT invoice line requires a VAT rate')
    WHEN (
      SELECT tax_treatment
      FROM invoices
      WHERE id = NEW.invoice_id
    ) = 'reverseChargeConstruction'
    AND NEW.vat_rate_basis_points IS NOT NULL
    THEN RAISE(ABORT, 'reverse charge invoice line cannot contain a VAT rate')
  END;
END;

CREATE TRIGGER invoice_lines_tax_treatment_update_guard
BEFORE UPDATE OF invoice_id, vat_rate_basis_points
ON invoice_lines
BEGIN
  SELECT CASE
    WHEN (
      SELECT tax_treatment
      FROM invoices
      WHERE id = NEW.invoice_id
    ) = 'normalVat'
    AND NEW.vat_rate_basis_points IS NULL
    THEN RAISE(ABORT, 'normal VAT invoice line requires a VAT rate')
    WHEN (
      SELECT tax_treatment
      FROM invoices
      WHERE id = NEW.invoice_id
    ) = 'reverseChargeConstruction'
    AND NEW.vat_rate_basis_points IS NOT NULL
    THEN RAISE(ABORT, 'reverse charge invoice line cannot contain a VAT rate')
  END;
END;

CREATE TRIGGER invoices_tax_treatment_update_guard
BEFORE UPDATE OF tax_treatment ON invoices
WHEN EXISTS (
  SELECT 1
  FROM invoice_lines
  WHERE invoice_id = NEW.id
    AND (
      (
        NEW.tax_treatment = 'normalVat'
        AND vat_rate_basis_points IS NULL
      )
      OR (
        NEW.tax_treatment = 'reverseChargeConstruction'
        AND vat_rate_basis_points IS NOT NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invoice lines do not match tax treatment');
END;
