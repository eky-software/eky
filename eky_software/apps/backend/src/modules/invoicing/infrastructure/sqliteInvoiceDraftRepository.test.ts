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

function createDraft(lineOverrides?: InvoiceDraftLine[]): InvoiceDraft {
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
    lines,
    totals: calculateInvoiceTotals(lines),
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
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
});
