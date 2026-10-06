import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { InvoiceLineRow, InvoiceRow } from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type { CreditInvoiceDraftLineInput } from '../application/creditInvoiceDraftModel.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import {
  approvalContentFields,
  createApprovalRevisionFixture,
  createReverseChargeRevisionDraft,
  createRevisionDraft,
  createRevisionLine,
  liveInvoiceFields,
  readApprovalState,
  revisionApprovalInput,
} from './invoiceApprovalRevision.fixture.js';
import {
  createLegacyCreditRevisionSource,
  createSentRevisionSource,
  creditApprovalInput,
  markRevisionSourceSent,
  persistRevisionCreditDraft,
  readCreditRevision,
  readCreditSourceState,
  type ApprovalFixture,
} from './invoiceCreditRevision.fixture.js';
import { SqliteInvoiceCreditApprovalRepository } from './sqliteInvoiceCreditApprovalRepository.js';

afterAll(removeDirectories);

const partialLines: readonly CreditInvoiceDraftLineInput[] = [
  { lineType: 'source', sourceInvoiceLineId: 'revision-line-1', description: 'Partial source credit', quantityHundredths: 50 },
  { lineType: 'manual', description: 'Manual credit', quantityHundredths: 100, unit: 'kpl', unitPriceCents: 100, vatRateBasisPoints: 2550 },
];

describe('SQLite credit approval revision publication', () => {
  let database: DatabaseConnection;
  let fixture: ApprovalFixture;
  let repository: SqliteInvoiceCreditApprovalRepository;
  let statements: string[];

  beforeEach(async () => {
    statements = [];
    database = new Database(':memory:', { verbose: (sql) => statements.push(String(sql)) });
    fixture = await createApprovalRevisionFixture(database);
    repository = new SqliteInvoiceCreditApprovalRepository(database);
  });

  afterEach(() => database.close());

  it('publishes all 64 content fields and 18 line fields with exact source and manual bindings in one IMMEDIATE transaction', async () => {
    const source = await createSentRevisionSource(database, fixture);
    const original = readCreditSourceState(database, source);
    const draft = await persistRevisionCreditDraft(database, source, partialLines);
    statements.length = 0;
    const result = await repository.approveCreditDraft(creditApprovalInput());
    const approvalStatements = [...statements];
    const { header, lines, vat } = readCreditRevision(database, 'credit-revision-invoice');
    const invoice = database.prepare<[string], InvoiceRow>(
      'SELECT * FROM invoices WHERE id = ?',
    ).get(header.invoice_id);
    if (invoice === undefined) throw new Error('Published credit missing.');

    expect(result).toEqual({
      outcome: 'approved',
      invoice: {
        revisionKey: { companyId: header.company_id, invoiceId: header.invoice_id, revisionId: header.id },
        invoiceId: header.invoice_id, draftId: draft.id, invoiceNumber: '20270002',
        sequenceNumber: 2, sequenceScope: 'calendar-year:2027',
        numberingMode: 'calendarYearSequence', status: 'approved',
      },
    });
    expect(approvalContentFields).toHaveLength(64);
    expect(new Set(approvalContentFields).size).toBe(64);
    expect(database.prepare<[], { name: string }>('PRAGMA table_info(invoices)')
      .all().map((column) => column.name).sort()).toEqual([
      'id', 'company_id', ...approvalContentFields, ...liveInvoiceFields,
    ].sort());
    expect(header.id).not.toBe(original.revision.header.id);
    expect(header.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(header).toEqual({
      ...Object.fromEntries(approvalContentFields.map((field) => [field, invoice[field]])),
      id: header.id, company_id: source.companyId, invoice_id: invoice.id,
      origin: 'approval', vat_breakdown_state: 'authoritative',
      credited_revision_id: original.revision.header.id,
      credited_invoice_number_snapshot: original.revision.header.invoice_number,
      credited_invoice_date_snapshot: original.revision.header.invoice_date,
    });
    for (const field of liveInvoiceFields) expect(header).not.toHaveProperty(field);
    expect(header).toMatchObject({
      invoice_kind: 'credit', credited_invoice_id: source.id,
      reference_number: null, reference_number_type: null,
      invoice_date: draft.invoiceDate, due_date: draft.invoiceDate,
      payment_term_days: 0, reminder_period_days: 0, late_payment_interest_basis_points: 0,
      subject: draft.subject, note: draft.note, refund_iban_snapshot: draft.refundIban,
      created_at: creditApprovalInput().approvedAt, approved_at: creditApprovalInput().approvedAt,
      total_net_cents: draft.totals.netTotalCents,
      total_vat_cents: draft.totals.vatTotalCents,
      total_gross_cents: draft.totals.grossTotalCents,
    });
    const inherited = approvalContentFields.filter((field) =>
      /^(customer_|company_|billing_recipient_)/.test(field));
    for (const field of inherited) expect(header[field]).toEqual(original.revision.header[field]);
    expect(fixture.snapshotRequests).toHaveLength(1);

    const liveLines = database.prepare<[string], InvoiceLineRow>(`
      SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order
    `).all(invoice.id);
    expect(liveLines).toHaveLength(2);
    for (const line of liveLines) expect(Object.keys(line)).toHaveLength(18);
    expect(lines).toEqual(liveLines.map(({ id, ...line }) => ({
      ...line, line_id: id, company_id: source.companyId, revision_id: header.id,
      source_revision_id: line.source_invoice_line_id === null ? null : original.revision.header.id,
    })));
    expect(lines.map((line) => ({
      lineId: line.line_id, sourceLineId: line.source_invoice_line_id,
      sourceRevisionId: line.source_revision_id, createdAt: line.created_at,
    }))).toEqual(draft.lines.map((line) => ({
      lineId: line.id, sourceLineId: line.sourceInvoiceLineId,
      sourceRevisionId: line.sourceInvoiceLineId === null ? null : original.revision.header.id,
      createdAt: creditApprovalInput().approvedAt,
    })));
    expect(vat).toEqual(draft.totals.vatBreakdown.map((group) => ({
      company_id: source.companyId, invoice_id: invoice.id, revision_id: header.id,
      vat_rate_basis_points: group.vatRateBasisPoints, net_cents: group.netCents,
      vat_cents: group.vatCents, gross_cents: group.grossCents,
    })));
    expect(database.prepare('SELECT approved_invoice_id, approved_at FROM invoice_drafts WHERE id = ?').get(draft.id))
      .toEqual({ approved_invoice_id: invoice.id, approved_at: header.approved_at });
    expect(database.prepare('SELECT action FROM invoice_audit_events WHERE id = ?').get(creditApprovalInput().auditEventId))
      .toEqual({ action: 'invoice.credit_approved' });
    expect(approvalStatements[0]?.trim()).toBe('BEGIN IMMEDIATE');
    expect(approvalStatements.at(-1)?.trim()).toBe('COMMIT');
    expect(approvalStatements.filter((sql) => /^BEGIN\b/.test(sql.trim()))).toHaveLength(1);
    const headerIndex = approvalStatements.findIndex((sql) => /INSERT INTO invoice_content_revisions\b/.test(sql));
    const pointerIndex = approvalStatements.findIndex((sql) => /INSERT INTO invoice_current_revisions\b/.test(sql));
    const childIndexes = approvalStatements.flatMap((sql, index) =>
      /INSERT INTO invoice_revision_(lines|vat_breakdown)\b/.test(sql) ? [index] : []);
    expect(childIndexes).toHaveLength(lines.length + vat.length);
    for (const index of childIndexes) expect(index).toBeLessThan(headerIndex);
    expect(pointerIndex).toBeGreaterThan(headerIndex);
    expect(approvalStatements.findIndex((sql) => /INSERT INTO invoice_audit_events\b/.test(sql)))
      .toBeGreaterThan(pointerIndex);
    expect(readCreditSourceState(database, source)).toEqual(original);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['net', 'gross'] as const)('publishes authoritative %s group rounding without changing the source revision', async (priceInputMode) => {
    const source = await createSentRevisionSource(database, fixture, createRevisionDraft({ priceInputMode }, [
      createRevisionLine('rounding-source-1', 1, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
      createRevisionLine('rounding-source-2', 2, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
    ]));
    expect(source.lines.reduce((sum, line) => sum + line.vatCents, 0)).not.toBe(source.totals.vatTotalCents);
    const original = readCreditSourceState(database, source);
    await persistRevisionCreditDraft(database, source);
    await expect(repository.approveCreditDraft(creditApprovalInput())).resolves.toMatchObject({ outcome: 'approved' });
    const revision = readCreditRevision(database, 'credit-revision-invoice');
    const expected = priceInputMode === 'net'
      ? { net_cents: 4, vat_cents: 1, gross_cents: 5 }
      : { net_cents: 3, vat_cents: 1, gross_cents: 4 };
    expect(revision.vat).toEqual([{
      company_id: source.companyId, invoice_id: 'credit-revision-invoice',
      revision_id: revision.header.id, vat_rate_basis_points: 2550, ...expected,
    }]);
    expect(revision.header).toMatchObject({
      total_net_cents: expected.net_cents, total_vat_cents: expected.vat_cents,
      total_gross_cents: expected.gross_cents, credited_revision_id: original.revision.header.id,
    });
    expect(revision.lines.reduce((sum, line) => sum + line.vat_cents, 0)).toBe(1);
    expect(revision.lines.map((line) => [line.source_revision_id, line.source_invoice_line_id]))
      .toEqual(original.revision.lines.map((line) => [line.revision_id, line.line_id]));
    expect(readCreditSourceState(database, source)).toEqual(original);
  });

  it('publishes inherited reverse-charge snapshots and an authoritative empty VAT breakdown', async () => {
    const source = await createSentRevisionSource(database, fixture, createReverseChargeRevisionDraft());
    const original = readCreditSourceState(database, source);
    const draft = await persistRevisionCreditDraft(database, source);
    await expect(repository.approveCreditDraft(creditApprovalInput())).resolves.toMatchObject({ outcome: 'approved' });
    const revision = readCreditRevision(database, 'credit-revision-invoice');
    expect(revision.header).toMatchObject({
      tax_treatment: 'reverseChargeConstruction',
      tax_treatment_label_snapshot: original.revision.header.tax_treatment_label_snapshot,
      tax_legal_basis_snapshot: original.revision.header.tax_legal_basis_snapshot,
      performance_date: null, performance_period_start: '2027-01-01', performance_period_end: '2027-01-14',
      vat_breakdown_state: 'authoritative', credited_revision_id: original.revision.header.id,
      total_net_cents: draft.totals.netTotalCents, total_vat_cents: 0,
      total_gross_cents: draft.totals.netTotalCents,
    });
    expect(revision.vat).toEqual([]);
    expect(revision.lines).toHaveLength(1);
    expect(revision.lines[0]).toMatchObject({
      source_invoice_line_id: 'reverse-line-1', source_revision_id: original.revision.header.id,
      vat_rate_basis_points: null, vat_cents: 0,
      net_cents: draft.totals.netTotalCents, gross_cents: draft.totals.netTotalCents,
    });
    expect(readCreditSourceState(database, source)).toEqual(original);
  });

  it('ignores source live-content mutation after draft creation and retains immutable header and line values', async () => {
    const source = await createSentRevisionSource(database, fixture);
    const original = readCreditRevision(database, source.id);
    const draft = await persistRevisionCreditDraft(database, source);
    database.prepare(`
      UPDATE invoices SET invoice_number = '20279999', invoice_date = '2027-02-01',
        due_date = '2027-02-15', customer_name_snapshot = 'Changed live customer',
        company_name_snapshot = 'Changed live seller', billing_recipient_name_snapshot = 'Changed live recipient',
        order_number = 'CHANGED', delivery_address_text = 'Changed live address',
        price_input_mode = 'gross', performance_date = '2027-02-01',
        total_net_cents = 1000000, total_vat_cents = 255000, total_gross_cents = 1255000
      WHERE id = ?
    `).run(source.id);
    database.prepare(`
      UPDATE invoice_lines SET code = 'CHANGED', description = 'Changed live line',
        quantity_hundredths = 10000, unit = 'kpl', unit_price_cents = 99999,
        vat_rate_basis_points = 0, discount_type = 'none', discount_value = 0,
        base_cents = 99999, discount_cents = 0, net_cents = 99999, vat_cents = 0, gross_cents = 99999
      WHERE invoice_id = ?
    `).run(source.id);
    const mutated = readCreditSourceState(database, source);
    expect(mutated.revision).toEqual(original);
    await expect(repository.approveCreditDraft(creditApprovalInput())).resolves.toMatchObject({ outcome: 'approved' });
    const revision = readCreditRevision(database, 'credit-revision-invoice');
    for (const field of [
      'customer_name_snapshot', 'company_name_snapshot', 'billing_recipient_name_snapshot',
      'order_number', 'delivery_address_text', 'price_input_mode', 'performance_date',
    ] as const) expect(revision.header[field]).toEqual(original.header[field]);
    expect(revision.header).toMatchObject({
      credited_revision_id: original.header.id,
      credited_invoice_number_snapshot: original.header.invoice_number,
      credited_invoice_date_snapshot: original.header.invoice_date,
      total_net_cents: draft.totals.netTotalCents,
      total_vat_cents: draft.totals.vatTotalCents,
      total_gross_cents: draft.totals.grossTotalCents,
    });
    for (const [index, line] of revision.lines.entries()) {
      const sourceLine = original.lines[index]!;
      expect(line).toMatchObject({
        source_revision_id: original.header.id, source_invoice_line_id: sourceLine.line_id,
        code: sourceLine.code, description: sourceLine.description,
        quantity_hundredths: sourceLine.quantity_hundredths, unit: sourceLine.unit,
        unit_price_cents: sourceLine.unit_price_cents, vat_rate_basis_points: sourceLine.vat_rate_basis_points,
        discount_type: sourceLine.discount_type, discount_value: sourceLine.discount_value,
      });
    }
    expect(readCreditSourceState(database, source)).toEqual(mutated);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('binds the current source revision when older history contains the same line IDs', async () => {
    await fixture.drafts.saveDraft(createRevisionDraft());
    await fixture.repository.approveDraft(revisionApprovalInput());
    const old = readCreditRevision(database, 'revision-invoice');
    await fixture.repository.reopenApprovedInvoiceForEditing({
      companyId: 'revision-company', invoiceId: 'revision-invoice', actorUserId: 'revision-actor',
      auditEventId: 'source-reopened', reopenedAt: '2027-01-15T13:00:00.000Z',
    });
    await fixture.drafts.updateDraft(createRevisionDraft({}, [
      createRevisionLine('revision-line-1', 1, { unitPriceCents: 4321 }),
    ]));
    await fixture.repository.approveDraft(revisionApprovalInput({
      auditEventId: 'source-reapproved', approvedAt: '2027-01-15T14:00:00.000Z',
    }));
    const source = await markRevisionSourceSent(database, fixture);
    const current = readCreditRevision(database, source.id);
    expect(current.header.id).not.toBe(old.header.id);
    const before = readCreditSourceState(database, source);
    await persistRevisionCreditDraft(database, source);
    await repository.approveCreditDraft(creditApprovalInput());
    const credit = readCreditRevision(database, 'credit-revision-invoice');
    expect(credit.header.credited_revision_id).toBe(current.header.id);
    expect(credit.lines[0]).toMatchObject({
      source_invoice_line_id: 'revision-line-1', source_revision_id: current.header.id,
      unit_price_cents: 4321,
    });
    expect(database.prepare('SELECT * FROM invoice_content_revisions WHERE id = ?').get(old.header.id)).toEqual(old.header);
    expect(database.prepare('SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order').all(old.header.id))
      .toEqual(old.lines);
    expect(readCreditSourceState(database, source)).toEqual(before);
  });

  it.each(['missing-pointer', 'missing-header', 'foreign-company', 'foreign-invoice', 'missing-lines'] as const)(
    'fails closed before writes for an eligible source with %s', async (corruption) => {
      const source = await createSentRevisionSource(database, fixture);
      await persistRevisionCreditDraft(database, source);
      const current = readCreditRevision(database, source.id);
      if (corruption === 'missing-pointer') {
        database.prepare('DELETE FROM invoice_current_revisions WHERE invoice_id = ?').run(source.id);
      } else if (corruption === 'missing-lines') {
        // Simulate corrupt storage only in this isolated synthetic connection.
        database.exec('DROP TRIGGER invoice_revision_lines_delete_guard');
        database.prepare('DELETE FROM invoice_revision_lines WHERE revision_id = ?').run(current.header.id);
      } else {
        let invalidId = 'missing-revision';
        if (corruption !== 'missing-header') {
          const companyId = corruption === 'foreign-company' ? 'foreign-company' : source.companyId;
          await fixture.drafts.saveDraft(createRevisionDraft({ id: 'other-draft', companyId }, [
            createRevisionLine('other-source-line', 1),
          ]));
          await fixture.repository.approveDraft(revisionApprovalInput({
            companyId, draftId: 'other-draft', invoiceId: 'other-invoice', auditEventId: 'other-approved',
          }));
          invalidId = readCreditRevision(database, 'other-invoice', companyId).header.id;
        }
        // Bypass only the pointer FK to test the reader against pre-existing corruption.
        database.pragma('foreign_keys = OFF');
        database.prepare('UPDATE invoice_current_revisions SET revision_id = ? WHERE invoice_id = ?')
          .run(invalidId, source.id);
        database.pragma('foreign_keys = ON');
      }
      const before = readApprovalState(database);
      statements.length = 0;
      const error = await repository.approveCreditDraft(creditApprovalInput()).catch((failure: unknown) => failure);
      const attempted = [...statements];
      expect(error).toBeInstanceOf(ApproveInvoiceDraftError);
      expect(error).toMatchObject({ message: corruption === 'missing-lines'
        ? 'Credit source revision has no lines.'
        : 'Credit source revision is unavailable or inconsistent.' });
      expect(attempted.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
      expect(attempted[0]?.trim()).toBe('BEGIN IMMEDIATE');
      expect(attempted.at(-1)?.trim()).toBe('ROLLBACK');
      expect(database.inTransaction).toBe(false);
      expect(readApprovalState(database)).toEqual(before);
    },
  );

  it('rejects a credit-kind source revision even when the live source now claims standard and sent', async () => {
    const source = await createSentRevisionSource(database, fixture);
    const firstDraft = await persistRevisionCreditDraft(database, source, partialLines.slice(0, 1));
    await repository.approveCreditDraft(creditApprovalInput());
    const credit = readCreditRevision(database, 'credit-revision-invoice');
    database.prepare(`
      UPDATE invoices SET invoice_kind = 'standard', credited_invoice_id = NULL, status = 'sent'
      WHERE id = ?
    `).run(credit.header.invoice_id);
    await fixture.drafts.saveDraft({
      ...firstDraft, id: 'nested-credit-draft', creditedInvoiceId: credit.header.invoice_id,
      lines: firstDraft.lines.map((line) => ({ ...line, id: 'nested-credit-line', sourceInvoiceLineId: line.id })),
    });
    const before = readApprovalState(database);
    statements.length = 0;
    await expect(repository.approveCreditDraft(creditApprovalInput({ draftId: 'nested-credit-draft' })))
      .rejects.toThrow(new ApproveInvoiceDraftError('Credit source revision is unavailable or inconsistent.'));
    expect(statements.some((sql) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(readApprovalState(database)).toEqual(before);
  });

  it.each(['approved', 'cancelled', 'foreign-company', 'credit-kind'] as const)(
    'does not let immutable history override live source eligibility: %s', async (state) => {
      const source = await createSentRevisionSource(database, fixture);
      await persistRevisionCreditDraft(database, source);
      if (state === 'foreign-company') {
        database.pragma('foreign_keys = OFF');
        database.prepare("UPDATE invoices SET company_id = 'foreign-company' WHERE id = ?").run(source.id);
        database.pragma('foreign_keys = ON');
      } else if (state === 'credit-kind') {
        await fixture.drafts.saveDraft(createRevisionDraft({ id: 'other-draft' }, [
          createRevisionLine('other-source-line', 1),
        ]));
        await fixture.repository.approveDraft(revisionApprovalInput({
          draftId: 'other-draft', invoiceId: 'other-invoice', auditEventId: 'other-approved',
        }));
        database.prepare(`
          UPDATE invoices SET invoice_kind = 'credit', credited_invoice_id = 'other-invoice'
          WHERE id = ?
        `).run(source.id);
      } else if (state === 'cancelled') {
        database.prepare(`
          UPDATE invoices SET status = 'cancelled', cancelled_at = '2027-01-16T11:00:00.000Z',
            cancelled_by = 'revision-actor', cancellation_reason = 'Synthetic cancellation'
          WHERE id = ?
        `).run(source.id);
      } else {
        database.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(state, source.id);
      }
      const before = readApprovalState(database);
      await expect(repository.approveCreditDraft(creditApprovalInput())).resolves.toEqual({ outcome: 'conflict' });
      expect(readApprovalState(database)).toEqual(before);
    },
  );

  it.each(['revision', 'audit', 'draft-link'] as const)('rolls back sealed revision, number, audit and draft link after a %s failure', async (stage) => {
    const source = await createSentRevisionSource(database, fixture);
    await persistRevisionCreditDraft(database, source, partialLines);
    const before = readApprovalState(database);
    const target = {
      revision: 'AFTER INSERT ON invoice_content_revisions',
      audit: 'AFTER INSERT ON invoice_audit_events',
      'draft-link': 'AFTER UPDATE OF approved_invoice_id ON invoice_drafts',
    }[stage];
    database.exec(`
      CREATE TEMP TRIGGER fail_credit_revision ${target}
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM invoice_content_revisions revision
          JOIN invoice_revision_lines line ON line.revision_id = revision.id
          JOIN invoice_revision_vat_breakdown vat ON vat.revision_id = revision.id
          WHERE revision.invoice_id = 'credit-revision-invoice'
        ) THEN RAISE(ABORT, 'CREDIT_REVISION_NOT_PUBLISHED') END;
        SELECT RAISE(ABORT, 'INJECTED_CREDIT_APPROVAL_FAILURE');
      END;
    `);
    await expect(repository.approveCreditDraft(creditApprovalInput())).rejects.toThrow('INJECTED_CREDIT_APPROVAL_FAILURE');
    expect(database.inTransaction).toBe(false);
    expect(readApprovalState(database)).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    database.exec('DROP TRIGGER fail_credit_revision');
    await expect(repository.approveCreditDraft(creditApprovalInput())).resolves.toMatchObject({
      outcome: 'approved', invoice: { sequenceNumber: 2 },
    });
  });

  it('rejects foreign-company and duplicate commands without another revision, number or audit', async () => {
    const source = await createSentRevisionSource(database, fixture);
    await persistRevisionCreditDraft(database, source);
    const before = readApprovalState(database);
    await expect(repository.approveCreditDraft(creditApprovalInput({ companyId: 'foreign-company' })))
      .resolves.toEqual({ outcome: 'notFound' });
    expect(readApprovalState(database)).toEqual(before);
    await repository.approveCreditDraft(creditApprovalInput());
    const approved = readApprovalState(database);
    await expect(repository.approveCreditDraft(creditApprovalInput({
      invoiceId: 'duplicate-credit', auditEventId: 'duplicate-credit-audit',
    }))).resolves.toEqual({ outcome: 'notFound' });
    expect(readApprovalState(database)).toEqual(approved);
    expect(database.prepare('SELECT id FROM invoice_content_revisions WHERE invoice_kind = ?').all('credit')).toHaveLength(1);
  });

  it.each(['source-quantity', 'manual-total', 'manual-vat-group'] as const)(
    'still enforces %s capacity before writing a credit revision', async (limit) => {
      const source = await createSentRevisionSource(database, fixture);
      const draft = await persistRevisionCreditDraft(database, source,
        limit === 'source-quantity' ? partialLines.slice(0, 1) : partialLines.slice(1));
      if (limit === 'source-quantity') {
        database.prepare('UPDATE invoice_draft_lines SET quantity_hundredths = ? WHERE invoice_draft_id = ?')
          .run(source.lines[0]!.quantityHundredths + 1, draft.id);
      } else {
        const price = limit === 'manual-total' ? source.totals.grossTotalCents + 1 : source.lines[0]!.netCents + 1;
        if (limit === 'manual-vat-group') expect(price).toBeLessThan(source.totals.netTotalCents);
        database.prepare('UPDATE invoice_draft_lines SET unit_price_cents = ? WHERE invoice_draft_id = ?').run(price, draft.id);
      }
      const before = readApprovalState(database);
      await expect(repository.approveCreditDraft(creditApprovalInput())).rejects.toBeInstanceOf(InvoiceCreditError);
      expect(readApprovalState(database)).toEqual(before);
      expect(database.pragma('foreign_key_check')).toEqual([]);
    },
  );
});

it('credits an actual 001..038 -> seeded legacy -> 039 source without promoting legacy delivery provenance', async () => {
  const { database, source } = await createLegacyCreditRevisionSource();
  try {
    const before = readCreditSourceState(database, source);
    expect(before.revision.header).toMatchObject({ origin: 'legacySnapshot', vat_breakdown_state: 'unavailable' });
    expect(before.revision.vat).toEqual([]);
    expect(before.documents).toEqual([expect.objectContaining({
      binding_kind: 'legacyOriginal', revision_id: null, source_document_id: null,
    })]);
    expect(before.deliveryEvents).toEqual([expect.objectContaining({
      binding_kind: 'legacyOriginal', send_mode: 'legacyUnknown', revision_id: null, status: 'outcomeUnknown',
    })]);
    expect(source.lines.reduce((sum, line) => sum + line.vatCents, 0)).not.toBe(source.totals.vatTotalCents);
    await persistRevisionCreditDraft(database, source);
    await expect(new SqliteInvoiceCreditApprovalRepository(database).approveCreditDraft(
      creditApprovalInput({ companyId: source.companyId }),
    )).resolves.toMatchObject({ outcome: 'approved' });
    const credit = readCreditRevision(database, 'credit-revision-invoice', source.companyId);
    expect(credit.header).toMatchObject({
      origin: 'approval', vat_breakdown_state: 'authoritative', credited_invoice_id: source.id,
      credited_revision_id: before.revision.header.id,
      credited_invoice_number_snapshot: before.revision.header.invoice_number,
      credited_invoice_date_snapshot: before.revision.header.invoice_date,
      total_net_cents: 4, total_vat_cents: 1, total_gross_cents: 5,
    });
    expect(credit.lines.map((line) => [line.source_revision_id, line.source_invoice_line_id]))
      .toEqual(before.revision.lines.map((line) => [line.revision_id, line.line_id]));
    expect(credit.vat).toEqual([expect.objectContaining({ vat_rate_basis_points: 2550, net_cents: 4, vat_cents: 1, gross_cents: 5 })]);
    expect(readCreditSourceState(database, source)).toEqual(before);
    expect(database.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toHaveLength(39);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.close();
  }
});
