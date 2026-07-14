DROP INDEX company_email_secret_audit_events_company_occurred_at_index;

ALTER TABLE company_email_secret_audit_events
  RENAME TO company_email_secret_audit_events_legacy;

CREATE TABLE company_email_secret_audit_events (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL CHECK (event_sequence IN (1, 2)),
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('set', 'remove')),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('requested', 'succeeded', 'failed')
  ),
  occurred_at TEXT NOT NULL,
  UNIQUE (operation_id, event_sequence),
  CHECK (
    (event_sequence = 1 AND outcome = 'requested') OR
    (event_sequence = 2 AND outcome IN ('succeeded', 'failed'))
  )
);

INSERT INTO company_email_secret_audit_events (
  id,
  operation_id,
  event_sequence,
  company_id,
  actor_id,
  action,
  outcome,
  occurred_at
)
SELECT
  id,
  id,
  2,
  company_id,
  actor_id,
  CASE event_type
    WHEN 'company_email_secret_set' THEN 'set'
    ELSE 'remove'
  END,
  'succeeded',
  occurred_at
FROM company_email_secret_audit_events_legacy;

DROP TABLE company_email_secret_audit_events_legacy;

CREATE INDEX company_email_secret_audit_events_company_occurred_at_index
  ON company_email_secret_audit_events (company_id, occurred_at);

CREATE INDEX company_email_secret_audit_events_operation_index
  ON company_email_secret_audit_events (operation_id, event_sequence);
