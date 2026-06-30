ALTER TABLE invoice_drafts
  ADD COLUMN billing_recipient_customer_id TEXT;

ALTER TABLE invoice_drafts
  ADD COLUMN delivery_address_text TEXT NOT NULL DEFAULT '';

ALTER TABLE invoice_drafts
  ADD COLUMN reminder_period_days INTEGER NOT NULL DEFAULT 0
    CHECK (
      reminder_period_days >= 0
      AND reminder_period_days <= 365
    );
