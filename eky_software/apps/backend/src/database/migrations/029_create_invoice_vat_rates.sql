CREATE TABLE invoice_vat_rates (
  company_id TEXT NOT NULL,
  rate_basis_points INTEGER NOT NULL CHECK (
    rate_basis_points >= 0 AND rate_basis_points <= 10000
  ),
  label TEXT NOT NULL CHECK (
    length(label) >= 1 AND length(label) <= 50
  ),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (
    sort_order >= 0 AND sort_order <= 1000
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, rate_basis_points)
);

CREATE UNIQUE INDEX invoice_vat_rates_one_default_per_company
ON invoice_vat_rates (company_id)
WHERE is_default = 1;
