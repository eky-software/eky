import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
} from '../../../database/schema.js';
import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type {
  InvoiceDraft,
  InvoiceDraftLine,
} from '../domain/invoiceDraft.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
import { SqliteInvoiceDraftRepository } from './sqliteInvoiceDraftRepository.js';

const migrationSql = readFileSync(
  new URL(
    '../../../database/migrations/006_create_invoice_drafts.sql',
    import.meta.url,
  ),
  'utf8',
);

function createLine(
  id: string,
  position: number,
  vatRateBasisPoints: number,
  discount: InvoiceLineDiscount = { type: 'none' },
): InvoiceDraftLine {
  const calculatedLine = calculateInvoiceLine({
    quantityHundredths: position === 1 ? 150 : 100,
    unitPriceCents: position === 1 ? 10_000 : 1000,
    vatRateBasisPoints,
    priceInputMode: 'net',
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
  lineOverrides?: InvoiceDraftLine[],
  draftOverrides: Partial<Omit<InvoiceDraft, 'lines' | 'totals'>> = {},
): InvoiceDraft {
  const lines = lineOverrides ?? [
    createLine('line-1', 1, 2550),
    createLine('line-2', 2, 1350),
  ];

  return {
    id: 'draft-1',
    companyId: 'dev-company',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    priceInputMode: 'net',
    subject: 'Test invoice',
    orderNumber: '',
    note: '',
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...draftOverrides,
    lines,
    totals: calculateInvoiceTotals(lines),
  };
}

describe('SqliteInvoiceDraftRepository', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec(migrationSql);
  });

  afterEach(() => {
    database.close();
  });

  it('saves the draft header and ordered lines with domain-calculated amounts', async () => {
    const draft = createDraft();
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(draft);

    const storedDraft = database
      .prepare<[], InvoiceDraftTable>('SELECT * FROM invoice_drafts')
      .get();
    const storedLines = database
      .prepare<[], InvoiceDraftLineTable>(
        'SELECT * FROM invoice_draft_lines ORDER BY position',
      )
      .all();

    expect(storedDraft).toMatchObject({
      id: 'draft-1',
      company_id: 'dev-company',
      customer_id: 'customer-1',
      status: 'draft',
      net_total_cents: draft.totals.netTotalCents,
      vat_total_cents: draft.totals.vatTotalCents,
      gross_total_cents: draft.totals.grossTotalCents,
    });
    expect(storedLines.map((line) => line.position)).toEqual([1, 2]);
    expect(storedLines.map((line) => line.vat_rate_basis_points)).toEqual([
      2550,
      1350,
    ]);
    expect(storedLines[0]).toMatchObject({
      base_cents: draft.lines[0]?.baseCents,
      discount_cents: draft.lines[0]?.discountCents,
      net_cents: draft.lines[0]?.netCents,
      vat_cents: draft.lines[0]?.vatCents,
      gross_cents: draft.lines[0]?.grossCents,
    });
  });

  it('rolls back the whole draft when a line insert fails', async () => {
    const duplicateLineId = 'duplicate-line';
    const draft = createDraft([
      createLine(duplicateLineId, 1, 2550),
      createLine(duplicateLineId, 2, 1350),
    ]);
    const repository = new SqliteInvoiceDraftRepository(database);

    await expect(repository.saveDraft(draft)).rejects.toThrow();

    const draftCount = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_drafts',
      )
      .get();
    const lineCount = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_draft_lines',
      )
      .get();

    expect(draftCount?.count).toBe(0);
    expect(lineCount?.count).toBe(0);
  });

  it('deletes a company draft and its lines through the foreign key cascade', async () => {
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(createDraft());

    await expect(
      repository.deleteDraft('dev-company', 'draft-1'),
    ).resolves.toBe(true);
    await expect(
      repository.getDraftById('dev-company', 'draft-1'),
    ).resolves.toBeUndefined();

    const lineCount = database
      .prepare<[], { count: number }>(
        'SELECT COUNT(*) AS count FROM invoice_draft_lines',
      )
      .get();

    expect(lineCount?.count).toBe(0);
  });

  it('does not delete a draft outside the company scope', async () => {
    const draft = createDraft();
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(draft);

    await expect(
      repository.deleteDraft('other-company', 'draft-1'),
    ).resolves.toBe(false);
    await expect(
      repository.deleteDraft('dev-company', "draft-1' OR 1=1 --"),
    ).resolves.toBe(false);
    await expect(
      repository.getDraftById('dev-company', 'draft-1'),
    ).resolves.toEqual(draft);
  });

  it('updates a company draft and replaces its lines in one transaction', async () => {
    const originalDraft = createDraft();
    const updatedLines = [
      createLine('new-line-1', 1, 0),
      createLine(
        'new-line-2',
        2,
        2550,
        { type: 'percentage', basisPoints: 500 },
      ),
    ];
    const updatedDraft = createDraft(updatedLines, {
      customerId: 'customer-2',
      invoiceDate: '2026-06-14',
      dueDate: '2026-07-14',
      paymentTermDays: 30,
      priceInputMode: 'net',
      subject: 'Updated invoice',
      createdAt: originalDraft.createdAt,
      updatedAt: '2026-06-14T12:00:00.000Z',
    });
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(originalDraft);

    await expect(repository.updateDraft(updatedDraft)).resolves.toEqual(
      updatedDraft,
    );

    const storedDraft = await repository.getDraftById(
      'dev-company',
      'draft-1',
    );
    const storedHeader = database
      .prepare<[string], InvoiceDraftTable>(
        'SELECT * FROM invoice_drafts WHERE id = ?',
      )
      .get('draft-1');

    expect(storedDraft).toEqual(updatedDraft);
    expect(storedDraft?.lines.map((line) => line.id)).toEqual([
      'new-line-1',
      'new-line-2',
    ]);
    expect(storedDraft?.lines.map((line) => line.position)).toEqual([1, 2]);
    expect(storedHeader).toMatchObject({
      customer_id: 'customer-2',
      subject: 'Updated invoice',
      created_at: originalDraft.createdAt,
      updated_at: '2026-06-14T12:00:00.000Z',
      net_total_cents: updatedDraft.totals.netTotalCents,
      vat_total_cents: updatedDraft.totals.vatTotalCents,
      gross_total_cents: updatedDraft.totals.grossTotalCents,
    });
    await expect(
      repository.listDraftSummaries('dev-company'),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'draft-1',
        updatedAt: '2026-06-14T12:00:00.000Z',
      }),
    ]);
  });

  it('does not update a draft outside the company scope', async () => {
    const originalDraft = createDraft();
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(originalDraft);

    await expect(
      repository.updateDraft({
        ...originalDraft,
        companyId: 'other-company',
        subject: 'Unauthorized update',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.getDraftById('dev-company', 'draft-1'),
    ).resolves.toEqual(originalDraft);
    await expect(
      repository.updateDraft({
        ...originalDraft,
        id: "draft-1' OR 1=1 --",
        subject: 'Injected update',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.getDraftById('dev-company', 'draft-1'),
    ).resolves.toEqual(originalDraft);
  });

  it('rolls back the header and line replacement if an updated line insert fails', async () => {
    const originalDraft = createDraft();
    const duplicateLineId = 'duplicate-updated-line';
    const invalidUpdatedDraft = createDraft(
      [
        createLine(duplicateLineId, 1, 2550),
        createLine(duplicateLineId, 2, 1350),
      ],
      {
        subject: 'Update that must roll back',
        createdAt: originalDraft.createdAt,
        updatedAt: '2026-06-14T12:00:00.000Z',
      },
    );
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(originalDraft);

    await expect(
      repository.updateDraft(invalidUpdatedDraft),
    ).rejects.toThrow();
    await expect(
      repository.getDraftById('dev-company', 'draft-1'),
    ).resolves.toEqual(originalDraft);
  });

  it('gets a company-scoped draft with ordered lines and stored discounts', async () => {
    const draft = createDraft([
      createLine(
        'line-fixed',
        3,
        2550,
        { type: 'fixed', amountCents: 100 },
      ),
      createLine('line-none', 1, 0),
      createLine(
        'line-percentage',
        2,
        1350,
        { type: 'percentage', basisPoints: 500 },
      ),
    ]);
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(draft);

    const storedDraft = await repository.getDraftById(
      'dev-company',
      'draft-1',
    );

    expect(storedDraft).toBeDefined();
    expect(storedDraft?.lines.map((line) => line.position)).toEqual([
      1,
      2,
      3,
    ]);
    expect(storedDraft?.lines.map((line) => line.discount)).toEqual([
      { type: 'none' },
      { type: 'percentage', basisPoints: 500 },
      { type: 'fixed', amountCents: 100 },
    ]);
    expect(storedDraft?.totals).toEqual(draft.totals);
  });

  it('does not return a draft for another company or an unknown id', async () => {
    const repository = new SqliteInvoiceDraftRepository(database);

    await repository.saveDraft(createDraft());

    await expect(
      repository.getDraftById('other-company', 'draft-1'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getDraftById('dev-company', 'missing-draft'),
    ).resolves.toBeUndefined();
  });

  it('lists only company summaries in stable newest-first order', async () => {
    const repository = new SqliteInvoiceDraftRepository(database);
    const drafts = [
      createDraft(
        [createLine('line-old', 1, 2550)],
        {
          id: 'draft-old',
          customerId: 'customer-1',
          updatedAt: '2026-06-12T10:00:00.000Z',
        },
      ),
      createDraft(
        [createLine('line-b', 1, 1350)],
        {
          id: 'draft-b',
          customerId: 'customer-2',
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
      ),
      createDraft(
        [createLine('line-c', 1, 0)],
        {
          id: 'draft-c',
          customerId: 'customer-1',
          updatedAt: '2026-06-13T10:00:00.000Z',
        },
      ),
      createDraft(
        [createLine('line-other-company', 1, 2550)],
        {
          id: 'draft-other-company',
          companyId: 'other-company',
          customerId: 'customer-1',
          updatedAt: '2026-06-14T10:00:00.000Z',
        },
      ),
    ];

    for (const draft of drafts) {
      await repository.saveDraft(draft);
    }

    const summaries = await repository.listDraftSummaries('dev-company');

    expect(summaries.map((summary) => summary.id)).toEqual([
      'draft-c',
      'draft-b',
      'draft-old',
    ]);
    expect(summaries[0]).toEqual({
      id: 'draft-c',
      customerId: 'customer-1',
      status: 'draft',
      invoiceDate: '2026-06-13',
      dueDate: '2026-06-27',
      paymentTermDays: 14,
      priceInputMode: 'net',
      subject: 'Test invoice',
      netTotalCents: drafts[2]?.totals.netTotalCents,
      vatTotalCents: drafts[2]?.totals.vatTotalCents,
      grossTotalCents: drafts[2]?.totals.grossTotalCents,
      updatedAt: '2026-06-13T10:00:00.000Z',
    });
    expect(summaries[0]).not.toHaveProperty('lines');
    expect(summaries[0]).not.toHaveProperty('customerName');
  });

  it('filters company summaries by customer id', async () => {
    const repository = new SqliteInvoiceDraftRepository(database);
    const matchingDraft = createDraft(
      [createLine('line-matching', 1, 2550)],
      {
        id: 'draft-matching',
        customerId: 'customer-1',
      },
    );
    const otherCustomerDraft = createDraft(
      [createLine('line-other-customer', 1, 2550)],
      {
        id: 'draft-other-customer',
        customerId: 'customer-2',
      },
    );

    await repository.saveDraft(matchingDraft);
    await repository.saveDraft(otherCustomerDraft);

    await expect(
      repository.listDraftSummaries('dev-company', 'customer-1'),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'draft-matching',
        customerId: 'customer-1',
      }),
    ]);
    await expect(
      repository.listDraftSummaries('dev-company', 'unknown-customer'),
    ).resolves.toEqual([]);
    await expect(
      repository.listDraftSummaries('other-company', 'customer-1'),
    ).resolves.toEqual([]);
    await expect(
      repository.listDraftSummaries(
        'dev-company',
        "customer-1' OR 1=1 --",
      ),
    ).resolves.toEqual([]);
  });
});
