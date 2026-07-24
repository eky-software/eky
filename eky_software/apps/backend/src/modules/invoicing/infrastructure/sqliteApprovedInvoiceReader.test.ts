import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  createApprovedInvoiceListQuery,
  createInvoiceReadModelTestDatabase,
  insertInvoiceClone,
  markInvoiceSent,
} from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteApprovedInvoiceReader } from './sqliteApprovedInvoiceReader.js';

describe('SqliteApprovedInvoiceReader', () => {
  let database: DatabaseConnection;
  let reader: SqliteApprovedInvoiceReader;

  beforeEach(async () => {
    database = await createInvoiceReadModelTestDatabase();
    reader = new SqliteApprovedInvoiceReader(database);
  });

  afterEach(() => {
    database.close();
  });

  it('returns a same-company invoice view from snapshots and ordered lines', async () => {
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

  it('builds the VAT breakdown from ordered snapshot lines', async () => {
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

  it('lists approved, sent and cancelled snapshot summaries by requested status', async () => {
    insertInvoiceClone(database, {
      id: 'invoice-sent',
      sourceDraftId: 'draft-sent',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-14',
    });
    insertInvoiceClone(database, {
      id: 'invoice-cancelled',
      sourceDraftId: 'draft-cancelled',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260003',
      status: 'cancelled',
      totalGrossCents: 30_000,
      invoiceDate: '2026-06-15',
    });

    await expect(
      reader.listApprovedInvoiceSummaries(createApprovedInvoiceListQuery()),
    ).resolves.toMatchObject({
      invoices: [{ id: 'invoice-1', status: 'approved' }],
      totalCount: 1,
    });
    await expect(
      reader.listApprovedInvoiceSummaries(
        createApprovedInvoiceListQuery({ status: 'sent' }),
      ),
    ).resolves.toMatchObject({
      invoices: [{ id: 'invoice-sent', status: 'sent' }],
      totalCount: 1,
    });
    await expect(
      reader.listApprovedInvoiceSummaries(
        createApprovedInvoiceListQuery({ status: 'cancelled' }),
      ),
    ).resolves.toMatchObject({
      invoices: [{ id: 'invoice-cancelled', status: 'cancelled' }],
      totalCount: 1,
    });
  });

  it('returns the credited standard invoice identity for a credit invoice', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-invoice',
      sourceDraftId: 'credit-draft',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'approved',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });

    await expect(
      reader.getApprovedInvoiceById('dev-company', 'credit-invoice'),
    ).resolves.toMatchObject({
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      creditedInvoiceNumber: '20260001',
      creditedInvoiceDate: '2026-06-13',
    });
  });

  it('applies date filters, stable sorting and pagination to summaries', async () => {
    insertInvoiceClone(database, {
      id: 'invoice-2',
      sourceDraftId: 'draft-2',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'approved',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-14',
      dueDate: '2026-06-30',
      customerNameSnapshot: 'Alpha Customer Oy',
    });
    insertInvoiceClone(database, {
      id: 'invoice-3',
      sourceDraftId: 'draft-3',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260003',
      status: 'approved',
      totalGrossCents: 30_000,
      invoiceDate: '2026-06-14',
      dueDate: '2026-06-29',
      customerNameSnapshot: 'Beta Customer Oy',
    });

    const page = await reader.listApprovedInvoiceSummaries(
      createApprovedInvoiceListQuery({
        dateFrom: '2026-06-14',
        dateTo: '2026-06-14',
        limit: 1,
        offset: 1,
        sort: 'invoiceDateDesc',
      }),
    );
    const dueDateOrder = await reader.listApprovedInvoiceSummaries(
      createApprovedInvoiceListQuery({ sort: 'dueDateAsc' }),
    );
    const customerOrder = await reader.listApprovedInvoiceSummaries(
      createApprovedInvoiceListQuery({ sort: 'customerNameAsc' }),
    );

    expect(page).toMatchObject({
      invoices: [{ id: 'invoice-2' }],
      totalCount: 2,
    });
    expect(dueDateOrder.invoices.map((invoice) => invoice.id)).toEqual([
      'invoice-1',
      'invoice-3',
      'invoice-2',
    ]);
    expect(customerOrder.invoices.map((invoice) => invoice.id)).toEqual([
      'invoice-2',
      'invoice-3',
      'invoice-1',
    ]);
  });

  it('does not reveal detail or summaries outside the company scope', async () => {
    await expect(
      reader.getApprovedInvoiceById('other-company', 'invoice-1'),
    ).resolves.toBeUndefined();
    await expect(
      reader.listApprovedInvoiceSummaries(
        createApprovedInvoiceListQuery({ companyId: 'other-company' }),
      ),
    ).resolves.toEqual({ invoices: [], totalCount: 0 });
  });

  it('reads the view without Customers or Company Settings master data', async () => {
    database.exec(`
      DELETE FROM company_settings;
      DROP TABLE customers;
    `);

    await expect(
      reader.getApprovedInvoiceById('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      customerNameSnapshot: 'Snapshot Customer Oy',
      companyNameSnapshot: 'Snapshot Builder Oy',
    });
  });
});
