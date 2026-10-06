-- Invoicing content history is published atomically: children first, header last.
CREATE UNIQUE INDEX invoices_company_id_key ON invoices(company_id, id);
CREATE TABLE invoice_content_revisions (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) > 0),
  company_id TEXT NOT NULL CHECK(length(company_id) > 0),
  invoice_id TEXT NOT NULL CHECK(length(invoice_id) > 0),
  origin TEXT NOT NULL CHECK(origin IN ('approval','legacySnapshot','validatedLegacySnapshot')),
  vat_breakdown_state TEXT NOT NULL CHECK(vat_breakdown_state IN ('authoritative','unavailable')),
  source_draft_id TEXT NOT NULL,
  invoice_kind TEXT NOT NULL CHECK(invoice_kind IN ('standard','credit')),
  credited_invoice_id TEXT,
  credited_revision_id TEXT,
  credited_invoice_number_snapshot TEXT,
  credited_invoice_date_snapshot TEXT,
  invoice_number TEXT NOT NULL,
  reference_number TEXT,
  reference_number_type TEXT,
  series_key TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK(typeof(sequence_number) = 'integer' AND sequence_number BETWEEN 1 AND 9007199254740991),
  numbering_mode TEXT NOT NULL CHECK(numbering_mode IN ('fiscalYearSequence','calendarYearSequence','plainSequence')),
  customer_id TEXT NOT NULL,
  customer_number_snapshot TEXT NOT NULL,
  customer_name_snapshot TEXT NOT NULL,
  customer_business_id_snapshot TEXT NOT NULL,
  customer_type_snapshot TEXT NOT NULL,
  customer_email_snapshot TEXT NOT NULL,
  customer_phone_snapshot TEXT NOT NULL,
  customer_street_address_snapshot TEXT NOT NULL,
  customer_postal_code_snapshot TEXT NOT NULL,
  customer_city_snapshot TEXT NOT NULL,
  company_name_snapshot TEXT NOT NULL,
  company_business_id_snapshot TEXT NOT NULL,
  company_vat_number_snapshot TEXT NOT NULL,
  company_street_address_snapshot TEXT NOT NULL,
  company_postal_code_snapshot TEXT NOT NULL,
  company_city_snapshot TEXT NOT NULL,
  company_email_snapshot TEXT NOT NULL,
  company_phone_snapshot TEXT NOT NULL,
  company_website_snapshot TEXT NOT NULL,
  company_iban_snapshot TEXT NOT NULL,
  company_bic_snapshot TEXT NOT NULL,
  company_bank_name_snapshot TEXT NOT NULL,
  billing_recipient_customer_id TEXT,
  billing_recipient_customer_number_snapshot TEXT NOT NULL,
  billing_recipient_name_snapshot TEXT NOT NULL,
  billing_recipient_business_id_snapshot TEXT NOT NULL,
  billing_recipient_customer_type_snapshot TEXT NOT NULL,
  billing_recipient_email_snapshot TEXT NOT NULL,
  billing_recipient_phone_snapshot TEXT NOT NULL,
  billing_recipient_street_address_snapshot TEXT NOT NULL,
  billing_recipient_postal_code_snapshot TEXT NOT NULL,
  billing_recipient_city_snapshot TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_term_days INTEGER NOT NULL CHECK(typeof(payment_term_days) = 'integer' AND payment_term_days BETWEEN 0 AND 9007199254740991),
  reminder_period_days INTEGER NOT NULL CHECK(typeof(reminder_period_days) = 'integer' AND reminder_period_days BETWEEN 0 AND 365),
  late_payment_interest_basis_points INTEGER NOT NULL CHECK(typeof(late_payment_interest_basis_points) = 'integer' AND late_payment_interest_basis_points BETWEEN 0 AND 100000),
  price_input_mode TEXT NOT NULL CHECK(price_input_mode IN ('net','gross')),
  subject TEXT NOT NULL,
  order_number TEXT NOT NULL,
  note TEXT NOT NULL,
  delivery_address_text TEXT NOT NULL,
  refund_iban_snapshot TEXT NOT NULL,
  tax_treatment TEXT NOT NULL CHECK(tax_treatment IN ('normalVat','reverseChargeConstruction')),
  tax_treatment_label_snapshot TEXT NOT NULL,
  tax_legal_basis_snapshot TEXT NOT NULL,
  performance_date TEXT,
  performance_period_start TEXT,
  performance_period_end TEXT,
  total_net_cents INTEGER NOT NULL CHECK(typeof(total_net_cents) = 'integer' AND total_net_cents BETWEEN 0 AND 9007199254740991),
  total_vat_cents INTEGER NOT NULL CHECK(typeof(total_vat_cents) = 'integer' AND total_vat_cents BETWEEN 0 AND 9007199254740991),
  total_gross_cents INTEGER NOT NULL CHECK(typeof(total_gross_cents) = 'integer' AND total_gross_cents BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  UNIQUE(company_id, invoice_id, id),
  UNIQUE(company_id, invoice_id, id, invoice_number, invoice_date),
  CHECK((origin = 'legacySnapshot' AND vat_breakdown_state = 'unavailable') OR
    (origin <> 'legacySnapshot' AND vat_breakdown_state = 'authoritative')),
  CHECK((invoice_kind = 'standard' AND credited_invoice_id IS NULL AND credited_revision_id IS NULL
      AND credited_invoice_number_snapshot IS NULL AND credited_invoice_date_snapshot IS NULL) OR
    (invoice_kind = 'credit' AND credited_invoice_id IS NOT NULL AND credited_invoice_id <> invoice_id
      AND credited_revision_id IS NOT NULL AND credited_invoice_number_snapshot IS NOT NULL
      AND credited_invoice_date_snapshot IS NOT NULL)),
  CHECK((reference_number IS NULL AND reference_number_type IS NULL) OR
    (reference_number IS NOT NULL AND reference_number_type IS NOT NULL AND reference_number_type = 'finnishDomestic')),
  CHECK((performance_date IS NULL AND performance_period_start IS NULL AND performance_period_end IS NULL) OR
    (performance_date IS NOT NULL AND date(performance_date) IS performance_date AND performance_period_start IS NULL AND performance_period_end IS NULL) OR
    (performance_date IS NULL AND performance_period_start IS NOT NULL AND performance_period_end IS NOT NULL
      AND date(performance_period_start) IS performance_period_start AND date(performance_period_end) IS performance_period_end
      AND performance_period_start <= performance_period_end)),
  CHECK(origin = 'legacySnapshot' OR total_gross_cents = total_net_cents + total_vat_cents),
  CHECK((tax_treatment = 'normalVat' AND tax_treatment_label_snapshot = '' AND tax_legal_basis_snapshot = '') OR
    (tax_treatment = 'reverseChargeConstruction' AND price_input_mode = 'net'
      AND total_vat_cents = 0 AND total_net_cents = total_gross_cents
      AND tax_treatment_label_snapshot = 'Käännetty verovelvollisuus' AND tax_legal_basis_snapshot = 'AVL 8 c §')),
  FOREIGN KEY(company_id, invoice_id) REFERENCES invoices(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, credited_invoice_id, credited_revision_id, credited_invoice_number_snapshot, credited_invoice_date_snapshot)
    REFERENCES invoice_content_revisions(company_id, invoice_id, id, invoice_number, invoice_date) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE invoice_revision_lines (
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  line_id TEXT NOT NULL CHECK(length(line_id) > 0),
  source_invoice_line_id TEXT,
  source_revision_id TEXT,
  line_order INTEGER NOT NULL CHECK(typeof(line_order) = 'integer' AND line_order BETWEEN 1 AND 9007199254740991),
  code TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  quantity_hundredths INTEGER NOT NULL CHECK(typeof(quantity_hundredths) = 'integer' AND quantity_hundredths BETWEEN 0 AND 9007199254740991),
  unit TEXT NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 8),
  unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents) = 'integer' AND unit_price_cents BETWEEN 0 AND 9007199254740991),
  vat_rate_basis_points INTEGER CHECK(vat_rate_basis_points IS NULL OR (typeof(vat_rate_basis_points) = 'integer' AND vat_rate_basis_points BETWEEN 0 AND 9007199254740991)),
  discount_type TEXT NOT NULL CHECK(discount_type IN ('none','percentage','fixed')),
  discount_value INTEGER NOT NULL CHECK(typeof(discount_value) = 'integer' AND discount_value BETWEEN 0 AND 9007199254740991),
  base_cents INTEGER NOT NULL CHECK(typeof(base_cents) = 'integer' AND base_cents BETWEEN 0 AND 9007199254740991),
  discount_cents INTEGER NOT NULL CHECK(typeof(discount_cents) = 'integer' AND discount_cents BETWEEN 0 AND 9007199254740991),
  net_cents INTEGER NOT NULL CHECK(typeof(net_cents) = 'integer' AND net_cents BETWEEN 0 AND 9007199254740991),
  vat_cents INTEGER NOT NULL CHECK(typeof(vat_cents) = 'integer' AND vat_cents BETWEEN 0 AND 9007199254740991),
  gross_cents INTEGER NOT NULL CHECK(typeof(gross_cents) = 'integer' AND gross_cents BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL,
  PRIMARY KEY(revision_id, line_id),
  UNIQUE(revision_id, line_order),
  UNIQUE(company_id, revision_id, line_id),
  CHECK((source_invoice_line_id IS NULL AND source_revision_id IS NULL) OR
    (source_invoice_line_id IS NOT NULL AND source_revision_id IS NOT NULL)),
  FOREIGN KEY(company_id, invoice_id, revision_id)
    REFERENCES invoice_content_revisions(company_id, invoice_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(company_id, source_revision_id, source_invoice_line_id)
    REFERENCES invoice_revision_lines(company_id, revision_id, line_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) WITHOUT ROWID;
CREATE TABLE invoice_revision_vat_breakdown (
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  vat_rate_basis_points INTEGER NOT NULL CHECK(typeof(vat_rate_basis_points) = 'integer' AND vat_rate_basis_points BETWEEN 0 AND 9007199254740991),
  net_cents INTEGER NOT NULL CHECK(typeof(net_cents) = 'integer' AND net_cents BETWEEN 0 AND 9007199254740991),
  vat_cents INTEGER NOT NULL CHECK(typeof(vat_cents) = 'integer' AND vat_cents BETWEEN 0 AND 9007199254740991),
  gross_cents INTEGER NOT NULL CHECK(typeof(gross_cents) = 'integer' AND gross_cents BETWEEN 0 AND 9007199254740991),
  CHECK(gross_cents = net_cents + vat_cents),
  PRIMARY KEY(revision_id, vat_rate_basis_points),
  FOREIGN KEY(company_id, invoice_id, revision_id)
    REFERENCES invoice_content_revisions(company_id, invoice_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) WITHOUT ROWID;
CREATE TABLE invoice_current_revisions (
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  PRIMARY KEY(company_id, invoice_id),
  FOREIGN KEY(company_id, invoice_id, revision_id)
    REFERENCES invoice_content_revisions(company_id, invoice_id, id) ON DELETE RESTRICT
);

-- Insert the complete child collection, then publish its header in the same
-- existing transaction. Deferred FKs forbid committing an unfinished collection.
CREATE TRIGGER invoice_revision_lines_insert_guard BEFORE INSERT ON invoice_revision_lines
WHEN EXISTS(SELECT 1 FROM invoice_content_revisions WHERE id = NEW.revision_id)
  OR EXISTS(SELECT 1 FROM invoice_revision_lines WHERE revision_id = NEW.revision_id
    AND (line_id = NEW.line_id OR line_order = NEW.line_order))
BEGIN SELECT RAISE(ABORT, 'REVISION_LINES_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_lines_update_guard BEFORE UPDATE ON invoice_revision_lines
BEGIN SELECT RAISE(ABORT, 'REVISION_LINES_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_lines_delete_guard BEFORE DELETE ON invoice_revision_lines
BEGIN SELECT RAISE(ABORT, 'REVISION_LINES_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_vat_insert_guard BEFORE INSERT ON invoice_revision_vat_breakdown
WHEN EXISTS(SELECT 1 FROM invoice_content_revisions WHERE id = NEW.revision_id)
  OR EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.revision_id
    AND vat_rate_basis_points = NEW.vat_rate_basis_points)
BEGIN SELECT RAISE(ABORT, 'REVISION_VAT_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_vat_update_guard BEFORE UPDATE ON invoice_revision_vat_breakdown
BEGIN SELECT RAISE(ABORT, 'REVISION_VAT_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_vat_delete_guard BEFORE DELETE ON invoice_revision_vat_breakdown
BEGIN SELECT RAISE(ABORT, 'REVISION_VAT_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_update_guard BEFORE UPDATE ON invoice_content_revisions
BEGIN SELECT RAISE(ABORT, 'REVISION_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_delete_guard BEFORE DELETE ON invoice_content_revisions
BEGIN SELECT RAISE(ABORT, 'REVISION_IMMUTABLE'); END;
CREATE TRIGGER invoice_revision_insert_guard BEFORE INSERT ON invoice_content_revisions
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoice_content_revisions WHERE id = NEW.id)
    THEN RAISE(ABORT, 'REVISION_IMMUTABLE') END;
  SELECT CASE WHEN NEW.invoice_kind = 'credit' AND NOT EXISTS(
    SELECT 1 FROM invoice_content_revisions WHERE company_id = NEW.company_id
      AND invoice_id = NEW.credited_invoice_id AND id = NEW.credited_revision_id AND invoice_kind = 'standard'
  ) THEN RAISE(ABORT, 'REVISION_CREDIT_SOURCE_INVALID') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM invoice_revision_lines WHERE revision_id = NEW.id AND source_revision_id IS NOT NULL
      AND (NEW.invoice_kind <> 'credit' OR source_revision_id IS NOT NEW.credited_revision_id)
  ) THEN RAISE(ABORT, 'REVISION_LINE_SOURCE_INVALID') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM invoice_revision_lines WHERE revision_id = NEW.id
      AND ((NEW.tax_treatment = 'normalVat' AND vat_rate_basis_points IS NULL)
        OR (NEW.tax_treatment = 'reverseChargeConstruction' AND (vat_rate_basis_points IS NOT NULL OR vat_cents <> 0 OR gross_cents <> net_cents)))
  ) THEN RAISE(ABORT, 'REVISION_LINE_TAX_INVALID') END;
  SELECT CASE WHEN NEW.vat_breakdown_state = 'unavailable' AND EXISTS(
    SELECT 1 FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id
  ) THEN RAISE(ABORT, 'REVISION_VAT_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.origin <> 'legacySnapshot' AND NOT EXISTS(
    SELECT 1 FROM invoice_revision_lines WHERE revision_id = NEW.id
  ) THEN RAISE(ABORT, 'REVISION_LINES_MISSING') END;
  SELECT CASE WHEN NEW.origin <> 'legacySnapshot' AND NEW.tax_treatment = 'reverseChargeConstruction' AND (
    NEW.total_vat_cents <> 0 OR NEW.total_net_cents <> NEW.total_gross_cents OR
    EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id)
  ) THEN RAISE(ABORT, 'REVISION_REVERSE_VAT_INVALID') END;
  SELECT CASE WHEN NEW.vat_breakdown_state = 'authoritative' AND NEW.tax_treatment = 'normalVat' AND (
    NOT EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id) OR
    NEW.total_net_cents <> (SELECT COALESCE(SUM(net_cents),0) FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id) OR
    NEW.total_vat_cents <> (SELECT COALESCE(SUM(vat_cents),0) FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id) OR
    NEW.total_gross_cents <> (SELECT COALESCE(SUM(gross_cents),0) FROM invoice_revision_vat_breakdown WHERE revision_id = NEW.id) OR
    EXISTS(SELECT 1 FROM invoice_revision_lines l WHERE l.revision_id = NEW.id AND NOT EXISTS(
      SELECT 1 FROM invoice_revision_vat_breakdown v WHERE v.revision_id = NEW.id AND v.vat_rate_basis_points = l.vat_rate_basis_points)) OR
    EXISTS(SELECT 1 FROM invoice_revision_vat_breakdown v WHERE v.revision_id = NEW.id AND NOT EXISTS(
      SELECT 1 FROM invoice_revision_lines l WHERE l.revision_id = NEW.id AND l.vat_rate_basis_points = v.vat_rate_basis_points))
  ) THEN RAISE(ABORT, 'REVISION_VAT_TOTALS_INVALID') END;
END;

-- Preserve observed legacy content, never reconstruct historical VAT or delivery.
CREATE TABLE invoice_legacy_revision_ids (
  invoice_id TEXT NOT NULL PRIMARY KEY,
  revision_id TEXT NOT NULL UNIQUE
);
INSERT INTO invoice_legacy_revision_ids SELECT id, lower(hex(randomblob(16))) FROM invoices;
INSERT INTO invoice_revision_lines (
  company_id,invoice_id,revision_id,line_id,source_invoice_line_id,source_revision_id,
  line_order,code,description,quantity_hundredths,unit,unit_price_cents,vat_rate_basis_points,
  discount_type,discount_value,base_cents,discount_cents,net_cents,vat_cents,gross_cents,created_at
)
SELECT i.company_id,l.invoice_id,m.revision_id,l.id,l.source_invoice_line_id,
  CASE WHEN l.source_invoice_line_id IS NOT NULL THEN s.revision_id ELSE NULL END,
  l.line_order,l.code,l.description,l.quantity_hundredths,l.unit,l.unit_price_cents,l.vat_rate_basis_points,
  l.discount_type,l.discount_value,l.base_cents,l.discount_cents,l.net_cents,l.vat_cents,l.gross_cents,l.created_at
FROM invoice_lines l LEFT JOIN invoices i ON i.id = l.invoice_id
LEFT JOIN invoice_legacy_revision_ids m ON m.invoice_id = l.invoice_id
LEFT JOIN invoice_legacy_revision_ids s ON s.invoice_id = i.credited_invoice_id;

INSERT INTO invoice_content_revisions (
  id,company_id,invoice_id,origin,vat_breakdown_state,
  credited_revision_id,credited_invoice_number_snapshot,credited_invoice_date_snapshot,
  source_draft_id,invoice_kind,credited_invoice_id,invoice_number,reference_number,reference_number_type,
  series_key,sequence_scope,sequence_number,numbering_mode,customer_id,
  customer_number_snapshot,customer_name_snapshot,customer_business_id_snapshot,customer_type_snapshot,
  customer_email_snapshot,customer_phone_snapshot,customer_street_address_snapshot,customer_postal_code_snapshot,customer_city_snapshot,
  company_name_snapshot,company_business_id_snapshot,company_vat_number_snapshot,company_street_address_snapshot,
  company_postal_code_snapshot,company_city_snapshot,company_email_snapshot,company_phone_snapshot,company_website_snapshot,
  company_iban_snapshot,company_bic_snapshot,company_bank_name_snapshot,billing_recipient_customer_id,
  billing_recipient_customer_number_snapshot,billing_recipient_name_snapshot,billing_recipient_business_id_snapshot,
  billing_recipient_customer_type_snapshot,billing_recipient_email_snapshot,billing_recipient_phone_snapshot,
  billing_recipient_street_address_snapshot,billing_recipient_postal_code_snapshot,billing_recipient_city_snapshot,
  invoice_date,due_date,payment_term_days,reminder_period_days,late_payment_interest_basis_points,price_input_mode,
  subject,order_number,note,delivery_address_text,refund_iban_snapshot,tax_treatment,tax_treatment_label_snapshot,
  tax_legal_basis_snapshot,performance_date,performance_period_start,performance_period_end,
  total_net_cents,total_vat_cents,total_gross_cents,created_at,approved_at
)
SELECT m.revision_id,i.company_id,i.id,'legacySnapshot','unavailable',
  s.revision_id,original.invoice_number,original.invoice_date,
  i.source_draft_id,i.invoice_kind,i.credited_invoice_id,i.invoice_number,i.reference_number,i.reference_number_type,
  i.series_key,i.sequence_scope,i.sequence_number,i.numbering_mode,i.customer_id,
  i.customer_number_snapshot,i.customer_name_snapshot,i.customer_business_id_snapshot,i.customer_type_snapshot,
  i.customer_email_snapshot,i.customer_phone_snapshot,i.customer_street_address_snapshot,i.customer_postal_code_snapshot,i.customer_city_snapshot,
  i.company_name_snapshot,i.company_business_id_snapshot,i.company_vat_number_snapshot,i.company_street_address_snapshot,
  i.company_postal_code_snapshot,i.company_city_snapshot,i.company_email_snapshot,i.company_phone_snapshot,i.company_website_snapshot,
  i.company_iban_snapshot,i.company_bic_snapshot,i.company_bank_name_snapshot,i.billing_recipient_customer_id,
  i.billing_recipient_customer_number_snapshot,i.billing_recipient_name_snapshot,i.billing_recipient_business_id_snapshot,
  i.billing_recipient_customer_type_snapshot,i.billing_recipient_email_snapshot,i.billing_recipient_phone_snapshot,
  i.billing_recipient_street_address_snapshot,i.billing_recipient_postal_code_snapshot,i.billing_recipient_city_snapshot,
  i.invoice_date,i.due_date,i.payment_term_days,i.reminder_period_days,i.late_payment_interest_basis_points,i.price_input_mode,
  i.subject,i.order_number,i.note,i.delivery_address_text,i.refund_iban_snapshot,i.tax_treatment,i.tax_treatment_label_snapshot,
  i.tax_legal_basis_snapshot,i.performance_date,i.performance_period_start,i.performance_period_end,
  i.total_net_cents,i.total_vat_cents,i.total_gross_cents,i.created_at,i.approved_at
FROM invoices i JOIN invoice_legacy_revision_ids m ON m.invoice_id = i.id
LEFT JOIN invoices original ON original.company_id = i.company_id AND original.id = i.credited_invoice_id
LEFT JOIN invoice_legacy_revision_ids s ON s.invoice_id = original.id
ORDER BY CASE WHEN i.invoice_kind = 'standard' THEN 0 ELSE 1 END, i.id;
INSERT INTO invoice_current_revisions(company_id,invoice_id,revision_id)
SELECT i.company_id,i.id,m.revision_id FROM invoices i
JOIN invoice_legacy_revision_ids m ON m.invoice_id = i.id WHERE i.status <> 'reopened_for_edit';
DROP TABLE invoice_legacy_revision_ids;
CREATE TRIGGER invoice_revision_legacy_insert_guard BEFORE INSERT ON invoice_content_revisions
WHEN NEW.origin = 'legacySnapshot'
BEGIN SELECT RAISE(ABORT, 'REVISION_LEGACY_INSERT_FORBIDDEN'); END;

-- Retain the original document and delivery evidence without inferring its content.
CREATE TABLE invoice_documents_next (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK(document_type = 'approved_invoice_pdf'),
  file_name TEXT NOT NULL CHECK(length(trim(file_name)) > 0),
  storage_path TEXT NOT NULL CHECK(length(trim(storage_path)) > 0),
  mime_type TEXT NOT NULL CHECK(mime_type = 'application/pdf'),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  created_at TEXT NOT NULL,
  binding_kind TEXT NOT NULL CHECK(binding_kind IN ('revision','legacyOriginal','preservedLegacy')),
  revision_id TEXT,
  source_document_id TEXT,
  CHECK(
    (binding_kind = 'revision' AND revision_id IS NOT NULL AND source_document_id IS NULL) OR
    (binding_kind = 'legacyOriginal' AND revision_id IS NULL AND source_document_id IS NULL) OR
    (binding_kind = 'preservedLegacy' AND revision_id IS NULL AND source_document_id IS NOT NULL AND source_document_id <> id)
  ),
  CHECK(binding_kind = 'legacyOriginal' OR (
    sha256 NOT GLOB '*[^0-9a-f]*' AND typeof(size_bytes) = 'integer' AND size_bytes <= 10485760
  )),
  UNIQUE(company_id, invoice_id, id),
  UNIQUE(company_id, invoice_id, id, binding_kind),
  UNIQUE(company_id, invoice_id, id, revision_id),
  UNIQUE(company_id, invoice_id, id, sha256, size_bytes),
  FOREIGN KEY(company_id, invoice_id) REFERENCES invoices(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, invoice_id, revision_id)
    REFERENCES invoice_content_revisions(company_id, invoice_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, invoice_id, source_document_id, sha256, size_bytes)
    REFERENCES invoice_documents_next(company_id, invoice_id, id, sha256, size_bytes) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE invoice_delivery_events_next (
  id TEXT NOT NULL PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  document_id TEXT,
  delivery_method TEXT NOT NULL CHECK(delivery_method IN ('email','manual','print','other')),
  provider TEXT NOT NULL CHECK(provider IN ('dryRun','smtp','gmail','microsoft','manual','other')),
  status TEXT NOT NULL CHECK(status IN ('prepared','attempted','succeeded','failed','outcomeUnknown')),
  recipient_email TEXT NOT NULL DEFAULT '' CHECK(length(recipient_email) <= 320),
  cc_email TEXT NOT NULL DEFAULT '' CHECK(length(cc_email) <= 320),
  subject TEXT NOT NULL DEFAULT '' CHECK(length(subject) <= 200),
  body_preview TEXT NOT NULL DEFAULT '' CHECK(length(body_preview) <= 500),
  provider_message_id TEXT CHECK(provider_message_id IS NULL OR length(provider_message_id) <= 500),
  safe_error_message TEXT CHECK(safe_error_message IS NULL OR length(safe_error_message) <= 500),
  technical_error_code TEXT CHECK(technical_error_code IS NULL OR length(technical_error_code) <= 120),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '' CHECK(length(created_by) <= 120),
  binding_kind TEXT NOT NULL CHECK(binding_kind IN ('revision','legacyOriginal','preservedLegacy')),
  revision_id TEXT,
  send_mode TEXT NOT NULL CHECK(send_mode IN ('customer','smtpTest','dryRun','manual','legacyUnknown')),
  document_sha256 TEXT,
  document_size_bytes INTEGER,
  CHECK(
    (binding_kind = 'legacyOriginal' AND revision_id IS NULL AND send_mode = 'legacyUnknown'
      AND document_sha256 IS NULL AND document_size_bytes IS NULL) OR
    (binding_kind = 'revision' AND revision_id IS NOT NULL AND send_mode <> 'legacyUnknown'
      AND document_id IS NOT NULL AND document_sha256 IS NOT NULL AND document_size_bytes IS NOT NULL) OR
    (binding_kind = 'preservedLegacy' AND revision_id IS NULL AND send_mode = 'customer'
      AND document_id IS NOT NULL AND document_sha256 IS NOT NULL AND document_size_bytes IS NOT NULL)
  ),
  CHECK(binding_kind = 'legacyOriginal' OR (
    length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*'
    AND typeof(document_size_bytes) = 'integer' AND document_size_bytes BETWEEN 1 AND 10485760
  )),
  CHECK(
    send_mode = 'legacyUnknown' OR
    (send_mode IN ('customer','smtpTest') AND delivery_method = 'email' AND provider = 'smtp') OR
    (send_mode = 'dryRun' AND delivery_method = 'email' AND provider = 'dryRun') OR
    (send_mode = 'manual' AND delivery_method IN ('manual','print') AND provider = 'manual')
  ),
  FOREIGN KEY(company_id, invoice_id) REFERENCES invoices(company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, invoice_id, document_id, binding_kind)
    REFERENCES invoice_documents_next(company_id, invoice_id, id, binding_kind) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, invoice_id, document_id, revision_id)
    REFERENCES invoice_documents_next(company_id, invoice_id, id, revision_id) ON DELETE RESTRICT,
  FOREIGN KEY(company_id, invoice_id, document_id, document_sha256, document_size_bytes)
    REFERENCES invoice_documents_next(company_id, invoice_id, id, sha256, size_bytes) ON DELETE RESTRICT
) WITHOUT ROWID;

INSERT INTO invoice_documents_next (
  id,company_id,invoice_id,document_type,file_name,storage_path,mime_type,sha256,size_bytes,created_at,
  binding_kind,revision_id,source_document_id
)
SELECT id,company_id,invoice_id,document_type,file_name,storage_path,mime_type,sha256,size_bytes,created_at,
  'legacyOriginal',NULL,NULL FROM invoice_documents;
INSERT INTO invoice_delivery_events_next (
  id,company_id,invoice_id,document_id,delivery_method,provider,status,recipient_email,cc_email,subject,
  body_preview,provider_message_id,safe_error_message,technical_error_code,created_at,created_by,
  binding_kind,revision_id,send_mode,document_sha256,document_size_bytes
)
SELECT id,company_id,invoice_id,document_id,delivery_method,provider,status,recipient_email,cc_email,subject,
  body_preview,provider_message_id,safe_error_message,technical_error_code,created_at,created_by,
  'legacyOriginal',NULL,'legacyUnknown',NULL,NULL FROM invoice_delivery_events;
DROP TABLE invoice_delivery_events;
DROP TABLE invoice_documents;
ALTER TABLE invoice_documents_next RENAME TO invoice_documents;
ALTER TABLE invoice_delivery_events_next RENAME TO invoice_delivery_events;

CREATE INDEX invoice_documents_company_invoice_index ON invoice_documents(company_id,invoice_id);
CREATE UNIQUE INDEX invoice_documents_revision_key
  ON invoice_documents(company_id,invoice_id,revision_id,document_type) WHERE binding_kind = 'revision';
CREATE UNIQUE INDEX invoice_documents_legacy_key
  ON invoice_documents(company_id,invoice_id,document_type) WHERE binding_kind = 'legacyOriginal';
CREATE UNIQUE INDEX invoice_documents_preserved_key
  ON invoice_documents(company_id,invoice_id,source_document_id,document_type) WHERE binding_kind = 'preservedLegacy';
CREATE INDEX invoice_delivery_events_company_invoice_created_index
  ON invoice_delivery_events(company_id,invoice_id,created_at);
CREATE UNIQUE INDEX invoice_delivery_events_unresolved_smtp_key
  ON invoice_delivery_events(company_id,invoice_id)
  WHERE binding_kind <> 'legacyOriginal' AND provider = 'smtp' AND status IN ('attempted','outcomeUnknown');

-- Install after the migration copy. Legacy rows can only arrive through the migration.
CREATE TRIGGER invoice_documents_insert_guard BEFORE INSERT ON invoice_documents BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoice_documents d WHERE d.id = NEW.id)
    THEN RAISE(ABORT, 'INVOICE_DOCUMENT_IMMUTABLE') END;
  SELECT CASE WHEN NEW.binding_kind = 'legacyOriginal'
    THEN RAISE(ABORT, 'INVOICE_DOCUMENT_LEGACY_INSERT_DENIED') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM invoice_documents d WHERE d.company_id = NEW.company_id AND d.invoice_id = NEW.invoice_id
      AND d.document_type = NEW.document_type AND d.binding_kind = NEW.binding_kind
      AND ((NEW.binding_kind = 'revision' AND d.revision_id = NEW.revision_id)
        OR (NEW.binding_kind = 'preservedLegacy' AND d.source_document_id = NEW.source_document_id))
  ) THEN RAISE(ABORT, 'INVOICE_DOCUMENT_IMMUTABLE') END;
  SELECT CASE WHEN NEW.binding_kind = 'revision' AND NOT EXISTS (
    SELECT 1 FROM invoice_content_revisions r WHERE r.company_id = NEW.company_id
      AND r.invoice_id = NEW.invoice_id AND r.id = NEW.revision_id
      AND r.origin IN ('approval','validatedLegacySnapshot')
  ) THEN RAISE(ABORT, 'INVOICE_DOCUMENT_REVISION_INVALID') END;
  SELECT CASE WHEN NEW.binding_kind = 'preservedLegacy' AND NOT EXISTS (
    SELECT 1 FROM invoice_documents d WHERE d.company_id = NEW.company_id
      AND d.invoice_id = NEW.invoice_id AND d.id = NEW.source_document_id AND d.binding_kind = 'legacyOriginal'
  ) THEN RAISE(ABORT, 'INVOICE_DOCUMENT_SOURCE_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoice_documents d WHERE d.storage_path = NEW.storage_path)
    THEN RAISE(ABORT, 'INVOICE_DOCUMENT_PATH_CONFLICT') END;
END;
CREATE TRIGGER invoice_documents_no_update BEFORE UPDATE ON invoice_documents BEGIN
  SELECT RAISE(ABORT, 'INVOICE_DOCUMENT_IMMUTABLE');
END;
CREATE TRIGGER invoice_documents_no_delete BEFORE DELETE ON invoice_documents BEGIN
  SELECT RAISE(ABORT, 'INVOICE_DOCUMENT_IMMUTABLE');
END;
CREATE TRIGGER invoice_delivery_events_insert_guard BEFORE INSERT ON invoice_delivery_events BEGIN
  SELECT CASE WHEN NEW.binding_kind = 'legacyOriginal'
    THEN RAISE(ABORT, 'INVOICE_DELIVERY_LEGACY_INSERT_DENIED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoice_delivery_events e WHERE e.id = NEW.id)
    THEN RAISE(ABORT, 'INVOICE_DELIVERY_BINDING_IMMUTABLE') END;
  SELECT CASE WHEN NEW.provider = 'smtp' AND NEW.status IN ('attempted','outcomeUnknown') AND EXISTS(
    SELECT 1 FROM invoice_delivery_events e WHERE e.company_id = NEW.company_id AND e.invoice_id = NEW.invoice_id
      AND e.binding_kind <> 'legacyOriginal' AND e.provider = 'smtp' AND e.status IN ('attempted','outcomeUnknown')
  ) THEN RAISE(ABORT, 'INVOICE_DELIVERY_UNRESOLVED') END;
END;
CREATE TRIGGER invoice_delivery_events_binding_no_update BEFORE UPDATE ON invoice_delivery_events
WHEN OLD.binding_kind = 'legacyOriginal'
  OR OLD.company_id IS NOT NEW.company_id OR OLD.invoice_id IS NOT NEW.invoice_id
  OR OLD.id IS NOT NEW.id OR OLD.document_id IS NOT NEW.document_id
  OR OLD.binding_kind IS NOT NEW.binding_kind OR OLD.revision_id IS NOT NEW.revision_id
  OR OLD.send_mode IS NOT NEW.send_mode OR OLD.document_sha256 IS NOT NEW.document_sha256
  OR OLD.document_size_bytes IS NOT NEW.document_size_bytes
  OR OLD.delivery_method IS NOT NEW.delivery_method OR OLD.provider IS NOT NEW.provider
  OR OLD.recipient_email IS NOT NEW.recipient_email OR OLD.cc_email IS NOT NEW.cc_email
  OR OLD.subject IS NOT NEW.subject OR OLD.body_preview IS NOT NEW.body_preview
  OR OLD.created_at IS NOT NEW.created_at OR OLD.created_by IS NOT NEW.created_by
BEGIN
  SELECT RAISE(ABORT, 'INVOICE_DELIVERY_BINDING_IMMUTABLE');
END;
CREATE TRIGGER invoice_delivery_events_unresolved_update_guard BEFORE UPDATE ON invoice_delivery_events
WHEN NEW.binding_kind <> 'legacyOriginal' AND NEW.provider = 'smtp' AND NEW.status IN ('attempted','outcomeUnknown')
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM invoice_delivery_events e WHERE e.company_id = NEW.company_id AND e.invoice_id = NEW.invoice_id
      AND e.id <> OLD.id AND e.binding_kind <> 'legacyOriginal' AND e.provider = 'smtp'
      AND e.status IN ('attempted','outcomeUnknown')
  ) THEN RAISE(ABORT, 'INVOICE_DELIVERY_UNRESOLVED') END;
END;
CREATE TRIGGER invoice_delivery_events_no_delete BEFORE DELETE ON invoice_delivery_events BEGIN
  SELECT RAISE(ABORT, 'INVOICE_DELIVERY_IMMUTABLE');
END;
