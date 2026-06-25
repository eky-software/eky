CREATE TABLE invoice_numbering_settings (
  company_id TEXT NOT NULL,
  series_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fiscalYearSequence', 'calendarYearSequence', 'plainSequence')),
  fiscal_year_start_month INTEGER NOT NULL CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  sequence_padding INTEGER NOT NULL CHECK (sequence_padding >= 0 AND sequence_padding <= 12),
  first_sequence_number INTEGER NOT NULL CHECK (first_sequence_number >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, series_key)
);

CREATE TABLE invoice_number_sequences (
  company_id TEXT NOT NULL,
  series_key TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  last_sequence_number INTEGER NOT NULL CHECK (last_sequence_number >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, series_key, sequence_scope),
  FOREIGN KEY (company_id, series_key)
    REFERENCES invoice_numbering_settings (company_id, series_key)
    ON DELETE RESTRICT
);

CREATE INDEX invoice_number_sequences_company_series_index
  ON invoice_number_sequences (company_id, series_key);
