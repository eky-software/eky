DROP INDEX company_email_secret_audit_events_company_occurred_at_index;
DROP INDEX company_email_secret_audit_events_operation_index;

ALTER TABLE company_email_secret_audit_events
  RENAME TO company_email_secret_audit_events_legacy;

CREATE TABLE company_email_secret_audit_events (
  operation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('set', 'remove')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT CHECK (
    failure_code IS NULL OR
    (length(failure_code) BETWEEN 1 AND 100)
  ),
  CHECK (
    (status = 'pending' AND completed_at IS NULL AND failure_code IS NULL) OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND failure_code IS NULL) OR
    (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

INSERT INTO company_email_secret_audit_events (
  operation_id,
  company_id,
  actor_id,
  action,
  status,
  started_at,
  completed_at,
  failure_code
)
SELECT
  requested.operation_id,
  requested.company_id,
  requested.actor_id,
  requested.action,
  CASE completed.outcome
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  requested.occurred_at,
  completed.occurred_at,
  CASE completed.outcome
    WHEN 'failed' THEN 'LEGACY_SECRET_OPERATION_FAILED'
    ELSE NULL
  END
FROM company_email_secret_audit_events_legacy AS requested
LEFT JOIN company_email_secret_audit_events_legacy AS completed
  ON completed.operation_id = requested.operation_id
  AND completed.event_sequence = 2
WHERE requested.event_sequence = 1;

INSERT OR IGNORE INTO company_email_secret_audit_events (
  operation_id,
  company_id,
  actor_id,
  action,
  status,
  started_at,
  completed_at,
  failure_code
)
SELECT
  operation_id,
  company_id,
  actor_id,
  action,
  outcome,
  occurred_at,
  occurred_at,
  CASE outcome
    WHEN 'failed' THEN 'LEGACY_SECRET_OPERATION_FAILED'
    ELSE NULL
  END
FROM company_email_secret_audit_events_legacy
WHERE event_sequence = 2;

DROP TABLE company_email_secret_audit_events_legacy;

CREATE INDEX company_email_secret_audit_events_company_started_at_index
  ON company_email_secret_audit_events (company_id, started_at);

CREATE INDEX company_email_secret_audit_events_status_started_at_index
  ON company_email_secret_audit_events (status, started_at);
