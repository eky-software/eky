CREATE INDEX IF NOT EXISTS invoices_company_status_invoice_date_id_index
  ON invoices (company_id, status, invoice_date DESC, id DESC);
