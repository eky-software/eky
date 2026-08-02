CREATE TABLE invoice_numbering_active_series (
  company_id TEXT PRIMARY KEY,
  active_series_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (company_id, active_series_key)
    REFERENCES invoice_numbering_settings (company_id, series_key)
    ON DELETE RESTRICT
);

INSERT INTO invoice_numbering_active_series (
  company_id,
  active_series_key,
  revision,
  updated_at,
  updated_by
)
SELECT
  company_id,
  series_key,
  1,
  updated_at,
  'migration'
FROM invoice_numbering_settings
WHERE series_key = 'default';

CREATE TABLE invoice_numbering_series_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_series_key TEXT NOT NULL,
  next_series_key TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'legalRequirement',
      'accountingRequirement',
      'organizationalChange',
      'other'
    )
  ),
  reason_note TEXT CHECK (
    reason_note IS NULL OR length(reason_note) BETWEEN 1 AND 500
  ),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (company_id, previous_series_key)
    REFERENCES invoice_numbering_settings (company_id, series_key)
    ON DELETE RESTRICT,
  FOREIGN KEY (company_id, next_series_key)
    REFERENCES invoice_numbering_settings (company_id, series_key)
    ON DELETE RESTRICT
);

CREATE INDEX invoice_numbering_series_events_company_occurred_index
  ON invoice_numbering_series_events (company_id, occurred_at DESC, id DESC);

CREATE TRIGGER invoice_numbering_series_events_no_update
BEFORE UPDATE ON invoice_numbering_series_events
BEGIN
  SELECT RAISE(ABORT, 'Invoice numbering series events are append-only.');
END;

CREATE TRIGGER invoice_numbering_series_events_no_delete
BEFORE DELETE ON invoice_numbering_series_events
BEGIN
  SELECT RAISE(ABORT, 'Invoice numbering series events are append-only.');
END;

CREATE TRIGGER invoice_numbering_active_series_no_delete
BEFORE DELETE ON invoice_numbering_active_series
BEGIN
  SELECT RAISE(ABORT, 'Active invoice numbering series cannot be deleted.');
END;

CREATE TRIGGER invoice_numbering_settings_immutable_update
BEFORE UPDATE ON invoice_numbering_settings
WHEN
  EXISTS (
    SELECT 1
    FROM invoice_number_sequences
    WHERE
      company_id = OLD.company_id
      AND series_key = OLD.series_key
  )
  OR EXISTS (
    SELECT 1
    FROM invoices
    WHERE
      company_id = OLD.company_id
      AND series_key = OLD.series_key
  )
  OR EXISTS (
    SELECT 1
    FROM invoice_numbering_series_events
    WHERE
      company_id = OLD.company_id
      AND (
        previous_series_key = OLD.series_key
        OR next_series_key = OLD.series_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'Used invoice numbering settings are immutable.');
END;

CREATE TRIGGER invoice_numbering_settings_immutable_delete
BEFORE DELETE ON invoice_numbering_settings
WHEN
  EXISTS (
    SELECT 1
    FROM invoice_number_sequences
    WHERE
      company_id = OLD.company_id
      AND series_key = OLD.series_key
  )
  OR EXISTS (
    SELECT 1
    FROM invoices
    WHERE
      company_id = OLD.company_id
      AND series_key = OLD.series_key
  )
  OR EXISTS (
    SELECT 1
    FROM invoice_numbering_series_events
    WHERE
      company_id = OLD.company_id
      AND (
        previous_series_key = OLD.series_key
        OR next_series_key = OLD.series_key
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'Used invoice numbering settings are immutable.');
END;
