import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  createInvoiceReadModelTestDatabase,
  insertActiveCreditDraft,
  insertInvoiceClone,
  markInvoiceSent,
} from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteInvoiceCreditContextReader } from './sqliteInvoiceCreditContextReader.js';

describe('SqliteInvoiceCreditContextReader', () => {
  let database: DatabaseConnection;
  let reader: SqliteInvoiceCreditContextReader;

  beforeEach(async () => {
    database = await createInvoiceReadModelTestDatabase();
    reader = new SqliteInvoiceCreditContextReader(database);
  });

  afterEach(() => {
    database.close();
  });

  it('returns context only for a sent standard source invoice', async () => {
    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toBeUndefined();

    markInvoiceSent(database, 'invoice-1');

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      sourceInvoiceId: 'invoice-1',
      creditInvoices: [],
      creditStatus: 'none',
      remainingCreditableGrossCents: 35_100,
      activeCreditDraftId: null,
    });
  });

  it('returns the active credit draft and approved and sent allocations', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-approved',
      sourceDraftId: 'credit-draft-approved',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'approved',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });
    insertInvoiceClone(database, {
      id: 'credit-sent',
      sourceDraftId: 'credit-draft-sent',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260003',
      status: 'sent',
      totalGrossCents: 5_000,
      invoiceDate: '2026-06-15',
    });
    insertActiveCreditDraft(database, {
      id: 'credit-draft-active',
      creditedInvoiceId: 'invoice-1',
    });

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      creditInvoices: [
        { id: 'credit-approved', status: 'approved' },
        { id: 'credit-sent', status: 'sent' },
      ],
      creditStatus: 'partial',
      remainingCreditableGrossCents: 20_100,
      activeCreditDraftId: 'credit-draft-active',
    });
  });

  it('derives full allocation when credits consume the remaining gross amount', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-full',
      sourceDraftId: 'credit-draft-full',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'approved',
      totalGrossCents: 35_100,
      invoiceDate: '2026-06-14',
    });

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'invoice-1'),
    ).resolves.toMatchObject({
      creditStatus: 'full',
      remainingCreditableGrossCents: 0,
    });
  });

  it('does not reveal credit context outside the company scope', async () => {
    markInvoiceSent(database, 'invoice-1');

    await expect(
      reader.getInvoiceCreditContext('other-company', 'invoice-1'),
    ).resolves.toBeUndefined();
  });

  it('rejects a sent credit invoice as a credit context source', async () => {
    markInvoiceSent(database, 'invoice-1');
    insertInvoiceClone(database, {
      id: 'credit-source',
      sourceDraftId: 'credit-source-draft',
      invoiceKind: 'credit',
      creditedInvoiceId: 'invoice-1',
      invoiceNumber: '20260002',
      status: 'sent',
      totalGrossCents: 10_000,
      invoiceDate: '2026-06-14',
    });

    await expect(
      reader.getInvoiceCreditContext('dev-company', 'credit-source'),
    ).resolves.toBeUndefined();
  });
});
