import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDeliveryEventRow,
} from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';

const invoiceDraftMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/006_create_invoice_drafts.sql',
    import.meta.url,
  ),
  'utf8',
);
const approvedInvoiceMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/009_create_approved_invoices.sql',
    import.meta.url,
  ),
  'utf8',
);
const invoiceDocumentMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/018_create_invoice_documents.sql',
    import.meta.url,
  ),
  'utf8',
);
const invoiceDeliveryEventMigrationSql = readFileSync(
  new URL(
    '../../../database/migrations/022_create_invoice_delivery_events.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('SqliteInvoiceDeliveryEventRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(invoiceDraftMigrationSql);
    database.exec(approvedInvoiceMigrationSql);
    database.exec(invoiceDocumentMigrationSql);
    database.exec(invoiceDeliveryEventMigrationSql);
    insertInvoice(database);
    insertInvoiceDocument(database);
  });

  afterEach(() => {
    database.close();
  });

  it('creates a company-scoped invoice delivery event table', () => {
    const table = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('invoice_delivery_events');

    expect(table?.name).toBe('invoice_delivery_events');
  });

  it('saves delivery event metadata without storing the full email body', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const event = createEvent();

    await expect(repository.saveDeliveryEvent(event)).resolves.toEqual(event);

    const storedEvent = database
      .prepare<[], InvoiceDeliveryEventRow>(
        'SELECT * FROM invoice_delivery_events',
      )
      .get();

    expect(storedEvent).toMatchObject({
      body_preview: 'Liitteenä lasku.',
      cc_email: 'copy@example.fi',
      company_id: 'dev-company',
      created_at: '2026-07-10T10:00:00.000Z',
      created_by: 'user-1',
      delivery_method: 'email',
      document_id: 'document-1',
      id: 'event-1',
      invoice_id: 'invoice-1',
      provider: 'dryRun',
      provider_message_id: null,
      recipient_email: 'customer@example.fi',
      safe_error_message: null,
      status: 'prepared',
      subject: 'Lasku 20260001',
      technical_error_code: null,
    });
  });

  it('enforces company and invoice indexes for later scoped reads', () => {
    const indexes = database
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      )
      .all('invoice_delivery_events')
      .map((index) => index.name);

    expect(indexes).toContain(
      'invoice_delivery_events_company_invoice_created_index',
    );
  });

  it('rejects invalid delivery enum values at the database boundary', () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    return expect(
      repository.saveDeliveryEvent(
        createEvent({
          provider: 'webmailAutomation' as InvoiceDeliveryEvent['provider'],
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects events for unknown invoices', async () => {
    const repository = new SqliteInvoiceDeliveryEventRepository(database);

    await expect(
      repository.saveDeliveryEvent(createEvent({ invoiceId: 'missing-invoice' })),
    ).rejects.toThrow();
  });
});

function createEvent(
  overrides: Partial<InvoiceDeliveryEvent> = {},
): InvoiceDeliveryEvent {
  return {
    bodyPreview: 'Liitteenä lasku.',
    ccEmail: 'copy@example.fi',
    companyId: 'dev-company',
    createdAt: '2026-07-10T10:00:00.000Z',
    createdBy: 'user-1',
    deliveryMethod: 'email',
    documentId: 'document-1',
    id: 'event-1',
    invoiceId: 'invoice-1',
    provider: 'dryRun',
    providerMessageId: null,
    recipientEmail: 'customer@example.fi',
    safeErrorMessage: null,
    status: 'prepared',
    subject: 'Lasku 20260001',
    technicalErrorCode: null,
    ...overrides,
  };
}

function insertInvoice(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
          customer_id,
          status,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at
        )
        VALUES (
          'draft-1',
          'dev-company',
          'customer-1',
          'draft',
          '2026-07-10',
          '2026-07-24',
          14,
          'net',
          '',
          '',
          '',
          1000,
          255,
          1255,
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z'
        )
      `,
    )
    .run();

  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_number,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          customer_number_snapshot,
          customer_name_snapshot,
          customer_business_id_snapshot,
          customer_type_snapshot,
          company_name_snapshot,
          company_business_id_snapshot,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          total_net_cents,
          total_vat_cents,
          total_gross_cents,
          created_at,
          approved_at,
          updated_at
        )
        VALUES (
          'invoice-1',
          'dev-company',
          'draft-1',
          '20260001',
          'default',
          'calendar-year:2026',
          1,
          'calendarYearSequence',
          'approved',
          'customer-1',
          '1001',
          'Test Customer Oy',
          '',
          'company',
          'Eky Oy',
          '1234567-8',
          '2026-07-10',
          '2026-07-24',
          14,
          'net',
          '',
          '',
          '',
          1000,
          255,
          1255,
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z',
          '2026-07-10T09:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertInvoiceDocument(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_documents (
          id,
          company_id,
          invoice_id,
          document_type,
          file_name,
          storage_path,
          mime_type,
          sha256,
          size_bytes,
          created_at
        )
        VALUES (
          'document-1',
          'dev-company',
          'invoice-1',
          'approved_invoice_pdf',
          'invoice.pdf',
          'invoice.pdf',
          'application/pdf',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          100,
          '2026-07-10T09:30:00.000Z'
        )
      `,
    )
    .run();
}
