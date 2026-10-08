import { reverseChargeConstructionLabel, reverseChargeConstructionLegalBasis } from '../../modules/invoicing/domain/invoiceTaxTreatment.js';
import { insertInvoiceClone } from '../../testFixtures/invoiceReadModelTestFixtures.js';
import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { historicalDatabase, insert, migrate, type Row } from './invoiceContentRevisionMigration.fixture.js';

export const contentFields = [
  'source_draft_id',
  'invoice_kind',
  'credited_invoice_id',
  'invoice_number',
  'reference_number',
  'reference_number_type',
  'series_key',
  'sequence_scope',
  'sequence_number',
  'numbering_mode',
  'customer_id',
  'customer_number_snapshot',
  'customer_name_snapshot',
  'customer_business_id_snapshot',
  'customer_type_snapshot',
  'customer_email_snapshot',
  'customer_phone_snapshot',
  'customer_street_address_snapshot',
  'customer_postal_code_snapshot',
  'customer_city_snapshot',
  'company_name_snapshot',
  'company_business_id_snapshot',
  'company_vat_number_snapshot',
  'company_street_address_snapshot',
  'company_postal_code_snapshot',
  'company_city_snapshot',
  'company_email_snapshot',
  'company_phone_snapshot',
  'company_website_snapshot',
  'company_iban_snapshot',
  'company_bic_snapshot',
  'company_bank_name_snapshot',
  'billing_recipient_customer_id',
  'billing_recipient_customer_number_snapshot',
  'billing_recipient_name_snapshot',
  'billing_recipient_business_id_snapshot',
  'billing_recipient_customer_type_snapshot',
  'billing_recipient_email_snapshot',
  'billing_recipient_phone_snapshot',
  'billing_recipient_street_address_snapshot',
  'billing_recipient_postal_code_snapshot',
  'billing_recipient_city_snapshot',
  'invoice_date',
  'due_date',
  'payment_term_days',
  'reminder_period_days',
  'late_payment_interest_basis_points',
  'price_input_mode',
  'subject',
  'order_number',
  'note',
  'delivery_address_text',
  'refund_iban_snapshot',
  'tax_treatment',
  'tax_treatment_label_snapshot',
  'tax_legal_basis_snapshot',
  'performance_date',
  'performance_period_start',
  'performance_period_end',
  'total_net_cents',
  'total_vat_cents',
  'total_gross_cents',
  'created_at',
  'approved_at',
] as const;

export const liveFields = [
  'status',
  'updated_at',
  'cancelled_at',
  'cancelled_by',
  'cancellation_reason',
  'payment_state',
  'paid_on',
  'paid_amount_cents',
  'payment_source',
  'payment_recorded_at',
  'payment_recorded_by',
];

export const lineFields = [
  'source_invoice_line_id',
  'line_order',
  'code',
  'description',
  'quantity_hundredths',
  'unit',
  'unit_price_cents',
  'vat_rate_basis_points',
  'discount_type',
  'discount_value',
  'base_cents',
  'discount_cents',
  'net_cents',
  'vat_cents',
  'gross_cents',
  'created_at',
];

export const reverse: Row = {
  tax_treatment: 'reverseChargeConstruction',
  price_input_mode: 'net',
  tax_treatment_label_snapshot: reverseChargeConstructionLabel,
  tax_legal_basis_snapshot: reverseChargeConstructionLegalBasis,
  total_vat_cents: 0,
  total_gross_cents: 100,
};

export const project = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, row[k]]));

export async function createSnapshotDatabase(
  applyMigration = true,
): Promise<DatabaseConnection> {
  const db = await historicalDatabase();
  insertInvoiceClone(
    db,
    {
      id: 'other',
      sourceDraftId: 'other-draft',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '2026002',
      status: 'approved',
      totalGrossCents: 125,
      invoiceDate: '2026-06-01',
    },
  );
  insertInvoiceClone(
    db,
    {
      id: 'credit',
      sourceDraftId: 'credit-draft',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '2026003',
      status: 'approved',
      totalGrossCents: 125,
      invoiceDate: '2026-06-01',
    },
  );
  insertInvoiceClone(
    db,
    {
      id: 'foreign',
      sourceDraftId: 'foreign-draft',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '2026004',
      status: 'sent',
      totalGrossCents: 125,
      invoiceDate: '2026-06-01',
    },
  );
  db.prepare("UPDATE invoices SET company_id = 'other-company' WHERE id = 'foreign'").run();
  db.prepare("UPDATE invoices SET status = 'sent' WHERE id = 'invoice-1'").run();
  db.prepare("UPDATE invoices SET status = 'reopened_for_edit' WHERE id = 'other'").run();
  const source = db.prepare<[], Row>("SELECT * FROM invoice_lines WHERE id = 'line-1'").get()!;
  insert(db, 'invoice_lines', { ...source, id: 'credit-line', invoice_id: 'credit', source_invoice_line_id: 'line-1' });
  insert(
    db,
    'invoice_documents',
    {
      id: 'legacy-document',
      company_id: 'dev-company',
      invoice_id: 'invoice-1',
      document_type: 'approved_invoice_pdf',
      file_name: 'synthetic.pdf',
      storage_path: 'synthetic/legacy.pdf',
      mime_type: 'application/pdf',
      sha256: 'a'.repeat(64),
      size_bytes: 64,
      created_at: '2026-06-01T00:00:00Z',
    },
  );
  for (const documentId of ['legacy-document', null]) {
    insert(db, 'invoice_delivery_events', {
      id: documentId ? 'legacy-event' : 'legacy-null-event',
      company_id: 'dev-company',
      invoice_id: 'invoice-1',
      document_id: documentId,
      delivery_method: 'email',
      provider: 'smtp',
      status: 'outcomeUnknown',
      subject: 'Synthetic old subject',
      created_at: '2026-06-01T00:00:00Z',
    });
  }
  if (applyMigration) {
    await migrate(db);
  }
  return db;
}

export function header(db: DatabaseConnection, overrides: Row = {}): Row {
  const original = db.prepare<[], Row>("SELECT * FROM invoices WHERE id = 'invoice-1'").get()!;
  return {
    ...project(original, contentFields),
    id: 'new-revision',
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    origin: 'approval',
    vat_breakdown_state: 'authoritative',
    credited_revision_id: null,
    credited_invoice_number_snapshot: null,
    credited_invoice_date_snapshot: null,
    total_net_cents: 100,
    total_vat_cents: 25,
    total_gross_cents: 125,
    ...overrides,
  };
}

export function line(overrides: Row = {}): Row {
  return {
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    revision_id: 'new-revision',
    line_id: 'same-line',
    source_invoice_line_id: null,
    source_revision_id: null,
    line_order: 1,
    code: 'SYN',
    description: 'Synthetic line',
    quantity_hundredths: 100,
    unit: 'h',
    unit_price_cents: 100,
    vat_rate_basis_points: 2500,
    discount_type: 'none',
    discount_value: 0,
    base_cents: 100,
    discount_cents: 0,
    net_cents: 100,
    vat_cents: 25,
    gross_cents: 125,
    created_at: '2026-10-05T00:00:00Z',
    ...overrides,
  };
}

export function vat(overrides: Row = {}): Row {
  return {
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    revision_id: 'new-revision',
    vat_rate_basis_points: 2500,
    net_cents: 100,
    vat_cents: 25,
    gross_cents: 125,
    ...overrides,
  };
}

export function publish(
  db: DatabaseConnection,
  revisionHeader = header(db),
  revisionLines = [line()],
  vatBreakdown = [vat()],
): void {
  db.transaction(() => {
    for (const revisionLine of revisionLines) {
      insert(db, 'invoice_revision_lines', revisionLine);
    }
    for (const vatGroup of vatBreakdown) {
      insert(db, 'invoice_revision_vat_breakdown', vatGroup);
    }
    insert(db, 'invoice_content_revisions', revisionHeader);
  }).immediate();
}
