CREATE TABLE invoice_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('approved_invoice_pdf')),
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
  storage_path TEXT NOT NULL CHECK (length(trim(storage_path)) > 0),
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
  UNIQUE (company_id, invoice_id, document_type)
);

CREATE INDEX invoice_documents_company_invoice_index
  ON invoice_documents (company_id, invoice_id);
