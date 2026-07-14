CREATE TABLE company_email_secret_audit_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'company_email_secret_set',
      'company_email_secret_removed'
    )
  ),
  occurred_at TEXT NOT NULL
);

CREATE INDEX company_email_secret_audit_events_company_occurred_at_index
  ON company_email_secret_audit_events (company_id, occurred_at);
