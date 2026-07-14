CREATE TABLE local_runtime_identity (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'local-runtime'),
  installation_id TEXT NOT NULL UNIQUE CHECK (length(installation_id) = 32),
  company_id TEXT NOT NULL CHECK (length(trim(company_id)) > 0),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  created_at TEXT NOT NULL
);

CREATE TEMP TABLE local_runtime_identity_company_count_guard (
  company_count INTEGER NOT NULL CHECK (company_count <= 1)
);

INSERT INTO local_runtime_identity_company_count_guard (company_count)
WITH existing_company_ids AS (
  SELECT company_id FROM company_settings
  UNION
  SELECT company_id FROM customers
  UNION
  SELECT company_id FROM invoice_drafts
  UNION
  SELECT company_id FROM invoice_numbering_settings
  UNION
  SELECT company_id FROM invoice_number_sequences
  UNION
  SELECT company_id FROM invoice_payment_settings
  UNION
  SELECT company_id FROM invoices
  UNION
  SELECT company_id FROM invoice_audit_events
  UNION
  SELECT company_id FROM invoice_documents
  UNION
  SELECT company_id FROM invoice_delivery_events
  UNION
  SELECT company_id FROM company_email_secret_audit_events
)
SELECT count(*) FROM existing_company_ids;

DROP TABLE local_runtime_identity_company_count_guard;

INSERT INTO local_runtime_identity (
  singleton_key,
  installation_id,
  company_id,
  actor_id,
  created_at
)
WITH existing_company_ids AS (
  SELECT company_id FROM company_settings
  UNION
  SELECT company_id FROM customers
  UNION
  SELECT company_id FROM invoice_drafts
  UNION
  SELECT company_id FROM invoice_numbering_settings
  UNION
  SELECT company_id FROM invoice_number_sequences
  UNION
  SELECT company_id FROM invoice_payment_settings
  UNION
  SELECT company_id FROM invoices
  UNION
  SELECT company_id FROM invoice_audit_events
  UNION
  SELECT company_id FROM invoice_documents
  UNION
  SELECT company_id FROM invoice_delivery_events
  UNION
  SELECT company_id FROM company_email_secret_audit_events
)
SELECT
  'local-runtime',
  lower(hex(randomblob(16))),
  coalesce(
    (
      SELECT company_id
      FROM existing_company_ids
      ORDER BY company_id
      LIMIT 1
    ),
    'local-company-' || lower(hex(randomblob(16)))
  ),
  'local-owner',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
