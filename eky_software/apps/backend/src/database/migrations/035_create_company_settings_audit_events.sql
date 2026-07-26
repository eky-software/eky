CREATE TABLE company_settings_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  company_id TEXT NOT NULL CHECK (length(company_id) BETWEEN 1 AND 200),
  actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK (action = 'companySettings.updated'),
  changed_field_categories TEXT NOT NULL CHECK (
    length(changed_field_categories) BETWEEN 2 AND 200
  ),
  outcome TEXT NOT NULL CHECK (outcome = 'success'),
  occurred_at TEXT NOT NULL CHECK (length(occurred_at) BETWEEN 20 AND 40)
);

CREATE INDEX company_settings_audit_events_company_occurred_at_index
  ON company_settings_audit_events (company_id, occurred_at DESC, id DESC);
