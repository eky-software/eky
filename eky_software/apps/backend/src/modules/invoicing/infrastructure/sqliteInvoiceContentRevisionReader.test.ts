import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  historicalDatabase,
  insert,
  migrate,
  removeDirectories,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision, InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import {
  approvalContentFields,
  createApprovalRevisionFixture,
  createReverseChargeRevisionDraft,
  createRevisionDraft,
  createRevisionLine,
  readApprovalState,
  revisionApprovalInput,
} from './invoiceApprovalRevision.fixture.js';
import {
  createLegacyCreditRevisionSource,
  createSentRevisionSource,
  creditApprovalInput,
  persistRevisionCreditDraft,
  readCreditRevision,
  type ApprovalFixture,
} from './invoiceCreditRevision.fixture.js';
import {
  bypassReaderFixtureConstraints,
  corruptStoredReaderRow,
  deleteStoredReaderRows,
  headerFields,
  lineFields,
  readerScope,
  totalChanges,
  type StoredValues,
} from './sqliteInvoiceContentRevisionReader.fixture.js';
import { SqliteInvoiceContentRevisionReader } from './sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceCreditApprovalRepository } from './sqliteInvoiceCreditApprovalRepository.js';

afterAll(removeDirectories);

function expectFullMapping(
  result: InvoiceContentRevision | undefined,
  stored: ReturnType<typeof readCreditRevision>,
) {
  const { header, lines, vat } = stored;
  expect(result).toStrictEqual({
    ...Object.fromEntries(headerFields.map(([column, property]) => [property, header[column]])),
    companyId: header.company_id,
    invoiceId: header.invoice_id,
    revisionId: header.id,
    creditedRevisionId: header.credited_revision_id,
    creditedInvoiceNumberSnapshot: header.credited_invoice_number_snapshot,
    creditedInvoiceDateSnapshot: header.credited_invoice_date_snapshot,
    origin: header.origin,
    vatBreakdownState: header.vat_breakdown_state,
    vatBreakdown: header.origin === 'legacySnapshot' ? null : vat.map((group) => ({
      vatRateBasisPoints: group.vat_rate_basis_points,
      netCents: group.net_cents, vatCents: group.vat_cents, grossCents: group.gross_cents,
    })),
    lines: lines.map((line) => ({
      ...Object.fromEntries(lineFields.map(([column, property]) => [property, line[column]])),
      sourceRevisionId: line.source_revision_id,
    })),
  });
}

describe('SqliteInvoiceContentRevisionReader', () => {
  let database: DatabaseConnection;
  let fixture: ApprovalFixture;
  let reader: SqliteInvoiceContentRevisionReader;
  let statements: string[];

  beforeEach(async () => {
    statements = [];
    database = new Database(':memory:', { verbose: (sql) => statements.push(String(sql)) });
    fixture = await createApprovalRevisionFixture(database);
    reader = new SqliteInvoiceContentRevisionReader(database);
  });

  afterEach(() => database.close());

  async function approve(draft = createRevisionDraft()): Promise<InvoiceRevisionKey> {
    await fixture.drafts.saveDraft(draft);
    await expect(fixture.repository.approveDraft(revisionApprovalInput({
      companyId: draft.companyId, draftId: draft.id,
      reverseChargeEligibilityConfirmed: draft.taxTreatment === 'reverseChargeConstruction',
    }))).resolves.toMatchObject({ invoiceId: readerScope.invoiceId });
    return { ...readerScope, revisionId: readCreditRevision(database, readerScope.invoiceId).header.id };
  }

  async function approveCredit(): Promise<InvoiceRevisionKey> {
    const source = await createSentRevisionSource(database, fixture);
    await persistRevisionCreditDraft(database, source, [
      { lineType: 'source', sourceInvoiceLineId: 'revision-line-1', description: 'Historical source', quantityHundredths: 50 },
      { lineType: 'manual', description: 'Independent adjustment', quantityHundredths: 100, unit: 'kpl', unitPriceCents: 100, vatRateBasisPoints: 2550 },
    ]);
    await expect(new SqliteInvoiceCreditApprovalRepository(database)
      .approveCreditDraft(creditApprovalInput())).resolves.toMatchObject({ outcome: 'approved' });
    const invoiceId = creditApprovalInput().invoiceId;
    return { companyId: readerScope.companyId, invoiceId, revisionId: readCreditRevision(database, invoiceId).header.id };
  }

  async function expectIntegrityFailure(key: InvoiceRevisionKey) {
    const before = readApprovalState(database);
    const changes = totalChanges(database);
    await expect(reader.getRevision(key)).rejects.toThrow(InvoiceContentRevisionIntegrityError);
    await expect(reader.getCurrentRevision(key)).rejects.toThrow(InvoiceContentRevisionIntegrityError);
    expect(totalChanges(database)).toBe(changes);
    expect(readApprovalState(database)).toStrictEqual(before);
    expect(database.inTransaction).toBe(false);
  }

  it('maps every one of the 64 header and 18 original line fields independently without live fields', async () => {
    const key = await approve();
    const stored = readCreditRevision(database, key.invoiceId);
    expect(headerFields).toHaveLength(64);
    expect(new Set(headerFields.map(([, property]) => property)).size).toBe(64);
    expect(headerFields.map(([column]) => column).sort()).toEqual([...approvalContentFields].sort());
    expect(lineFields).toHaveLength(18);
    expect(database.prepare<[], { name: string }>('PRAGMA table_info(invoice_lines)').all()
      .map(({ name }) => name === 'id' ? 'line_id' : name).sort())
      .toEqual(lineFields.map(([column]) => column).sort());
    const current = await reader.getCurrentRevision(readerScope);
    expectFullMapping(current, stored);
    expectFullMapping(await reader.getRevision(key), stored);
    expect(current?.lines.map(({ discountType, discountValue }) => [discountType, discountValue]))
      .toEqual([['none', 0], ['percentage', 725], ['fixed', 127]]);
    expect(current?.createdAt).toBe(revisionApprovalInput().approvedAt);
    expect(current?.lines.map(({ createdAt }) => createdAt))
      .toEqual(Array(3).fill(revisionApprovalInput().approvedAt));
    for (const field of ['status', 'updatedAt', 'paymentState', 'paidOn', 'paidAmountCents', 'cancelledAt', 'totals']) {
      expect(current).not.toHaveProperty(field);
    }
  });

  it.each(['net', 'gross'] as const)('reads stored %s grouped rounding, never the sum of line VAT', async (priceInputMode) => {
    const key = await approve(createRevisionDraft({ priceInputMode }, [
      createRevisionLine('z-first', 1, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
      createRevisionLine('a-second', 2, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
    ]));
    const revision = await reader.getRevision(key);
    expect(revision?.lines.map(({ lineId }) => lineId)).toEqual(['z-first', 'a-second']);
    expect(revision).toMatchObject(priceInputMode === 'net'
      ? { totalNetCents: 4, totalVatCents: 1, totalGrossCents: 5 }
      : { totalNetCents: 3, totalVatCents: 1, totalGrossCents: 4 });
    expect(revision?.vatBreakdown).toStrictEqual([{
      vatRateBasisPoints: 2550,
      netCents: priceInputMode === 'net' ? 4 : 3,
      vatCents: 1, grossCents: priceInputMode === 'net' ? 5 : 4,
    }]);
    expect(revision?.lines.reduce((sum, line) => sum + line.vatCents, 0)).not.toBe(1);
  });

  it('distinguishes authoritative reverse-charge [] and null rates from unavailable legacy VAT', async () => {
    const key = await approve(createReverseChargeRevisionDraft());
    const result = await reader.getRevision(key);
    expectFullMapping(result, readCreditRevision(database, key.invoiceId));
    expect(result).toMatchObject({
      origin: 'approval', vatBreakdownState: 'authoritative', vatBreakdown: [],
      totalVatCents: 0, performanceDate: null,
      performancePeriodStart: '2027-01-01', performancePeriodEnd: '2027-01-14',
    });
    expect(result?.lines[0]?.vatRateBasisPoints).toBeNull();
    expect(result?.totalNetCents).toBe(result?.totalGrossCents);
  });

  it('reads the validated legacy authoritative variant without upgrading its origin', async () => {
    const key = await approve();
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: key.revisionId }, { origin: 'validatedLegacySnapshot' });
    const result = await reader.getRevision(key);
    expectFullMapping(result, readCreditRevision(database, key.invoiceId));
    expect(result).toMatchObject({ origin: 'validatedLegacySnapshot', vatBreakdownState: 'authoritative' });
  });

  it('retains old exact content through reopen and reapproval without choosing latest', async () => {
    const oldKey = await approve();
    const original = await reader.getRevision(oldKey);
    await fixture.repository.reopenApprovedInvoiceForEditing({
      ...readerScope, actorUserId: 'revision-actor', auditEventId: 'reader-reopen',
      reopenedAt: '2027-01-16T08:00:00.000Z',
    });
    // Reader contract only: model the new reopen pointer removal independently of caller wiring.
    database.prepare('DELETE FROM invoice_current_revisions WHERE company_id = ? AND invoice_id = ?')
      .run(readerScope.companyId, readerScope.invoiceId);
    await expect(reader.getCurrentRevision(readerScope)).resolves.toBeUndefined();
    await expect(reader.getRevision(oldKey)).resolves.toStrictEqual(original);
    const edited = createRevisionDraft({ subject: 'Reapproved content', performancePeriod: { type: 'invoiceDate' } }, [
      createRevisionLine('revision-line-1', 1, { unitPriceCents: 8765 }),
    ]);
    await fixture.drafts.updateDraft(edited);
    fixture.snapshot.companyName = 'Changed synthetic master data';
    await fixture.repository.approveDraft(revisionApprovalInput({
      invoiceId: 'unused-new-id', auditEventId: 'reader-reapproval', approvedAt: '2027-01-16T12:00:00.000Z',
    }));
    const current = await reader.getCurrentRevision(readerScope);
    expect(current?.revisionId).not.toBe(oldKey.revisionId);
    expect(current).toMatchObject({
      subject: edited.subject, companyNameSnapshot: fixture.snapshot.companyName,
      createdAt: original?.createdAt, approvedAt: '2027-01-16T12:00:00.000Z',
      performanceDate: null, performancePeriodStart: null, performancePeriodEnd: null,
    });
    expect(current?.lines[0]).toMatchObject({ lineId: 'revision-line-1', unitPriceCents: 8765, createdAt: '2027-01-16T12:00:00.000Z' });
    await expect(reader.getRevision(oldKey)).resolves.toStrictEqual(original);
    // A deliberately older pointer must win over any ORDER BY approved_at/latest shortcut.
    database.prepare('UPDATE invoice_current_revisions SET revision_id = ? WHERE company_id = ? AND invoice_id = ?')
      .run(oldKey.revisionId, readerScope.companyId, readerScope.invoiceId);
    await expect(reader.getCurrentRevision(readerScope)).resolves.toStrictEqual(original);
  });

  it('returns exact credit source IDs and snapshots without reading live source content or its current pointer', async () => {
    const key = await approveCredit();
    const stored = readCreditRevision(database, key.invoiceId);
    const expected = await reader.getRevision(key);
    expectFullMapping(expected, stored);
    const source = readCreditRevision(database, readerScope.invoiceId);
    expect(expected).toMatchObject({
      invoiceKind: 'credit', creditedInvoiceId: readerScope.invoiceId,
      creditedRevisionId: source.header.id,
      creditedInvoiceNumberSnapshot: '20270001', creditedInvoiceDateSnapshot: '2027-01-15',
      referenceNumber: null, referenceNumberType: null,
    });
    expect(expected?.lines.map(({ sourceInvoiceLineId, sourceRevisionId }) => [sourceInvoiceLineId, sourceRevisionId]))
      .toEqual([['revision-line-1', source.header.id], [null, null]]);
    corruptStoredReaderRow(database, 'invoices', { id: readerScope.invoiceId }, {
      subject: 'Unrelated live source', invoice_number: '20990099', invoice_date: '2099-12-31',
    });
    corruptStoredReaderRow(database, 'invoice_lines', { id: 'revision-line-1' }, { description: 'Unrelated live line', unit_price_cents: 987654 });
    deleteStoredReaderRows(database, 'invoice_current_revisions', { invoice_id: readerScope.invoiceId });
    await expect(reader.getRevision(key)).resolves.toStrictEqual(expected);
    await expect(reader.getCurrentRevision(key)).resolves.toStrictEqual(expected);
  });

  it('does not read draft, customer, company settings, live lines or recalculate content', async () => {
    const key = await approve();
    const original = await reader.getRevision(key);
    corruptStoredReaderRow(database, 'invoices', { id: key.invoiceId }, { subject: 'Live projection differs', total_gross_cents: 1 });
    corruptStoredReaderRow(database, 'invoice_lines', { id: 'revision-line-1' }, { description: 'Live line differs', unit_price_cents: 999 });
    fixture.snapshot.companyName = 'Unused master data';
    const snapshotReads = fixture.snapshotRequests.length;
    statements.length = 0;
    await expect(reader.getRevision(key)).resolves.toStrictEqual(original);
    expect(statements.join('\n')).not.toMatch(/\b(?:invoice_lines|invoice_drafts|invoice_draft_lines|customers|company_settings)\b/i);
    expect(fixture.snapshotRequests).toHaveLength(snapshotReads);
  });

  it.each([
    ['unknown company', { companyId: 'absent-company' }],
    ['foreign company', { companyId: 'foreign-company' }],
    ['unknown invoice', { invoiceId: 'absent-invoice' }],
    ['SQL company', { companyId: "revision-company' OR 1=1 --" }],
    ['SQL invoice', { invoiceId: "revision-invoice' OR 1=1 --" }],
  ] as const)('returns undefined for an absent scoped key: %s', async (_name, scopeChange) => {
    const key = await approve();
    const before = readApprovalState(database);
    await expect(reader.getCurrentRevision({ ...readerScope, ...scopeChange })).resolves.toBeUndefined();
    await expect(reader.getRevision({ ...key, ...scopeChange })).resolves.toBeUndefined();
    expect(readApprovalState(database)).toStrictEqual(before);
  });

  it('binds revision input and never replaces unknown revisions with a current one', async () => {
    const key = await approve();
    for (const revisionId of ['absent-revision', "' OR 1=1 --", "'; DROP TABLE invoices; --"]) {
      await expect(reader.getRevision({ ...key, revisionId })).resolves.toBeUndefined();
    }
    await expect(reader.getRevision(key)).resolves.toMatchObject({ revisionId: key.revisionId });
  });

  it.each(['same-company', 'foreign-company'] as const)('rejects a pointer to an existing %s invoice revision', async (owner) => {
    const key = await approve();
    const companyId = owner === 'same-company' ? readerScope.companyId : 'foreign-company';
    await fixture.drafts.saveDraft(createRevisionDraft({ id: 'other-draft', companyId }, [createRevisionLine('other-line', 1)]));
    await fixture.repository.approveDraft(revisionApprovalInput({
      companyId, draftId: 'other-draft', invoiceId: 'other-invoice', auditEventId: 'other-approved',
    }));
    const other = readCreditRevision(database, 'other-invoice', companyId);
    await expect(reader.getRevision({ ...key, revisionId: other.header.id })).resolves.toBeUndefined();
    corruptStoredReaderRow(database, 'invoice_current_revisions', { invoice_id: key.invoiceId }, { revision_id: other.header.id });
    await expect(reader.getCurrentRevision(readerScope)).rejects.toThrow(InvoiceContentRevisionIntegrityError);
    await expect(reader.getRevision(key)).resolves.toMatchObject({ revisionId: key.revisionId });
  });

  it('distinguishes no current pointer from a non-null broken pointer', async () => {
    const key = await approve();
    deleteStoredReaderRows(database, 'invoice_current_revisions', { invoice_id: key.invoiceId });
    await expect(reader.getCurrentRevision(readerScope)).resolves.toBeUndefined();
    await expect(reader.getRevision(key)).resolves.toMatchObject({ revisionId: key.revisionId });
    bypassReaderFixtureConstraints(database, 'invoice_current_revisions', () => {
      insert(database, 'invoice_current_revisions', {
        company_id: key.companyId, invoice_id: key.invoiceId, revision_id: 'missing-target',
      });
    });
    expect(database.prepare('SELECT revision_id FROM invoice_current_revisions').get()).toEqual({ revision_id: 'missing-target' });
    await expect(reader.getCurrentRevision(readerScope)).rejects.toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('rejects a deleted pointed header, without treating exact absent lookup as corruption', async () => {
    const key = await approve();
    deleteStoredReaderRows(database, 'invoice_content_revisions', { id: key.revisionId });
    await expect(reader.getRevision(key)).resolves.toBeUndefined();
    await expect(reader.getCurrentRevision(readerScope)).rejects.toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('rejects a surviving revision whose owning invoice identity is missing', async () => {
    const key = await approve();
    deleteStoredReaderRows(database, 'invoices', { id: key.invoiceId });
    await expectIntegrityFailure(key);
  });

  it.each(['invoice_revision_lines', 'invoice_revision_vat_breakdown'] as const)('rejects missing modern %s', async (table) => {
    const key = await approve();
    deleteStoredReaderRows(database, table, { revision_id: key.revisionId });
    await expectIntegrityFailure(key);
  });

  it.each([
    ['invoice_revision_lines', 'company_id'], ['invoice_revision_lines', 'invoice_id'],
    ['invoice_revision_vat_breakdown', 'company_id'], ['invoice_revision_vat_breakdown', 'invoice_id'],
  ] as const)('detects a hidden wrong-scope child in %s.%s', async (table, column) => {
    const key = await approve();
    const childKey: StoredValues = table === 'invoice_revision_lines'
      ? { revision_id: key.revisionId, line_id: 'revision-line-1' }
      : { revision_id: key.revisionId, vat_rate_basis_points: 2550 };
    corruptStoredReaderRow(database, table, childKey, { [column]: 'foreign-scope' });
    await expectIntegrityFailure(key);
  });

  const badHeaders: readonly [string, StoredValues][] = [
    ['unknown origin', { origin: 'unknown' }],
    ['unknown kind', { invoice_kind: 'debit' }],
    ['unknown numbering', { numbering_mode: 'latest' }],
    ['unknown price mode', { price_input_mode: 'automatic' }],
    ['unknown tax treatment', { tax_treatment: 'vatExempt' }],
    ['unknown VAT availability', { vat_breakdown_state: 'derived' }],
    ['modern unavailable VAT', { vat_breakdown_state: 'unavailable' }],
    ['legacy authoritative VAT', { origin: 'legacySnapshot' }],
    ['empty source ID', { source_draft_id: '' }],
    ['blank customer ID', { customer_id: ' ' }],
    ['empty optional recipient ID', { billing_recipient_customer_id: '' }],
    ['zero sequence', { sequence_number: 0 }],
    ['fractional sequence', { sequence_number: 1.25 }],
    ['unsafe total', { total_net_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative total', { total_vat_cents: -1 }],
    ['non-numeric total', { total_gross_cents: 'invalid' }],
    ['unsafe term', { payment_term_days: Number.MAX_SAFE_INTEGER + 1 }],
    ['out-of-range reminder', { reminder_period_days: 366 }],
    ['out-of-range interest', { late_payment_interest_basis_points: 100001 }],
    ['missing reference type', { reference_number_type: null }],
    ['missing reference number', { reference_number: null }],
    ['unknown reference type', { reference_number_type: 'rf' }],
    ['partial performance range', { performance_date: null, performance_period_start: '2027-01-01' }],
    ['overlapping date variants', { performance_period_start: '2027-01-01', performance_period_end: '2027-01-02' }],
    ['reversed performance range', { performance_date: null, performance_period_start: '2027-01-14', performance_period_end: '2027-01-01' }],
    ['invalid performance date', { performance_date: '2027-02-30' }],
    ['standard with source revision', { credited_revision_id: 'unrelated-source' }],
    ['header total differs', { total_gross_cents: 42 }],
    ['normal VAT with reverse label', { tax_treatment_label_snapshot: 'unexpected' }],
  ];

  it.each(badHeaders)('rejects stored header corruption: %s', async (_name, values) => {
    const key = await approve();
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: key.revisionId }, values);
    await expectIntegrityFailure(key);
  });

  const badLines: readonly [string, StoredValues][] = [
    ['empty line ID', { line_id: '' }],
    ['blank description', { description: ' ' }],
    ['blank unit', { unit: ' ' }],
    ['long unit', { unit: '123456789' }],
    ['zero order', { line_order: 0 }],
    ['fractional quantity', { quantity_hundredths: 0.5 }],
    ['unsafe quantity', { quantity_hundredths: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative price', { unit_price_cents: -1 }],
    ['unsafe money', { gross_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ['unknown discount', { discount_type: 'coupon' }],
    ['unsafe discount', { discount_value: Number.MAX_SAFE_INTEGER + 1 }],
    ['normal VAT null rate', { vat_rate_basis_points: null }],
    ['negative VAT rate', { vat_rate_basis_points: -1 }],
    ['source line without revision', { source_invoice_line_id: 'source-line' }],
    ['source revision without line', { source_revision_id: 'source-revision' }],
    ['standard source binding', { source_invoice_line_id: 'source-line', source_revision_id: 'source-revision' }],
  ];

  it.each(badLines)('rejects stored line corruption: %s', async (_name, values) => {
    const key = await approve();
    corruptStoredReaderRow(database, 'invoice_revision_lines', { revision_id: key.revisionId, line_id: 'revision-line-1' }, values);
    await expectIntegrityFailure(key);
  });

  it.each<[string, StoredValues]>([
    ['unknown rate coverage', { vat_rate_basis_points: 1400 }],
    ['unsafe group money', { net_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-numeric group money', { net_cents: 'invalid' }],
    ['broken group arithmetic', { gross_cents: 999 }],
    ['group totals differ from header', { net_cents: 100, vat_cents: 25, gross_cents: 125 }],
  ])('rejects stored VAT corruption: %s', async (_name, values) => {
    const key = await approve();
    corruptStoredReaderRow(database, 'invoice_revision_vat_breakdown', { revision_id: key.revisionId, vat_rate_basis_points: 2550 }, values);
    await expectIntegrityFailure(key);
  });

  it.each(['unexpected group', 'nonzero tax', 'nonnull rate'] as const)('rejects reverse charge corruption: %s', async (variant) => {
    const key = await approve(createReverseChargeRevisionDraft());
    if (variant === 'unexpected group') {
      bypassReaderFixtureConstraints(database, 'invoice_revision_vat_breakdown', () => {
        insert(database, 'invoice_revision_vat_breakdown', {
          company_id: key.companyId, invoice_id: key.invoiceId, revision_id: key.revisionId,
          vat_rate_basis_points: 2550, net_cents: 0, vat_cents: 0, gross_cents: 0,
        });
      });
      expect(database.prepare('SELECT * FROM invoice_revision_vat_breakdown').all()).toHaveLength(1);
    } else {
      corruptStoredReaderRow(database, 'invoice_revision_lines', { revision_id: key.revisionId, line_id: 'reverse-line-1' },
        variant === 'nonzero tax' ? { vat_cents: 1 } : { vat_rate_basis_points: 0 });
    }
    await expectIntegrityFailure(key);
  });

  it.each<[string, StoredValues]>([
    ['missing source revision', { credited_revision_id: 'absent-revision' }],
    ['missing source invoice', { credited_invoice_id: 'absent-invoice' }],
    ['wrong source number', { credited_invoice_number_snapshot: '20990099' }],
    ['wrong source date', { credited_invoice_date_snapshot: '2099-12-31' }],
    ['partial credit binding', { credited_revision_id: null }],
    ['partial credit number', { credited_invoice_number_snapshot: null }],
    ['partial credit date', { credited_invoice_date_snapshot: null }],
  ])('rejects credit header source corruption: %s', async (_name, values) => {
    const key = await approveCredit();
    corruptStoredReaderRow(database, 'invoice_content_revisions', { id: key.revisionId }, values);
    await expectIntegrityFailure(key);
  });

  it.each(['deleted source header', 'deleted source identity', 'deleted source line', 'foreign source line', 'wrong source invoice', 'different source revision'] as const)(
    'rejects exact credit reference corruption: %s', async (variant) => {
      const key = await approveCredit();
      const source = readCreditRevision(database, readerScope.invoiceId);
      if (variant === 'deleted source header') {
        deleteStoredReaderRows(database, 'invoice_content_revisions', { id: source.header.id });
      } else if (variant === 'deleted source identity') {
        deleteStoredReaderRows(database, 'invoices', { id: readerScope.invoiceId });
      } else if (variant === 'deleted source line') {
        deleteStoredReaderRows(database, 'invoice_revision_lines', { revision_id: source.header.id, line_id: 'revision-line-1' });
      } else if (variant === 'different source revision') {
        const creditLine = readCreditRevision(database, key.invoiceId).lines.find((line) => line.source_invoice_line_id !== null)!;
        corruptStoredReaderRow(database, 'invoice_revision_lines', { revision_id: key.revisionId, line_id: creditLine.line_id }, { source_revision_id: key.revisionId });
      } else {
        corruptStoredReaderRow(database, 'invoice_revision_lines', { revision_id: source.header.id, line_id: 'revision-line-1' },
          variant === 'foreign source line' ? { company_id: 'foreign-company' } : { invoice_id: 'another-invoice' });
      }
      await expectIntegrityFailure(key);
    },
  );

  it('isolates caller mutation and never writes on successful or absent reads', async () => {
    const key = await approve();
    const before = readApprovalState(database);
    const changes = totalChanges(database);
    database.pragma('query_only = ON');
    const result = await reader.getRevision(key);
    if (result === undefined || result.vatBreakdown === null) throw new Error('Modern fixture missing.');
    const original = structuredClone(result);
    // Both detached mutable objects and runtime-frozen values satisfy read isolation.
    Reflect.set(result, 'subject', 'Caller mutation');
    Reflect.set(result.lines[0]!, 'description', 'Caller line mutation');
    Reflect.set(result.vatBreakdown[0]!, 'netCents', 999);
    Reflect.set(result.lines, 'length', 0);
    Reflect.set(result.vatBreakdown, 'length', 0);
    statements.length = 0;
    await expect(reader.getRevision(key)).resolves.toStrictEqual(original);
    await expect(reader.getCurrentRevision(readerScope)).resolves.toStrictEqual(original);
    await expect(reader.getRevision({ ...key, revisionId: 'absent' })).resolves.toBeUndefined();
    expect(statements.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP)\b/i);
    expect(totalChanges(database)).toBe(changes);
    expect(readApprovalState(database)).toStrictEqual(before);
    expect(database.inTransaction).toBe(false);
  });
});

describe('exact revision reader legacy migration and disk persistence', () => {
  it('preserves migrated inconsistent header and line totals without recalculating VAT', async () => {
    const database = await historicalDatabase();
    database.prepare("UPDATE invoices SET total_net_cents = 111, total_vat_cents = 22, total_gross_cents = 999 WHERE id = 'invoice-1'").run();
    database.prepare("UPDATE invoice_lines SET net_cents = 77, vat_cents = 3, gross_cents = 444 WHERE id = 'line-1'").run();
    await migrate(database);
    const stored = readCreditRevision(database, 'invoice-1', 'dev-company');
    const reader = new SqliteInvoiceContentRevisionReader(database);
    const scope = { companyId: 'dev-company', invoiceId: 'invoice-1' };
    const before = readApprovalState(database);
    const result = await reader.getCurrentRevision(scope);
    expectFullMapping(result, stored);
    expect(result).toMatchObject({
      origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null,
      totalNetCents: 111, totalVatCents: 22, totalGrossCents: 999,
    });
    expect(result?.lines[0]).toMatchObject({ netCents: 77, vatCents: 3, grossCents: 444 });
    expect(readApprovalState(database)).toStrictEqual(before);
    await expect(reader.getRevision({ ...scope, revisionId: stored.header.id })).resolves.toStrictEqual(result);
  });

  it('allows an empty historical collection and keeps VAT unavailable', async () => {
    const database = await historicalDatabase();
    database.prepare("DELETE FROM invoice_lines WHERE invoice_id = 'invoice-1'").run();
    await migrate(database);
    await expect(new SqliteInvoiceContentRevisionReader(database)
      .getCurrentRevision({ companyId: 'dev-company', invoiceId: 'invoice-1' })).resolves.toMatchObject({
      origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null, lines: [],
    });
  });

  it('reads a modern credit bound to a legacy-unavailable source without upgrading that source', async () => {
    const { database, source } = await createLegacyCreditRevisionSource();
    const reader = new SqliteInvoiceContentRevisionReader(database);
    const sourceScope = { companyId: source.companyId, invoiceId: source.id };
    const original = await reader.getCurrentRevision(sourceScope);
    await persistRevisionCreditDraft(database, source);
    await expect(new SqliteInvoiceCreditApprovalRepository(database).approveCreditDraft(creditApprovalInput({
      companyId: source.companyId,
    }))).resolves.toMatchObject({ outcome: 'approved' });
    const credit = await reader.getCurrentRevision({ companyId: source.companyId, invoiceId: creditApprovalInput().invoiceId });
    expect(credit).toMatchObject({
      origin: 'approval', vatBreakdownState: 'authoritative', creditedRevisionId: original?.revisionId,
      totalNetCents: 4, totalVatCents: 1, totalGrossCents: 5,
      vatBreakdown: [{ vatRateBasisPoints: 2550, netCents: 4, vatCents: 1, grossCents: 5 }],
    });
    expect(original).toMatchObject({ origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null });
    await expect(reader.getCurrentRevision(sourceScope)).resolves.toStrictEqual(original);
  });

  it('rejects stored VAT groups for a legacy-unavailable revision instead of hiding them', async () => {
    const { database } = await createLegacyCreditRevisionSource();
    const stored = readCreditRevision(database, 'invoice-1', 'dev-company');
    bypassReaderFixtureConstraints(database, 'invoice_revision_vat_breakdown', () => {
      insert(database, 'invoice_revision_vat_breakdown', {
        company_id: 'dev-company', invoice_id: 'invoice-1', revision_id: stored.header.id,
        vat_rate_basis_points: 2550, net_cents: 4, vat_cents: 1, gross_cents: 5,
      });
    });
    expect(database.prepare('SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ?').all(stored.header.id)).toHaveLength(1);
    await expect(new SqliteInvoiceContentRevisionReader(database).getCurrentRevision({ companyId: 'dev-company', invoiceId: 'invoice-1' }))
      .rejects.toThrow(InvoiceContentRevisionIntegrityError);
  });

  it('retains exact old and current revisions after closing and reopening the real database file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-exact-revision-reader-'));
    const path = join(root, 'synthetic.sqlite');
    let database: DatabaseConnection | undefined;
    try {
      database = new Database(path);
      const fixture = await createApprovalRevisionFixture(database);
      await fixture.drafts.saveDraft(createRevisionDraft());
      await fixture.repository.approveDraft(revisionApprovalInput());
      const old = await new SqliteInvoiceContentRevisionReader(database).getCurrentRevision(readerScope);
      if (old === undefined) throw new Error('Initial revision missing.');
      await fixture.repository.reopenApprovedInvoiceForEditing({
        ...readerScope, actorUserId: 'revision-actor', auditEventId: 'disk-reopen', reopenedAt: '2027-01-16T08:00:00.000Z',
      });
      await fixture.drafts.updateDraft(createRevisionDraft({ subject: 'Persistent current content' }));
      await fixture.repository.approveDraft(revisionApprovalInput({ auditEventId: 'disk-reapproval', approvedAt: '2027-01-16T12:00:00.000Z' }));
      const current = await new SqliteInvoiceContentRevisionReader(database).getCurrentRevision(readerScope);
      expect(current?.revisionId).not.toBe(old.revisionId);
      const before = readApprovalState(database);
      database.close();
      database = new Database(path, { readonly: true, fileMustExist: true });
      const reader = new SqliteInvoiceContentRevisionReader(database);
      await expect(reader.getCurrentRevision(readerScope)).resolves.toStrictEqual(current);
      await expect(reader.getRevision({ ...readerScope, revisionId: old.revisionId })).resolves.toStrictEqual(old);
      expect(readApprovalState(database)).toStrictEqual(before);
      expect(totalChanges(database)).toBe(0);
    } finally {
      if (database?.open) database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
