ALTER TABLE invoice_drafts
ADD COLUMN refund_iban TEXT NOT NULL DEFAULT ''
CHECK (length(refund_iban) <= 34);

ALTER TABLE invoices
ADD COLUMN refund_iban_snapshot TEXT NOT NULL DEFAULT ''
CHECK (length(refund_iban_snapshot) <= 34);
