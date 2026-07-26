CREATE TABLE customer_audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  company_id TEXT NOT NULL CHECK (length(company_id) BETWEEN 1 AND 200),
  actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 200),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK (
    action IN (
      'customer.created',
      'customer.updated',
      'customer.activated',
      'customer.deactivated'
    )
  ),
  changed_field_categories TEXT NOT NULL CHECK (
    length(changed_field_categories) BETWEEN 2 AND 200
  ),
  outcome TEXT NOT NULL CHECK (outcome = 'success'),
  occurred_at TEXT NOT NULL CHECK (length(occurred_at) BETWEEN 20 AND 40)
);

CREATE INDEX customer_audit_events_company_occurred_at_index
  ON customer_audit_events (company_id, occurred_at DESC, id DESC);

CREATE INDEX customer_audit_events_customer_occurred_at_index
  ON customer_audit_events (company_id, customer_id, occurred_at DESC);
