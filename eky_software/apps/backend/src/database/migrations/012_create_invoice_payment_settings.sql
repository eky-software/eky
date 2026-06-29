CREATE TABLE invoice_payment_settings (
  company_id TEXT PRIMARY KEY NOT NULL,
  default_late_payment_interest_basis_points INTEGER NOT NULL
    CHECK (default_late_payment_interest_basis_points >= 0 AND default_late_payment_interest_basis_points <= 100000),
  default_reminder_period_days INTEGER NOT NULL
    CHECK (default_reminder_period_days >= 0 AND default_reminder_period_days <= 365),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
