ALTER TABLE company_settings
  ADD COLUMN email_delivery_provider TEXT NOT NULL DEFAULT 'dryRun'
  CHECK (email_delivery_provider IN ('dryRun', 'smtp'));

ALTER TABLE company_settings
  ADD COLUMN email_sender_name TEXT NOT NULL DEFAULT ''
  CHECK (length(email_sender_name) <= 200);

ALTER TABLE company_settings
  ADD COLUMN email_sender_address TEXT NOT NULL DEFAULT ''
  CHECK (length(email_sender_address) <= 320);

ALTER TABLE company_settings
  ADD COLUMN email_smtp_host TEXT NOT NULL DEFAULT ''
  CHECK (length(email_smtp_host) <= 253);

ALTER TABLE company_settings
  ADD COLUMN email_smtp_port INTEGER
  CHECK (email_smtp_port IS NULL OR (email_smtp_port >= 1 AND email_smtp_port <= 65535));

ALTER TABLE company_settings
  ADD COLUMN email_smtp_security TEXT NOT NULL DEFAULT 'starttls'
  CHECK (email_smtp_security IN ('tls', 'starttls'));

ALTER TABLE company_settings
  ADD COLUMN email_username TEXT NOT NULL DEFAULT ''
  CHECK (length(email_username) <= 320);

ALTER TABLE company_settings
  ADD COLUMN email_test_recipient_override TEXT NOT NULL DEFAULT ''
  CHECK (length(email_test_recipient_override) <= 320);
