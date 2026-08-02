import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  createInvoiceReadModelTestDatabase,
  createSentInvoiceGroupQuery,
  insertInvoiceClone,
  markInvoiceSent,
} from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteSentInvoiceGroupReader } from './sqliteSentInvoiceGroupReader.js';

describe('SqliteSentInvoiceGroupReader', () => {
  let database: DatabaseConnection;
  let reader: SqliteSentInvoiceGroupReader;

  beforeEach(async () => {
    database = await createInvoiceReadModelTestDatabase();
    reader = new SqliteSentInvoiceGroupReader(database);
    markInvoiceSent(database, 'invoice-1');
  });

  afterEach(() => {
    database.close();
  });

  it('supports all, uncredited and credited root filters with matching counts', async () => {
    insertSentRoot(database, 'invoice-2', 'draft-2', '20260002', '2026-06-14');
    insertInvoiceClone(database, {
      id: 'credit-approved',
      sourceDraftId: 'credit-draft-approved',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'approved',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-15',
    });

    const all = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery(),
    );
    const uncredited = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery({ creditState: 'uncredited' }),
    );
    const credited = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery({ creditState: 'credited' }),
    );

    expect(all.totalCount).toBe(2);
    expect(all.groups).toHaveLength(2);
    expect(uncredited).toMatchObject({
      totalCount: 1,
      groups: [{ rootInvoice: { id: 'invoice-2' }, creditStatus: 'none' }],
    });
    expect(credited).toMatchObject({
      totalCount: 1,
      groups: [{ rootInvoice: { id: 'invoice-1' }, creditStatus: 'partial' }],
    });
  });

  it('pages roots before loading sent child credits', async () => {
    insertSentRoot(database, 'invoice-2', 'draft-2', '20260002', '2026-06-14');
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

    const firstPage = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery({ limit: 1 }),
    );
    const secondPage = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery({ limit: 1, offset: 1 }),
    );
    const pastLastPage = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery({ limit: 1, offset: 2 }),
    );

    expect(firstPage).toMatchObject({
      totalCount: 2,
      groups: [{ rootInvoice: { id: 'invoice-2' }, creditInvoices: [] }],
    });
    expect(secondPage).toMatchObject({
      totalCount: 2,
      groups: [
        {
          rootInvoice: { id: 'invoice-1' },
          creditInvoices: [{ id: 'credit-invoice-1' }],
          creditStatus: 'full',
          remainingCreditableGrossCents: 0,
        },
      ],
    });
    expect(pastLastPage).toEqual({ groups: [], totalCount: 2 });
  });

  it('shows only sent child credits while approved credits still reserve capacity', async () => {
    insertInvoiceClone(database, {
      id: 'credit-sent',
      sourceDraftId: 'credit-draft-sent',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });
    insertInvoiceClone(database, {
      id: 'credit-approved',
      sourceDraftId: 'credit-draft-approved',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'approved',
      totalGrossCents: 5_000,
      invoiceDate: '2026-06-15',
    });

    await expect(
      reader.listSentInvoiceGroups(createSentInvoiceGroupQuery()),
    ).resolves.toMatchObject({
      groups: [
        {
          creditInvoices: [{ id: 'credit-sent', status: 'sent' }],
          creditStatus: 'partial',
          remainingCreditableGrossCents: 20_100,
        },
      ],
    });
  });

  it('uses stable root and child ordering', async () => {
    insertSentRoot(database, 'invoice-a', 'draft-a', '20260002', '2026-06-14');
    insertSentRoot(database, 'invoice-b', 'draft-b', '20260003', '2026-06-14');
    insertInvoiceClone(database, {
      id: 'credit-b',
      sourceDraftId: 'credit-draft-b',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260004',
      status: 'sent',
      totalGrossCents: 2_000,
      invoiceDate: '2026-06-16',
    });
    insertInvoiceClone(database, {
      id: 'credit-a',
      sourceDraftId: 'credit-draft-a',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260005',
      status: 'sent',
      totalGrossCents: 1_000,
      invoiceDate: '2026-06-16',
    });

    const result = await reader.listSentInvoiceGroups(
      createSentInvoiceGroupQuery(),
    );

    expect(result.groups.map((group) => group.rootInvoice.id)).toEqual([
      'invoice-b',
      'invoice-a',
      'invoice-1',
    ]);
    expect(
      result.groups.at(-1)?.creditInvoices.map((invoice) => invoice.id),
    ).toEqual(['credit-a', 'credit-b']);
  });

  it('applies date filters identically to count and page results', async () => {
    insertSentRoot(database, 'invoice-2', 'draft-2', '20260002', '2026-06-14');

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          dateFrom: '2026-06-14',
          dateTo: '2026-06-14',
        }),
      ),
    ).resolves.toMatchObject({
      totalCount: 1,
      groups: [{ rootInvoice: { id: 'invoice-2' } }],
    });
  });

  it('filters paid and unpaid root invoices identically in page and count queries', async () => {
    insertSentRoot(database, 'invoice-2', 'draft-2', '20260002', '2026-06-14');
    database
      .prepare(
        `
          UPDATE invoices
          SET
            payment_state = 'paid',
            paid_on = '2026-07-31',
            paid_amount_cents = total_gross_cents,
            payment_source = 'manual',
            payment_recorded_at = '2026-07-31T10:00:00.000Z',
            payment_recorded_by = 'local-owner'
          WHERE id = 'invoice-1'
        `,
      )
      .run();

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ paymentState: 'paid' }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: {
            id: 'invoice-1',
            paidAmountCents: 35_100,
            paidOn: '2026-07-31',
            paymentSource: 'manual',
            paymentState: 'paid',
          },
        },
      ],
      totalCount: 1,
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ paymentState: 'unpaid' }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: {
            id: 'invoice-2',
            paidAmountCents: null,
            paidOn: null,
            paymentSource: null,
            paymentState: 'unpaid',
          },
        },
      ],
      totalCount: 1,
    });
  });

  it('filters root invoices by customer and preserves their credit groups', async () => {
    insertInvoiceClone(database, {
      id: 'invoice-customer-2',
      sourceDraftId: 'draft-customer-2',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-14',
      customerId: 'customer-2',
      billingRecipientCustomerId: 'customer-1',
    });
    insertInvoiceClone(database, {
      id: 'credit-customer-1',
      sourceDraftId: 'credit-draft-customer-1',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'sent',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-15',
      customerId: 'customer-1',
    });

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ customerId: 'customer-1' }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: { id: 'invoice-1' },
          creditInvoices: [{ id: 'credit-customer-1' }],
          creditStatus: 'partial',
        },
      ],
      totalCount: 1,
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ customerId: 'customer-2' }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: { id: 'invoice-customer-2' },
          creditInvoices: [],
        },
      ],
      totalCount: 1,
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ customerId: 'unknown-customer' }),
      ),
    ).resolves.toEqual({ groups: [], totalCount: 0 });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          customerId: "customer-1' OR 1=1 --",
        }),
      ),
    ).resolves.toEqual({ groups: [], totalCount: 0 });
  });

  it('filters paginated roots by persisted billing recipient and excludes recipient-owned invoices', async () => {
    insertInvoiceClone(database, {
      id: 'recipient-root',
      sourceDraftId: 'recipient-root-draft',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-12',
      customerId: 'housing-company-2',
      billingRecipientCustomerId: 'billing-1',
      customerNameSnapshot: 'Snapshot Housing Company 2',
    });
    insertInvoiceClone(database, {
      id: 'recipient-is-owner',
      sourceDraftId: 'recipient-owner-draft',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260003',
      status: 'sent',
      totalGrossCents: 30_000,
      invoiceDate: '2026-06-15',
      customerId: 'billing-1',
      billingRecipientCustomerId: 'billing-1',
    });
    insertInvoiceClone(database, {
      id: 'recipient-credit',
      sourceDraftId: 'recipient-credit-draft',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260004',
      status: 'sent',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-16',
      customerId: 'customer-1',
      billingRecipientCustomerId: 'billing-1',
    });

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          billingRecipientCustomerId: 'billing-1',
          limit: 1,
          offset: 1,
        }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: {
            id: 'recipient-root',
            customerId: 'housing-company-2',
            customerNameSnapshot: 'Snapshot Housing Company 2',
          },
          creditInvoices: [],
        },
      ],
      totalCount: 2,
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          billingRecipientCustomerId: 'billing-1',
          creditState: 'credited',
        }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: { id: 'invoice-1' },
          creditInvoices: [{ id: 'recipient-credit' }],
          creditStatus: 'partial',
        },
      ],
      totalCount: 1,
    });
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          billingRecipientCustomerId: "billing-1' OR 1=1 --",
        }),
      ),
    ).resolves.toEqual({ groups: [], totalCount: 0 });
  });

  it('applies customer filtering consistently to page results and total count', async () => {
    insertInvoiceClone(database, {
      id: 'invoice-customer-1-b',
      sourceDraftId: 'draft-customer-1-b',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-14',
      customerId: 'customer-1',
    });
    insertInvoiceClone(database, {
      id: 'invoice-customer-2',
      sourceDraftId: 'draft-customer-2',
      invoiceKind: 'standard',
      creditedInvoiceId: null,
      invoiceNumber: '20260003',
      status: 'sent',
      totalGrossCents: 20_000,
      invoiceDate: '2026-06-15',
      customerId: 'customer-2',
    });

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          customerId: 'customer-1',
          limit: 1,
          offset: 1,
        }),
      ),
    ).resolves.toMatchObject({
      groups: [{ rootInvoice: { id: 'invoice-1' } }],
      totalCount: 2,
    });
  });

  it('preserves full-credit status inside a customer-filtered group', async () => {
    insertInvoiceClone(database, {
      id: 'credit-full',
      sourceDraftId: 'credit-draft-full',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 35_100,
      invoiceDate: '2026-06-14',
      customerId: 'customer-1',
    });

    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({
          customerId: 'customer-1',
          creditState: 'credited',
        }),
      ),
    ).resolves.toMatchObject({
      groups: [
        {
          rootInvoice: { id: 'invoice-1' },
          creditInvoices: [{ id: 'credit-full' }],
          creditStatus: 'full',
          remainingCreditableGrossCents: 0,
        },
      ],
      totalCount: 1,
    });
  });

  it('does not return sent invoice groups outside the company scope', async () => {
    await expect(
      reader.listSentInvoiceGroups(
        createSentInvoiceGroupQuery({ companyId: 'other-company' }),
      ),
    ).resolves.toEqual({ groups: [], totalCount: 0 });
  });
});

function insertSentRoot(
  database: DatabaseConnection,
  id: string,
  sourceDraftId: string,
  invoiceNumber: string,
  invoiceDate: string,
): void {
  insertInvoiceClone(database, {
    id,
    sourceDraftId,
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    invoiceNumber,
    status: 'sent',
    totalGrossCents: 20_000,
    invoiceDate,
  });
}
