import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceAuditEventRow,
  InvoiceLineRow,
  InvoiceNumberSequenceRow,
  InvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type {
  InvoiceDraft,
  InvoiceDraftLine,
} from '../domain/invoiceDraft.js';
import type {
  InvoiceLineDiscount,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';
import type { ApproveInvoiceDraftPersistenceInput } from '../ports/invoiceApprovalRepository.js';
import { SqliteInvoiceDraftRepository } from './sqliteInvoiceDraftRepository.js';
import { SqliteInvoiceApprovalRepository } from './sqliteInvoiceApprovalRepository.js';

const migrationNames = [
  '001_create_customers.sql',
  '002_expand_customers_for_card_mvp.sql',
  '003_add_customer_property_manager_link.sql',
  '004_create_company_settings.sql',
  '005_add_customer_hourly_rate_override.sql',
  '006_create_invoice_drafts.sql',
  '007_add_company_settings_hourly_rate_shortcut.sql',
  '008_create_invoice_numbering.sql',
  '009_create_approved_invoices.sql',
];

const migrationSql = migrationNames.map((migrationName) =>
  readFileSync(
    new URL(
      `../../../database/migrations/${migrationName}`,
      import.meta.url,
    ),
    'utf8',
  ),
);

function runMigrations(database: DatabaseConnection): void {
  for (const sql of migrationSql) {
    database.exec(sql);
  }
}

function createLine(
  id: string,
  position: number,
  overrides: {
    discount?: InvoiceLineDiscount;
    priceInputMode?: PriceInputMode;
    quantityHundredths?: number;
    unitPriceCents?: number;
    vatRateBasisPoints?: number;
  } = {},
): InvoiceDraftLine {
  const priceInputMode = overrides.priceInputMode ?? 'net';
  const discount = overrides.discount ?? { type: 'none' };
  const calculatedLine = calculateInvoiceLine({
    quantityHundredths: overrides.quantityHundredths ?? 100,
    unitPriceCents: overrides.unitPriceCents ?? 10_000,
    vatRateBasisPoints: overrides.vatRateBasisPoints ?? 2550,
    priceInputMode,
    discount,
  });

  return {
    ...calculatedLine,
    id,
    position,
    code: position === 1 ? 'WORK' : '',
    description: position === 1 ? 'Installation work' : 'Travel',
    unit: position === 1 ? 'h' : 'km',
    discount,
  };
}

function createDraft(
  overrides: Partial<Omit<InvoiceDraft, 'lines' | 'totals'>> = {},
  lines: InvoiceDraftLine[] = [
    createLine('line-1', 1, {
      quantityHundredths: 150,
      vatRateBasisPoints: 2550,
    }),
    createLine('line-2', 2, {
      discount: { type: 'percentage', basisPoints: 500 },
      unitPriceCents: 2000,
      vatRateBasisPoints: 1350,
    }),
    createLine('line-3', 3, {
      discount: { type: 'fixed', amountCents: 1000 },
      unitPriceCents: 5000,
      vatRateBasisPoints: 0,
    }),
  ],
): InvoiceDraft {
  return {
    id: 'draft-1',
    companyId: 'dev-company',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2027-01-15',
    dueDate: '2027-01-29',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    createdAt: '2027-01-15T08:00:00.000Z',
    updatedAt: '2027-01-15T08:00:00.000Z',
    ...overrides,
    lines,
    totals: calculateInvoiceTotals(lines),
  };
}

function createApprovalInput(
  overrides: Partial<ApproveInvoiceDraftPersistenceInput> = {},
): ApproveInvoiceDraftPersistenceInput {
  return {
    actorUserId: 'user-1',
    approvedAt: '2027-01-15T12:00:00.000Z',
    auditEventId: 'audit-1',
    companyId: 'dev-company',
    draftId: 'draft-1',
    invoiceId: 'invoice-1',
    seriesKey: 'default',
    ...overrides,
  };
}

async function saveDraft(
  database: DatabaseConnection,
  draft: InvoiceDraft,
): Promise<void> {
  const draftRepository = new SqliteInvoiceDraftRepository(database);
  await draftRepository.saveDraft(draft);
}

function insertCustomer(
  database: DatabaseConnection,
  overrides: {
    companyId?: string;
    customerId?: string;
    customerNumber?: string;
    name?: string;
  } = {},
): void {
  database
    .prepare(
      `
        INSERT INTO customers (
          id,
          company_id,
          name,
          created_at,
          updated_at,
          customer_number,
          customer_type,
          business_id,
          street_address,
          postal_code,
          city,
          email,
          phone,
          comment,
          status,
          managed_by_customer_id,
          hourly_rate_override_cents
        )
        VALUES (?, ?, ?, 'created', 'updated', ?, 'company', '1234567-8', '', '', '', '', '', '', 'active', '', NULL)
      `,
    )
    .run(
      overrides.customerId ?? 'customer-1',
      overrides.companyId ?? 'dev-company',
      overrides.name ?? 'Test Customer Oy',
      overrides.customerNumber ?? '1001',
    );
}

function insertCompanySettings(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO company_settings (
          id,
          company_id,
          company_name,
          business_id,
          street_address,
          postal_code,
          city,
          email,
          phone,
          default_hourly_rate_cents,
          created_at,
          updated_at,
          hourly_rate_shortcut
        )
        VALUES (
          'settings-1',
          'dev-company',
          'Example Builder Oy',
          '7654321-0',
          '',
          '',
          '',
          '',
          '',
          6500,
          'created',
          'updated',
          'työ'
        )
      `,
    )
    .run();
}

function insertNumberingSettings(
  database: DatabaseConnection,
  overrides: {
    companyId?: string;
    firstSequenceNumber?: number;
    mode?: string;
    seriesKey?: string;
  } = {},
): void {
  database
    .prepare(
      `
        INSERT INTO invoice_numbering_settings (
          company_id,
          series_key,
          mode,
          fiscal_year_start_month,
          sequence_padding,
          first_sequence_number,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 1, 4, ?, 'created', 'updated')
      `,
    )
    .run(
      overrides.companyId ?? 'dev-company',
      overrides.seriesKey ?? 'default',
      overrides.mode ?? 'calendarYearSequence',
      overrides.firstSequenceNumber ?? 1,
    );
}

function getInvoice(
  database: DatabaseConnection,
  invoiceId: string,
): InvoiceRow | undefined {
  return database
    .prepare<[string], InvoiceRow>('SELECT * FROM invoices WHERE id = ?')
    .get(invoiceId);
}

function getInvoiceLines(
  database: DatabaseConnection,
  invoiceId: string,
): InvoiceLineRow[] {
  return database
    .prepare<[string], InvoiceLineRow>(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order',
    )
    .all(invoiceId);
}

function getAuditEvents(database: DatabaseConnection): InvoiceAuditEventRow[] {
  return database
    .prepare<[], InvoiceAuditEventRow>(
      'SELECT * FROM invoice_audit_events ORDER BY created_at',
    )
    .all();
}

function getSequence(
  database: DatabaseConnection,
): InvoiceNumberSequenceRow | undefined {
  return database
    .prepare<[], InvoiceNumberSequenceRow>(
      'SELECT * FROM invoice_number_sequences',
    )
    .get();
}

describe('SqliteInvoiceApprovalRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    runMigrations(database);
    insertCustomer(database);
    insertCompanySettings(database);
    insertNumberingSettings(database);
  });

  afterEach(() => {
    database.close();
  });

  it('approves a draft by reserving a number, creating snapshots, audit event, and draft link in one transaction', async () => {
    const draft = createDraft();
    const repository = new SqliteInvoiceApprovalRepository(database);

    await saveDraft(database, draft);

    await expect(repository.approveDraft(createApprovalInput())).resolves.toEqual({
      draftId: 'draft-1',
      invoiceId: 'invoice-1',
      invoiceNumber: '20270001',
      numberingMode: 'calendarYearSequence',
      sequenceNumber: 1,
      sequenceScope: 'calendar-year:2027',
      status: 'approved',
    });

    const invoice = getInvoice(database, 'invoice-1');
    const lines = getInvoiceLines(database, 'invoice-1');
    const auditEvents = getAuditEvents(database);
    const draftRow = database
      .prepare<[string], { approved_at: string | null; approved_invoice_id: string | null }>(
        `
          SELECT approved_invoice_id, approved_at
          FROM invoice_drafts
          WHERE id = ?
        `,
      )
      .get('draft-1');

    expect(invoice).toMatchObject({
      id: 'invoice-1',
      company_id: 'dev-company',
      source_draft_id: 'draft-1',
      invoice_number: '20270001',
      customer_id: 'customer-1',
      customer_number_snapshot: '1001',
      customer_name_snapshot: 'Test Customer Oy',
      customer_business_id_snapshot: '1234567-8',
      company_name_snapshot: 'Example Builder Oy',
      company_business_id_snapshot: '7654321-0',
      total_net_cents: draft.totals.netTotalCents,
      total_vat_cents: draft.totals.vatTotalCents,
      total_gross_cents: draft.totals.grossTotalCents,
      status: 'approved',
    });
    expect(lines.map((line) => line.line_order)).toEqual([1, 2, 3]);
    expect(lines.map((line) => line.vat_rate_basis_points)).toEqual([
      2550,
      1350,
      0,
    ]);
    expect(lines.map((line) => [line.discount_type, line.discount_value])).toEqual([
      ['none', 0],
      ['percentage', 500],
      ['fixed', 1000],
    ]);
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: 'invoice.approved',
        actor_user_id: 'user-1',
        company_id: 'dev-company',
        draft_id: 'draft-1',
        invoice_id: 'invoice-1',
        invoice_number: '20270001',
      }),
    ]);
    expect(draftRow).toEqual({
      approved_at: '2027-01-15T12:00:00.000Z',
      approved_invoice_id: 'invoice-1',
    });
    expect(getSequence(database)).toMatchObject({
      company_id: 'dev-company',
      last_sequence_number: 1,
      sequence_scope: 'calendar-year:2027',
      series_key: 'default',
    });
  });

  it('does not approve a draft outside the company scope', async () => {
    const repository = new SqliteInvoiceApprovalRepository(database);

    await saveDraft(database, createDraft());

    await expect(
      repository.approveDraft(
        createApprovalInput({
          companyId: 'other-company',
          invoiceId: 'invoice-other',
        }),
      ),
    ).resolves.toBeUndefined();

    expect(getInvoice(database, 'invoice-other')).toBeUndefined();
    expect(getSequence(database)).toBeUndefined();
  });

  it('does not approve the same draft twice', async () => {
    const repository = new SqliteInvoiceApprovalRepository(database);

    await saveDraft(database, createDraft());

    await expect(repository.approveDraft(createApprovalInput())).resolves.toMatchObject({
      invoiceNumber: '20270001',
    });
    await expect(
      repository.approveDraft(
        createApprovalInput({
          auditEventId: 'audit-2',
          invoiceId: 'invoice-2',
        }),
      ),
    ).resolves.toBeUndefined();

    const invoiceCount = database
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM invoices')
      .get();

    expect(invoiceCount?.count).toBe(1);
  });

  it('rolls back sequence and invoice writes when audit insertion fails', async () => {
    const repository = new SqliteInvoiceApprovalRepository(database);

    await saveDraft(database, createDraft());
    await expect(repository.approveDraft(createApprovalInput())).resolves.toMatchObject({
      invoiceNumber: '20270001',
    });
    await saveDraft(
      database,
      createDraft(
        { id: 'draft-2', updatedAt: '2027-01-16T08:00:00.000Z' },
        [createLine('line-4', 1)],
      ),
    );

    await expect(
      repository.approveDraft(
        createApprovalInput({
          draftId: 'draft-2',
          invoiceId: 'invoice-2',
          // Reuse the first audit id to fail after sequence, invoice, and lines.
          auditEventId: 'audit-1',
        }),
      ),
    ).rejects.toThrow();

    const draftTwo = database
      .prepare<
        [string],
        { approved_at: string | null; approved_invoice_id: string | null }
      >(
        `
          SELECT approved_invoice_id, approved_at
          FROM invoice_drafts
          WHERE id = ?
        `,
      )
      .get('draft-2');

    expect(getInvoice(database, 'invoice-2')).toBeUndefined();
    expect(getSequence(database)).toMatchObject({
      last_sequence_number: 1,
    });
    expect(draftTwo).toEqual({
      approved_at: null,
      approved_invoice_id: null,
    });
  });

  it('requires numbering settings before approving a draft', async () => {
    const repository = new SqliteInvoiceApprovalRepository(database);

    await saveDraft(database, createDraft());

    await expect(
      repository.approveDraft(createApprovalInput({ seriesKey: 'missing' })),
    ).rejects.toThrow(ApproveInvoiceDraftError);

    expect(getInvoice(database, 'invoice-1')).toBeUndefined();
    expect(getSequence(database)).toBeUndefined();
  });

  it('requires persisted draft lines before approving a draft', async () => {
    const repository = new SqliteInvoiceApprovalRepository(database);

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
            'draft-empty',
            'dev-company',
            'customer-1',
            'draft',
            '2027-01-15',
            '2027-01-29',
            14,
            'net',
            '',
            '',
            '',
            0,
            0,
            0,
            'created',
            'updated'
          )
        `,
      )
      .run();

    await expect(
      repository.approveDraft(
        createApprovalInput({
          draftId: 'draft-empty',
        }),
      ),
    ).rejects.toThrow(ApproveInvoiceDraftError);

    expect(getInvoice(database, 'invoice-1')).toBeUndefined();
    expect(getSequence(database)).toBeUndefined();
  });
});
