ALTER TABLE invoice_delivery_events RENAME TO invoice_delivery_events_before_outcome_unknown;

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
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
  FOREIGN KEY (document_id) REFERENCES invoice_documents(id) ON DELETE SET NULL
);

INSERT INTO invoice_delivery_events (
  id,
  company_id,
  invoice_id,
  document_id,
  delivery_method,
  provider,
  status,
  recipient_email,
  cc_email,
  subject,
  body_preview,
  provider_message_id,
  safe_error_message,
  technical_error_code,
  created_at,
  created_by
)
SELECT
  id,
  company_id,
  invoice_id,
  document_id,
  delivery_method,
  provider,
  status,
  recipient_email,
  cc_email,
  subject,
  body_preview,
  provider_message_id,
  safe_error_message,
  technical_error_code,
  created_at,
  created_by
FROM invoice_delivery_events_before_outcome_unknown;

DROP TABLE invoice_delivery_events_before_outcome_unknown;

CREATE INDEX invoice_delivery_events_company_invoice_created_index
  ON invoice_delivery_events (company_id, invoice_id, created_at);
