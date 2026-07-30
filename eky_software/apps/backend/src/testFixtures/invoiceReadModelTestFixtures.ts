import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import type { ApprovedInvoiceSummaryQuery } from '../modules/invoicing/domain/approvedInvoiceSummary.js';
import type { SentInvoiceGroupQuery } from '../modules/invoicing/domain/sentInvoiceGroup.js';

export async function createInvoiceReadModelTestDatabase(): Promise<DatabaseConnection> {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  await runMigrations(database);
  insertSourceDraft(database);
  insertApprovedInvoice(database);
  insertInvoiceLines(database);
  return database;
}

export function createApprovedInvoiceListQuery(
  overrides: Partial<ApprovedInvoiceSummaryQuery> = {},
): ApprovedInvoiceSummaryQuery {
  return {
    companyId: 'dev-company',
    customerId: null,
    status: 'approved',
    dateFrom: null,
    dateTo: null,
    limit: 20,
    offset: 0,
    sort: 'invoiceDateDesc',
    ...overrides,
  };
}

export function createSentInvoiceGroupQuery(
  overrides: Partial<SentInvoiceGroupQuery> = {},
): SentInvoiceGroupQuery {
  return {
    companyId: 'dev-company',
    customerId: null,
    creditState: 'all',
    dateFrom: null,
    dateTo: null,
    limit: 20,
    offset: 0,
    sort: 'invoiceDateDesc',
    ...overrides,
  };
}

export function markInvoiceSent(
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

export interface InvoiceCloneInput {
  id: string;
  sourceDraftId: string;
  invoiceKind: 'standard' | 'credit';
  creditedInvoiceId: string | null;
  invoiceNumber: string;
  status: 'approved' | 'sent' | 'cancelled';
  totalGrossCents: number;
  invoiceDate: string;
  dueDate?: string;
  customerNameSnapshot?: string;
  customerId?: string;
  billingRecipientCustomerId?: string | null;
}

export function insertInvoiceClone(
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
          @dueDate,
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
    .run({ ...input, dueDate: input.dueDate ?? input.invoiceDate });

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
    customer_name_snapshot:
      input.customerNameSnapshot ?? 'Snapshot Customer Oy',
    customer_id: input.customerId ?? 'customer-1',
    billing_recipient_customer_id:
      input.billingRecipientCustomerId === undefined
        ? 'billing-1'
        : input.billingRecipientCustomerId,
    invoice_date: input.invoiceDate,
    due_date: input.dueDate ?? input.invoiceDate,
    total_net_cents: input.totalGrossCents,
    total_vat_cents: 0,
    total_gross_cents: input.totalGrossCents,
    approved_at: `${input.invoiceDate}T10:00:00.000Z`,
    updated_at: `${input.invoiceDate}T10:00:00.000Z`,
    cancelled_at:
      input.status === 'cancelled'
        ? `${input.invoiceDate}T11:00:00.000Z`
        : null,
    cancelled_by: input.status === 'cancelled' ? 'test-actor' : null,
    cancellation_reason:
      input.status === 'cancelled' ? 'Synthetic test cancellation.' : null,
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

export function insertActiveCreditDraft(
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
