CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL DEFAULT '',
  business_id TEXT NOT NULL DEFAULT '',
  street_address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  default_hourly_rate_cents INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
