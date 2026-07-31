ALTER TABLE invoices
ADD COLUMN payment_state TEXT NOT NULL DEFAULT 'unpaid'
CHECK (payment_state IN ('unpaid', 'paid'));

ALTER TABLE invoices
ADD COLUMN paid_on TEXT
CHECK (paid_on IS NULL OR date(paid_on) IS paid_on);

ALTER TABLE invoices
ADD COLUMN paid_amount_cents INTEGER
CHECK (paid_amount_cents IS NULL OR paid_amount_cents > 0);

ALTER TABLE invoices
ADD COLUMN payment_source TEXT
CHECK (payment_source IS NULL OR payment_source = 'manual');

ALTER TABLE invoices
ADD COLUMN payment_recorded_at TEXT;

ALTER TABLE invoices
ADD COLUMN payment_recorded_by TEXT
CHECK (
  (
    payment_state = 'unpaid'
    AND paid_on IS NULL
    AND paid_amount_cents IS NULL
    AND payment_source IS NULL
    AND payment_recorded_at IS NULL
    AND payment_recorded_by IS NULL
  )
  OR (
    payment_state = 'paid'
    AND paid_on IS NOT NULL
    AND date(paid_on) IS paid_on
    AND paid_amount_cents IS NOT NULL
    AND paid_amount_cents > 0
    AND payment_source = 'manual'
    AND payment_recorded_at IS NOT NULL
    AND length(trim(payment_recorded_at)) > 0
    AND payment_recorded_by IS NOT NULL
    AND length(trim(payment_recorded_by)) > 0
    AND length(payment_recorded_by) <= 200
  )
);

CREATE TABLE invoice_payment_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL
    CHECK (
      length(trim(actor_user_id)) > 0
      AND length(actor_user_id) <= 200
    ),
  action TEXT NOT NULL
    CHECK (action IN ('paymentMarkedPaid', 'paymentMarkReverted')),
  payment_source TEXT NOT NULL CHECK (payment_source = 'manual'),
  paid_on TEXT NOT NULL CHECK (date(paid_on) IS paid_on),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
);

CREATE INDEX invoice_payment_events_company_invoice_occurred_index
ON invoice_payment_events (company_id, invoice_id, occurred_at DESC, id DESC);

CREATE INDEX invoice_payment_events_company_occurred_index
ON invoice_payment_events (company_id, occurred_at DESC, id DESC);

CREATE INDEX invoices_company_status_payment_date_index
ON invoices (
  company_id,
  status,
  payment_state,
  invoice_date DESC,
  id DESC
);

CREATE INDEX invoices_company_customer_status_payment_date_index
ON invoices (
  company_id,
  customer_id,
  status,
  payment_state,
  invoice_date DESC,
  id DESC
);

CREATE TRIGGER invoice_payment_events_prevent_update
BEFORE UPDATE ON invoice_payment_events
BEGIN
  SELECT RAISE(ABORT, 'invoice payment events are append-only');
END;

CREATE TRIGGER invoice_payment_events_prevent_delete
BEFORE DELETE ON invoice_payment_events
BEGIN
  SELECT RAISE(ABORT, 'invoice payment events are append-only');
END;
