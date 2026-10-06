import { insertInvoiceClone } from '../../testFixtures/invoiceReadModelTestFixtures.js';
import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { historicalDatabase, insert, migrate, type Row } from './invoiceContentRevisionMigration.fixture.js';
import { header, line, publish, vat } from './invoiceContentRevisionMigrationSnapshot.fixture.js';

const hash = 'a'.repeat(64);

export function documentRow(overrides: Row = {}): Row {
  return {
    id: 'doc-new',
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    document_type: 'approved_invoice_pdf',
    file_name: 'new.pdf',
    storage_path: 'synthetic/new.pdf',
    mime_type: 'application/pdf',
    sha256: hash,
    size_bytes: 64,
    created_at: '2026-07-01T00:00:00Z',
    binding_kind: 'revision',
    revision_id: 'revision-1',
    source_document_id: null,
    ...overrides,
  };
}

export function eventRow(overrides: Row = {}): Row {
  return {
    id: 'event-new',
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    document_id: 'doc-new',
    delivery_method: 'email',
    provider: 'smtp',
    status: 'attempted',
    created_at: '2026-07-01T00:00:00Z',
    binding_kind: 'revision',
    revision_id: 'revision-1',
    send_mode: 'customer',
    document_sha256: hash,
    document_size_bytes: 64,
    ...overrides,
  };
}

export async function createBindingDatabase(): Promise<DatabaseConnection> {
  const db = await historicalDatabase();
  for (const [id, number] of [['invoice-2', '2026002'], ['invoice-foreign', '2026003']] as const) {
    insertInvoiceClone(
      db,
      {
        id,
        sourceDraftId: 'draft-' + id,
        invoiceKind: 'standard',
        creditedInvoiceId: null,
        invoiceNumber: number,
        status: 'approved',
        totalGrossCents: 100,
        invoiceDate: '2026-06-01',
      },
    );
  }
  db.prepare("UPDATE invoices SET company_id = 'other-company' WHERE id = 'invoice-foreign'").run();
  const old = documentRow({ id: 'doc-old', storage_path: 'synthetic/old.pdf' });
  delete old.binding_kind;
  delete old.revision_id;
  delete old.source_document_id;
  insert(db, 'invoice_documents', old);
  for (const [id, doc, status] of [
    ['event-old', 'doc-old', 'succeeded'],
    ['event-old-null', null, 'failed'],
    ['event-unknown-1', 'doc-old', 'outcomeUnknown'],
    ['event-unknown-2', null, 'outcomeUnknown'],
  ] as const) {
    insert(
      db,
      'invoice_delivery_events',
      {
        id,
        company_id: 'dev-company',
        invoice_id: 'invoice-1',
        document_id: doc,
        delivery_method: 'email',
        provider: 'smtp',
        status,
        created_at: '2026-07-01T00:00:00Z',
        recipient_email: 'test@example.invalid',
        subject: 'Synthetic subject',
      },
    );
  }
  for (const [provider, method] of [
    ['manual', 'print'],
    ['other', 'other'],
    ['gmail', 'email'],
    ['microsoft', 'email'],
    ['dryRun', 'email'],
  ] as const) {
    insert(
      db,
      'invoice_delivery_events',
      {
        id: 'old-' + provider,
        company_id: 'dev-company',
        invoice_id: 'invoice-1',
        document_id: provider === 'other' ? null : 'doc-old',
        delivery_method: method,
        provider,
        status: 'failed',
        recipient_email: 'original@example.invalid',
        cc_email: 'copy@example.invalid',
        subject: 'Original synthetic subject',
        body_preview: 'Original synthetic preview',
        provider_message_id: 'synthetic-message',
        safe_error_message: 'Synthetic failure',
        technical_error_code: 'SYNTHETIC_FAILURE',
        created_at: '2026-07-01T00:00:00Z',
        created_by: 'synthetic-actor',
      },
    );
  }
  return db;
}

export function bindingState(db: DatabaseConnection) {
  return {
    docs: db.prepare<[], Row>('SELECT * FROM invoice_documents ORDER BY id').all(),
    events: db.prepare<[], Row>('SELECT * FROM invoice_delivery_events ORDER BY id').all(),
    invoices: db.prepare<[], Row>('SELECT * FROM invoices ORDER BY id').all(),
    lines: db.prepare<[], Row>('SELECT * FROM invoice_lines ORDER BY id').all(),
    migrations: db.prepare<[], Row>('SELECT * FROM schema_migrations ORDER BY name').all(),
    metadata: db.prepare<[], Row>('SELECT * FROM schema_migration_metadata ORDER BY migration_name').all(),
    schema: db.prepare<[], Row>('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  };
}

export async function createBoundRevisionDatabase(): Promise<DatabaseConnection> {
  const db = await createBindingDatabase();
  await migrate(db);
  for (const [id, company, invoice] of [
    ['revision-1', 'dev-company', 'invoice-1'],
    ['revision-2', 'dev-company', 'invoice-1'],
    ['revision-other', 'dev-company', 'invoice-2'],
    ['revision-foreign', 'other-company', 'invoice-foreign'],
  ] as const) {
    const owner = { company_id: company, invoice_id: invoice };
    // Full child collections precede the header, just as production 039 requires.
    publish(
      db,
      header(db, { ...owner, id }),
      [line({ ...owner, revision_id: id })],
      [vat({ ...owner, revision_id: id })],
    );
  }
  return db;
}

export function legacyRevisionId(db: DatabaseConnection): string {
  const row = db.prepare<[], { id: string; }>(
    "SELECT id FROM invoice_content_revisions WHERE invoice_id = 'invoice-1' AND company_id = 'dev-company' AND origin = 'legacySnapshot'",
  )
    .get();
  if (!row) throw new Error('Expected the actual migration-backfilled legacy revision');
  return row.id;
}
