import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { SqliteApprovedInvoiceReader } from './sqliteApprovedInvoiceReader.js';

describe('SqliteApprovedInvoiceReader', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertSourceDraft(database);
    insertApprovedInvoice(database);
    insertInvoiceLines(database);
  });

  afterEach(() => {
    database.close();
  });

  it('returns an approved invoice view from invoice snapshots and ordered lines', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    const invoice = await reader.getApprovedInvoiceById(
      'dev-company',
      'invoice-1',
    );

    expect(invoice).toMatchObject({
      id: 'invoice-1',
      companyId: 'dev-company',
      sourceDraftId: 'draft-1',
      invoiceNumber: '20260001',
      referenceNumber: '202600017',
      referenceNumberType: 'finnishDomestic',
      status: 'approved',
      companyNameSnapshot: 'Snapshot Builder Oy',
      companyVatNumberSnapshot: 'FI76543210',
      companyIbanSnapshot: 'FI2112345600000785',
      customerId: 'customer-1',
      customerNameSnapshot: 'Snapshot Customer Oy',
      customerEmailSnapshot: 'customer-snapshot@example.fi',
      billingRecipientCustomerId: 'billing-1',
      billingRecipientNameSnapshot: 'Snapshot Recipient Oy',
      latePaymentInterestBasisPoints: 950,
      reminderPeriodDays: 8,
      deliveryAddressText: 'Snapshot Worksite Street 4',
      totals: {
        netTotalCents: 30_000,
        vatTotalCents: 5_100,
        grossTotalCents: 35_100,
      },
    });
    expect(invoice?.lines.map((line) => line.lineOrder)).toEqual([1, 2, 3]);
    expect(invoice?.lines.map((line) => line.discount)).toEqual([
      { type: 'none' },
      { type: 'percentage', basisPoints: 500 },
      { type: 'fixed', amountCents: 1000 },
    ]);
  });

  it('builds VAT breakdown from approved invoice lines ordered by VAT rate', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    const invoice = await reader.getApprovedInvoiceById(
      'dev-company',
      'invoice-1',
    );

    expect(invoice?.vatBreakdown).toEqual([
      {
        vatRateBasisPoints: 0,
        netCents: 2_000,
        vatCents: 0,
        grossCents: 2_000,
      },
      {
        vatRateBasisPoints: 1000,
        netCents: 10_000,
        vatCents: 1_000,
        grossCents: 11_000,
      },
      {
        vatRateBasisPoints: 2550,
        netCents: 18_000,
        vatCents: 4_100,
        grossCents: 22_100,
      },
    ]);
    expect(invoice?.totals.vatBreakdown).toEqual(invoice?.vatBreakdown);
  });

  it('lists approved invoice summaries without lines or master data joins', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listApprovedInvoiceSummaries(createListQuery()),
    ).resolves.toEqual({
      invoices: [
        {
          id: 'invoice-1',
          invoiceKind: 'standard',
          creditedInvoiceId: null,
          invoiceNumber: '20260001',
          referenceNumber: '202600017',
          status: 'approved',
          customerId: 'customer-1',
          customerNumberSnapshot: '1001',
          customerNameSnapshot: 'Snapshot Customer Oy',
          billingRecipientNameSnapshot: 'Snapshot Recipient Oy',
          invoiceDate: '2026-06-13',
          dueDate: '2026-06-27',
          grossTotalCents: 35100,
          approvedAt: '2026-06-13T10:00:00.000Z',
          updatedAt: '2026-06-13T10:00:00.000Z',
          cancelledAt: null,
        },
      ],
      totalCount: 1,
    });
  });

  it('lists sent invoice summaries with approved invoice summaries', async () => {
    database
      .prepare(
        `
          UPDATE invoices
          SET status = 'sent', updated_at = '2026-06-13T11:00:00.000Z'
          WHERE id = 'invoice-1'
        `,
      )
      .run();
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listApprovedInvoiceSummaries(
        createListQuery({ status: 'sent' }),
      ),
    ).resolves.toMatchObject({
      invoices: [
        {
          id: 'invoice-1',
          status: 'sent',
          updatedAt: '2026-06-13T11:00:00.000Z',
        },
      ],
      totalCount: 1,
    });
    await expect(
      reader.getApprovedInvoiceById('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      id: 'invoice-1',
      status: 'sent',
    });
  });

  it('groups sent credits with their root and counts approved credits in the remaining amount', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-invoice-sent',
      sourceDraftId: 'credit-draft-sent',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });
    insertInvoiceClone(database, {
      id: 'credit-invoice-approved',
      sourceDraftId: 'credit-draft-approved',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'approved',
      totalGrossCents: 5_000,
      invoiceDate: '2026-06-15',
    });
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listSentInvoiceGroups(createSentGroupQuery()),
    ).resolves.toMatchObject({
      totalCount: 1,
      groups: [
        {
          rootInvoice: {
            id: 'invoice-1',
            invoiceKind: 'standard',
            status: 'sent',
          },
          creditInvoices: [
            {
              id: 'credit-invoice-sent',
              invoiceKind: 'credit',
              creditedInvoiceId: 'invoice-1',
              status: 'sent',
            },
          ],
          creditStatus: 'partial',
          remainingCreditableGrossCents: 20_100,
        },
      ],
    });
  });

  it('pages sent roots without separating a credit from its root', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'invoice-2',
      sourceDraftId: 'draft-2',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-14',
    });
    insertInvoiceClone(database, {
      id: 'credit-invoice-1',
      sourceDraftId: 'credit-draft-1',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'sent',
      totalGrossCents: 35_100,
      invoiceDate: '2026-06-15',
    });
    const reader = new SqliteApprovedInvoiceReader(database);

    const firstPage = await reader.listSentInvoiceGroups(
      createSentGroupQuery({ limit: 1 }),
    );
    const secondPage = await reader.listSentInvoiceGroups(
      createSentGroupQuery({ limit: 1, offset: 1 }),
    );

    expect(firstPage.totalCount).toBe(2);
    expect(firstPage.groups.map((group) => group.rootInvoice.id)).toEqual([
      'invoice-2',
    ]);
    expect(firstPage.groups[0]?.creditInvoices).toEqual([]);
    expect(secondPage.groups.map((group) => group.rootInvoice.id)).toEqual([
      'invoice-1',
    ]);
    expect(secondPage.groups[0]).toMatchObject({
      creditStatus: 'full',
      remainingCreditableGrossCents: 0,
      creditInvoices: [{ id: 'credit-invoice-1' }],
    });

    await expect(
      reader.listSentInvoiceGroups(
        createSentGroupQuery({ creditState: 'uncredited' }),
      ),
    ).resolves.toMatchObject({
      totalCount: 1,
      groups: [{ rootInvoice: { id: 'invoice-2' }, creditStatus: 'none' }],
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentGroupQuery({ creditState: 'credited' }),
      ),
    ).resolves.toMatchObject({
      totalCount: 1,
      groups: [{ rootInvoice: { id: 'invoice-1' }, creditStatus: 'full' }],
    });
  });

  it('does not return sent invoice groups outside the company scope', async () => {
    markInvoiceSent(database, 'invoice-1');
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listSentInvoiceGroups(
        createSentGroupQuery({ companyId: 'other-company' }),
      ),
    ).resolves.toEqual({ groups: [], totalCount: 0 });
  });

  it('returns the company-scoped credit context with related invoices and an active draft', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-invoice-approved',
      sourceDraftId: 'credit-draft-approved',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'approved',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });
    insertActiveCreditDraft(database, {
      id: 'credit-draft-active',
      creditedInvoiceId: 'invoice-1',
    });
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      sourceInvoiceId: 'invoice-1',
      creditInvoices: [
        {
          id: 'credit-invoice-approved',
          invoiceKind: 'credit',
          creditedInvoiceId: 'invoice-1',
          status: 'approved',
        },
      ],
      creditStatus: 'partial',
      remainingCreditableGrossCents: 25_100,
      activeCreditDraftId: 'credit-draft-active',
    });
  });

  it('does not reveal a credit context outside the company scope or for a non-sent invoice', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toBeUndefined();
    markInvoiceSent(database, 'invoice-1');
    await expect(
      reader.getInvoiceCreditContext('other-company', 'invoice-1'),
    ).resolves.toBeUndefined();
  });

  it('applies invoice-date filters and pagination without changing the total count', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listApprovedInvoiceSummaries(
        createListQuery({ dateFrom: '2026-06-14' }),
      ),
    ).resolves.toEqual({ invoices: [], totalCount: 0 });

    await expect(
      reader.listApprovedInvoiceSummaries(createListQuery({ offset: 1 })),
    ).resolves.toEqual({ invoices: [], totalCount: 1 });
  });

  it('does not list approved invoices outside the company scope', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.listApprovedInvoiceSummaries(
        createListQuery({ companyId: 'other-company' }),
      ),
    ).resolves.toEqual({ invoices: [], totalCount: 0 });
  });

  it('returns undefined when the invoice is outside the company scope', async () => {
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.getApprovedInvoiceById('other-company', 'invoice-1'),
    ).resolves.toBeUndefined();
  });

  it('does not need Company Settings or Customers master data for the view', async () => {
    database.exec(`
      DELETE FROM company_settings;
      DROP TABLE customers;
    `);
    const companySettingsRows = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM company_settings',
      )
      .get();
    const customersCount = database
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'customers'",
      )
      .get();
    const reader = new SqliteApprovedInvoiceReader(database);

    await expect(
      reader.getApprovedInvoiceById('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      customerNameSnapshot: 'Snapshot Customer Oy',
      companyNameSnapshot: 'Snapshot Builder Oy',
    });
    expect(companySettingsRows?.count).toBe(0);
    expect(customersCount?.count).toBe(0);
  });
});

function createListQuery(
  overrides: Partial<
    Parameters<
      SqliteApprovedInvoiceReader['listApprovedInvoiceSummaries']
    >[0]
  > = {},
): Parameters<
  SqliteApprovedInvoiceReader['listApprovedInvoiceSummaries']
>[0] {
  return {
    companyId: 'dev-company',
    status: 'approved',
    dateFrom: null,
    dateTo: null,
    limit: 20,
    offset: 0,
    sort: 'invoiceDateDesc',
    ...overrides,
  };
}

function createSentGroupQuery(
  overrides: Partial<
    Parameters<SqliteApprovedInvoiceReader['listSentInvoiceGroups']>[0]
  > = {},
): Parameters<SqliteApprovedInvoiceReader['listSentInvoiceGroups']>[0] {
  return {
    companyId: 'dev-company',
    creditState: 'all',
    dateFrom: null,
    dateTo: null,
    limit: 20,
    offset: 0,
    sort: 'invoiceDateDesc',
    ...overrides,
  };
}

function insertSourceDraft(database: DatabaseConnection): void {
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
          '2026-06-13',
          '2026-06-27',
          14,
          'net',
          'Snapshot invoice',
          'ORDER-1',
          'Snapshot note',
          30000,
          5100,
          35100,
          '2026-06-13T09:00:00.000Z',
          '2026-06-13T09:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertApprovedInvoice(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_number,
          reference_number,
          reference_number_type,
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
          customer_email_snapshot,
          customer_phone_snapshot,
          customer_street_address_snapshot,
          customer_postal_code_snapshot,
          customer_city_snapshot,
          company_name_snapshot,
          company_business_id_snapshot,
          company_vat_number_snapshot,
          company_street_address_snapshot,
          company_postal_code_snapshot,
          company_city_snapshot,
          company_email_snapshot,
          company_phone_snapshot,
          company_iban_snapshot,
          company_bic_snapshot,
          company_bank_name_snapshot,
          billing_recipient_customer_id,
          billing_recipient_customer_number_snapshot,
          billing_recipient_name_snapshot,
          billing_recipient_business_id_snapshot,
          billing_recipient_customer_type_snapshot,
          billing_recipient_email_snapshot,
          billing_recipient_phone_snapshot,
          billing_recipient_street_address_snapshot,
          billing_recipient_postal_code_snapshot,
          billing_recipient_city_snapshot,
          invoice_date,
          due_date,
          payment_term_days,
          reminder_period_days,
          late_payment_interest_basis_points,
          price_input_mode,
          subject,
          order_number,
          note,
          delivery_address_text,
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
          '202600017',
          'finnishDomestic',
          'default',
          'calendar-year:2026',
          1,
          'calendarYearSequence',
          'approved',
          'customer-1',
          '1001',
          'Snapshot Customer Oy',
          '1234567-8',
          'company',
          'customer-snapshot@example.fi',
          '040 111 2222',
          'Customer Street 1',
          '00100',
          'Helsinki',
          'Snapshot Builder Oy',
          '7654321-0',
          'FI76543210',
          'Builder Street 2',
          '33100',
          'Tampere',
          'billing-snapshot@example.fi',
          '03 123 4567',
          'FI2112345600000785',
          'NDEAFIHH',
          'Example Bank',
          'billing-1',
          '2001',
          'Snapshot Recipient Oy',
          '8765432-1',
          'propertyManager',
          'recipient-snapshot@example.fi',
          '040 333 4444',
          'Recipient Street 3',
          '02100',
          'Espoo',
          '2026-06-13',
          '2026-06-27',
          14,
          8,
          950,
          'net',
          'Snapshot invoice',
          'ORDER-1',
          'Snapshot note',
          'Snapshot Worksite Street 4',
          30000,
          5100,
          35100,
          '2026-06-13T10:00:00.000Z',
          '2026-06-13T10:00:00.000Z',
          '2026-06-13T10:00:00.000Z'
        )
      `,
    )
    .run();
}

function insertInvoiceLines(database: DatabaseConnection): void {
  const insertLine = database.prepare(
    `
      INSERT INTO invoice_lines (
        id,
        invoice_id,
        line_order,
        code,
        description,
        quantity_hundredths,
        unit,
        unit_price_cents,
        vat_rate_basis_points,
        discount_type,
        discount_value,
        base_cents,
        discount_cents,
        net_cents,
        vat_cents,
        gross_cents,
        created_at
      )
      VALUES (?, 'invoice-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')
    `,
  );

  insertLine.run(
    'line-2',
    2,
    'MAT',
    'Materials',
    100,
    'kpl',
    10000,
    1000,
    'percentage',
    500,
    10000,
    0,
    10000,
    1000,
    11000,
  );
  insertLine.run(
    'line-1',
    1,
    'WORK',
    'Work',
    200,
    'h',
    10000,
    2550,
    'none',
    0,
    20000,
    2000,
    18000,
    4100,
    22100,
  );
  insertLine.run(
    'line-3',
    3,
    '',
    'Information row',
    100,
    'erä',
    3000,
    0,
    'fixed',
    1000,
    3000,
    1000,
    2000,
    0,
    2000,
  );
}

function markInvoiceSent(
  database: DatabaseConnection,
  invoiceId: string,
): void {
  database
    .prepare(
      `
        UPDATE invoices
        SET status = 'sent', updated_at = '2026-06-13T11:00:00.000Z'
        WHERE id = ?
      `,
    )
    .run(invoiceId);
}

interface InvoiceCloneInput {
  id: string;
  sourceDraftId: string;
  invoiceKind: 'standard' | 'credit';
  creditedInvoiceId: string | null;
  invoiceNumber: string;
  status: 'approved' | 'sent';
  totalGrossCents: number;
  invoiceDate: string;
}

function insertInvoiceClone(
  database: DatabaseConnection,
  input: InvoiceCloneInput,
): void {
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
          updated_at,
          invoice_kind,
          credited_invoice_id
        )
        SELECT
          @sourceDraftId,
          company_id,
          customer_id,
          status,
          @invoiceDate,
          @invoiceDate,
          payment_term_days,
          price_input_mode,
          subject,
          order_number,
          note,
          @totalGrossCents,
          0,
          @totalGrossCents,
          created_at,
          updated_at,
          @invoiceKind,
          @creditedInvoiceId
        FROM invoice_drafts
        WHERE id = 'draft-1'
      `,
    )
    .run(input);

  const columns = database
    .prepare<[], { name: string }>('PRAGMA table_info(invoices)')
    .all()
    .map((column) => column.name);
  const overrides: Record<string, string | number | null> = {
    id: input.id,
    source_draft_id: input.sourceDraftId,
    invoice_kind: input.invoiceKind,
    credited_invoice_id: input.creditedInvoiceId,
    invoice_number: input.invoiceNumber,
    reference_number:
      input.invoiceKind === 'credit' ? null : input.invoiceNumber,
    reference_number_type:
      input.invoiceKind === 'credit' ? null : 'finnishDomestic',
    sequence_number: Number(input.invoiceNumber.slice(-2)),
    status: input.status,
    invoice_date: input.invoiceDate,
    due_date: input.invoiceDate,
    total_net_cents: input.totalGrossCents,
    total_vat_cents: 0,
    total_gross_cents: input.totalGrossCents,
    approved_at: `${input.invoiceDate}T10:00:00.000Z`,
    updated_at: `${input.invoiceDate}T10:00:00.000Z`,
  };
  const selectExpressions = columns.map((column) =>
    Object.prototype.hasOwnProperty.call(overrides, column)
      ? `@${column}`
      : `"${column}"`,
  );

  database
    .prepare(
      `
        INSERT INTO invoices (${columns.map((column) => `"${column}"`).join(', ')})
        SELECT ${selectExpressions.join(', ')}
        FROM invoices
        WHERE id = @cloneSourceInvoiceId
      `,
    )
    .run({ cloneSourceInvoiceId: 'invoice-1', ...overrides });
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET approved_invoice_id = ?, approved_at = ?
        WHERE id = ?
      `,
    )
    .run(
      input.id,
      `${input.invoiceDate}T10:00:00.000Z`,
      input.sourceDraftId,
    );
}

function insertActiveCreditDraft(
  database: DatabaseConnection,
  input: { id: string; creditedInvoiceId: string },
): void {
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
          updated_at,
          invoice_kind,
          credited_invoice_id
        )
        SELECT
          @id,
          company_id,
          customer_id,
          'draft',
          invoice_date,
          invoice_date,
          0,
          price_input_mode,
          subject,
          '',
          '',
          0,
          0,
          0,
          '2026-06-15T10:00:00.000Z',
          '2026-06-15T10:00:00.000Z',
          'credit',
          @creditedInvoiceId
        FROM invoice_drafts
        WHERE id = 'draft-1'
      `,
    )
    .run(input);
}
