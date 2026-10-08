import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type {
  InvoiceContentRevisionRow,
  InvoiceLineRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
  InvoiceRow,
} from '../../../database/schema.js';
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

function readCurrentRevision(database: DatabaseConnection) {
  const header = database.prepare<[string, string], InvoiceContentRevisionRow>(`
    SELECT revision.* FROM invoice_content_revisions revision
    JOIN invoice_current_revisions current
      ON current.company_id = revision.company_id
      AND current.invoice_id = revision.invoice_id
      AND current.revision_id = revision.id
    WHERE current.company_id = ? AND current.invoice_id = ?
  `).get('revision-company', 'revision-invoice');
  if (header === undefined) throw new Error('Current approval revision missing.');
  return readRevision(database, header);
}

function readRevision(
  database: DatabaseConnection,
  header: InvoiceContentRevisionRow,
) {
  return {
    header: database.prepare<[string], InvoiceContentRevisionRow>(
      'SELECT * FROM invoice_content_revisions WHERE id = ?',
    ).get(header.id),
    lines: database.prepare<[string], InvoiceRevisionLineRow>(`
      SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order
    `).all(header.id),
    vat: database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`
      SELECT * FROM invoice_revision_vat_breakdown
      WHERE revision_id = ? ORDER BY vat_rate_basis_points
    `).all(header.id),
  };
}

function readInvoice(database: DatabaseConnection): InvoiceRow {
  const invoice = database.prepare<[string, string], InvoiceRow>(`
    SELECT * FROM invoices WHERE company_id = ? AND id = ?
  `).get('revision-company', 'revision-invoice');
  if (invoice === undefined) throw new Error('Approved invoice missing.');
  return invoice;
}

async function reopenAndEdit(
  fixture: Awaited<ReturnType<typeof createApprovalRevisionFixture>>,
) {
  const reopened = await fixture.repository.reopenApprovedInvoiceForEditing({
    companyId: 'revision-company',
    invoiceId: 'revision-invoice',
    actorUserId: 'revision-actor',
    auditEventId: 'revision-reopen-audit',
    reopenedAt: '2027-01-16T08:00:00.000Z',
  });
  expect(reopened).toEqual({
    invoiceId: 'revision-invoice',
    draftId: 'revision-draft',
  });
  const draft = createRevisionDraft({
    subject: 'Edited synthetic invoice',
    note: '',
    performancePeriod: { type: 'invoiceDate' },
    updatedAt: '2027-01-16T09:00:00.000Z',
  }, [createRevisionLine('revision-line-1', 1, { unitPriceCents: 8765 })]);
  expect(await fixture.drafts.updateDraft(draft)).toEqual(draft);
  fixture.snapshot.companyName = 'Updated Synthetic Seller Oy';
  return draft;
}

const reapprovalInput = () => revisionApprovalInput({
  invoiceId: 'unused-reapproval-id',
  auditEventId: 'revision-reapproval-audit',
  approvedAt: '2027-01-16T12:00:00.000Z',
});

describe('SQLite standard approval revision publication', () => {
  let database: DatabaseConnection;
  let fixture: Awaited<ReturnType<typeof createApprovalRevisionFixture>>;
  let statements: string[];

  beforeEach(async () => {
    statements = [];
    database = new Database(':memory:', {
      verbose: (statement) => statements.push(String(statement)),
    });
    fixture = await createApprovalRevisionFixture(database);
  });

  afterEach(() => database.close());

  it('publishes exactly 64 source content fields and every line field in the approval transaction', async () => {
    const draft = createRevisionDraft();
    await fixture.drafts.saveDraft(draft);
    statements.length = 0;
    const result = await fixture.repository.approveDraft(revisionApprovalInput());
    const approvalStatements = [...statements];
    const { header, lines, vat } = readCurrentRevision(database);
    if (header === undefined) throw new Error('Published header missing.');
    const invoice = readInvoice(database);

    expect(result).toEqual({
      revisionKey: { companyId: header.company_id, invoiceId: header.invoice_id, revisionId: header.id },
      invoiceId: 'revision-invoice', draftId: draft.id,
      invoiceNumber: '20270001', referenceNumber: invoice.reference_number,
      referenceNumberType: 'finnishDomestic', sequenceNumber: 1,
      sequenceScope: 'calendar-year:2027', numberingMode: 'calendarYearSequence',
      status: 'approved',
    });
    expect(header.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(approvalContentFields).toHaveLength(64);
    expect(new Set(approvalContentFields).size).toBe(64);
    expect(database.prepare<[], { name: string }>('PRAGMA table_info(invoices)')
      .all().map((column) => column.name).sort()).toEqual([
      'id', 'company_id', ...approvalContentFields, ...liveInvoiceFields,
    ].sort());
    expect(header).toEqual({
      ...Object.fromEntries(approvalContentFields.map((field) => [field, invoice[field]])),
      id: header.id,
      company_id: invoice.company_id,
      invoice_id: invoice.id,
      origin: 'approval',
      vat_breakdown_state: 'authoritative',
      credited_revision_id: null,
      credited_invoice_number_snapshot: null,
      credited_invoice_date_snapshot: null,
    });
    for (const field of liveInvoiceFields) expect(header).not.toHaveProperty(field);
    expect(header).toMatchObject({
      credited_invoice_id: null,
      performance_date: '2027-01-14',
      performance_period_start: null,
      performance_period_end: null,
      created_at: revisionApprovalInput().approvedAt,
      approved_at: revisionApprovalInput().approvedAt,
    });
    expect(header.created_at).not.toBe(draft.createdAt);
    expect(fixture.snapshotRequests).toEqual([{
      companyId: draft.companyId, customerId: draft.customerId,
      billingRecipientCustomerId: draft.billingRecipientCustomerId,
    }]);

    const invoiceLines = database.prepare<[string], InvoiceLineRow>(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order',
    ).all(invoice.id);
    expect(invoiceLines).toHaveLength(3);
    for (const line of invoiceLines) expect(Object.keys(line)).toHaveLength(18);
    expect(lines).toEqual(invoiceLines.map(({ id, ...line }) => ({
      ...line, line_id: id, company_id: invoice.company_id,
      revision_id: header.id, source_revision_id: null,
    })));
    expect(lines.map((line) => line.created_at)).toEqual(
      draft.lines.map(() => revisionApprovalInput().approvedAt),
    );
    expect(vat).toEqual(draft.totals.vatBreakdown.map((group) => ({
      company_id: invoice.company_id, invoice_id: invoice.id,
      revision_id: header.id, vat_rate_basis_points: group.vatRateBasisPoints,
      net_cents: group.netCents, vat_cents: group.vatCents,
      gross_cents: group.grossCents,
    })));

    expect(approvalStatements[0]?.trim()).toBe('BEGIN IMMEDIATE');
    expect(approvalStatements.at(-1)?.trim()).toBe('COMMIT');
    const headerIndex = approvalStatements.findIndex((sql) => /INSERT INTO invoice_content_revisions\b/.test(sql));
    const pointerIndex = approvalStatements.findIndex((sql) => /INSERT INTO invoice_current_revisions\b/.test(sql));
    const childIndexes = approvalStatements.flatMap((sql, index) =>
      /INSERT INTO invoice_revision_(lines|vat_breakdown)\b/.test(sql) ? [index] : []);
    expect(childIndexes).toHaveLength(lines.length + vat.length);
    for (const index of childIndexes) expect(index).toBeLessThan(headerIndex);
    expect(pointerIndex).toBeGreaterThan(headerIndex);
    expect(approvalStatements.findIndex((sql) => /INSERT INTO invoice_audit_events\b/.test(sql)))
      .toBeGreaterThan(pointerIndex);
    expect(database.prepare('SELECT status, approved_invoice_id, approved_at FROM invoice_drafts').get())
      .toEqual({ status: 'draft', approved_invoice_id: invoice.id, approved_at: header.approved_at });
    expect(database.prepare('SELECT last_sequence_number FROM invoice_number_sequences').all())
      .toEqual([{ last_sequence_number: 1 }]);
    expect(database.prepare('SELECT action FROM invoice_audit_events').all())
      .toEqual([{ action: 'invoice.approved' }]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['net', 'gross'] as const)('preserves authoritative %s group rounding instead of summing rounded lines', async (priceInputMode) => {
    const draft = createRevisionDraft({ priceInputMode }, [
      createRevisionLine('rounding-1', 1, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
      createRevisionLine('rounding-2', 2, { priceInputMode, quantityHundredths: 100, unitPriceCents: 2 }),
    ]);
    expect(draft.lines.reduce((sum, line) => sum + line.vatCents, 0))
      .not.toBe(draft.totals.vatTotalCents);
    await fixture.drafts.saveDraft(draft);
    await fixture.repository.approveDraft(revisionApprovalInput());
    const revision = readCurrentRevision(database);
    const expected = priceInputMode === 'net'
      ? { net_cents: 4, vat_cents: 1, gross_cents: 5 }
      : { net_cents: 3, vat_cents: 1, gross_cents: 4 };
    expect(revision.vat).toHaveLength(1);
    expect(revision.vat[0]).toMatchObject({ vat_rate_basis_points: 2550, ...expected });
    expect(revision.header).toMatchObject({
      total_net_cents: draft.totals.netTotalCents,
      total_vat_cents: draft.totals.vatTotalCents,
      total_gross_cents: draft.totals.grossTotalCents,
    });
    expect(revision.lines.map((line) => [line.net_cents, line.vat_cents, line.gross_cents]))
      .toEqual(draft.lines.map((line) => [line.netCents, line.vatCents, line.grossCents]));
  });

  it('publishes reverse charge with authoritative empty VAT, nullable rates and the original date range', async () => {
    const draft = createReverseChargeRevisionDraft();
    await fixture.drafts.saveDraft(draft);
    await fixture.repository.approveDraft(revisionApprovalInput({ reverseChargeEligibilityConfirmed: true }));
    const revision = readCurrentRevision(database);
    expect(revision.vat).toEqual([]);
    expect(revision.header).toMatchObject({
      origin: 'approval', vat_breakdown_state: 'authoritative',
      tax_treatment: 'reverseChargeConstruction',
      tax_treatment_label_snapshot: readInvoice(database).tax_treatment_label_snapshot,
      tax_legal_basis_snapshot: readInvoice(database).tax_legal_basis_snapshot,
      total_net_cents: draft.totals.netTotalCents, total_vat_cents: 0,
      total_gross_cents: draft.totals.netTotalCents,
      performance_date: null, performance_period_start: '2027-01-01',
      performance_period_end: '2027-01-14',
    });
    expect(revision.lines).toHaveLength(1);
    expect(revision.lines[0]).toMatchObject({
      vat_rate_basis_points: null, source_invoice_line_id: null,
      source_revision_id: null, vat_cents: 0,
      net_cents: draft.totals.netTotalCents, gross_cents: draft.totals.netTotalCents,
      created_at: revisionApprovalInput().approvedAt,
    });
  });

  it('preserves all old content on reapproval, reuses numbering and replaces only the current pointer', async () => {
    await fixture.drafts.saveDraft(createRevisionDraft());
    const approved = await fixture.repository.approveDraft(revisionApprovalInput());
    const original = readCurrentRevision(database);
    if (original.header === undefined) throw new Error('Original header missing.');
    const sequence = database.prepare('SELECT * FROM invoice_number_sequences').all();
    const editedDraft = await reopenAndEdit(fixture);
    const reapproved = await fixture.repository.approveDraft(reapprovalInput());
    const current = readCurrentRevision(database);

    if (current.header === undefined) throw new Error('Reapproved header missing.');
    expect(approved?.revisionKey).toEqual({
      companyId: original.header.company_id,
      invoiceId: original.header.invoice_id,
      revisionId: original.header.id,
    });
    expect(reapproved).toEqual({
      ...approved,
      revisionKey: {
        companyId: current.header.company_id,
        invoiceId: original.header.invoice_id,
        revisionId: current.header.id,
      },
    });
    expect(current.header?.id).not.toBe(original.header.id);
    expect(current.header).toMatchObject({
      invoice_id: original.header.invoice_id,
      created_at: original.header.created_at,
      approved_at: reapprovalInput().approvedAt,
      subject: editedDraft.subject, note: '',
      company_name_snapshot: fixture.snapshot.companyName,
      performance_date: null, performance_period_start: null,
      performance_period_end: null,
      total_gross_cents: editedDraft.totals.grossTotalCents,
    });
    expect(readRevision(database, original.header)).toEqual(original);
    expect(current.lines).toHaveLength(1);
    expect(current.lines[0]).toMatchObject({
      line_id: 'revision-line-1', unit_price_cents: 8765,
      created_at: reapprovalInput().approvedAt,
    });
    expect(database.prepare('SELECT * FROM invoice_number_sequences').all()).toEqual(sequence);
    expect(database.prepare('SELECT id FROM invoices').all()).toEqual([{ id: 'revision-invoice' }]);
    expect(database.prepare('SELECT id FROM invoice_content_revisions').all()).toHaveLength(2);
    expect(database.prepare('SELECT * FROM invoice_current_revisions').all()).toEqual([{
      company_id: 'revision-company', invoice_id: 'revision-invoice',
      revision_id: current.header?.id,
    }]);
    expect(database.prepare('SELECT action FROM invoice_audit_events ORDER BY created_at').all()).toEqual([
      { action: 'invoice.approved' }, { action: 'invoice.reopened_for_edit' },
      { action: 'invoice.reapproved' },
    ]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  describe.each(['new approval', 'reapproval'] as const)('%s rollback', (operation) => {
    it.each(['revision', 'audit', 'draft-link'] as const)('restores every affected table after a %s failure', async (stage) => {
      if (operation === 'new approval') {
        await fixture.drafts.saveDraft(createRevisionDraft({ id: 'prior-draft' }, [createRevisionLine('prior-line', 1)]));
        await fixture.repository.approveDraft(revisionApprovalInput({
          draftId: 'prior-draft', invoiceId: 'prior-invoice', auditEventId: 'prior-audit',
        }));
      }
      await fixture.drafts.saveDraft(createRevisionDraft());
      if (operation === 'reapproval') {
        await fixture.repository.approveDraft(revisionApprovalInput());
        await reopenAndEdit(fixture);
      }
      const before = readApprovalState(database);
      const input = operation === 'reapproval' ? reapprovalInput() : revisionApprovalInput();
      // Fail only after observing the new sealed content, not an older revision.
      const target = {
        revision: 'AFTER INSERT ON invoice_content_revisions',
        audit: 'AFTER INSERT ON invoice_audit_events',
        'draft-link': 'AFTER UPDATE OF approved_invoice_id ON invoice_drafts',
      }[stage];
      const failureTime = stage === 'audit' ? 'NEW.created_at' : 'NEW.approved_at';
      database.exec(`
        CREATE TEMP TRIGGER fail_revision_approval ${target}
        BEGIN
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM invoice_content_revisions revision
            JOIN invoice_revision_lines line ON line.revision_id = revision.id
            JOIN invoice_revision_vat_breakdown vat ON vat.revision_id = revision.id
            WHERE revision.invoice_id = 'revision-invoice'
              AND revision.approved_at = ${failureTime}
          ) THEN RAISE(ABORT, 'REVISION_NOT_PUBLISHED_BEFORE_FAILURE') END;
          SELECT RAISE(ABORT, 'INJECTED_APPROVAL_FAILURE');
        END;
      `);
      await expect(fixture.repository.approveDraft(input)).rejects.toThrow('INJECTED_APPROVAL_FAILURE');
      expect(database.inTransaction).toBe(false);
      expect(readApprovalState(database)).toEqual(before);
      expect(database.pragma('foreign_key_check')).toEqual([]);
      database.exec('DROP TRIGGER fail_revision_approval');
      await expect(fixture.repository.approveDraft(input)).resolves.toMatchObject({
        invoiceId: 'revision-invoice', sequenceNumber: operation === 'new approval' ? 2 : 1,
      });
    });
  });

  it('rejects foreign-company and duplicate approval without writes or a second snapshot read', async () => {
    await fixture.drafts.saveDraft(createRevisionDraft());
    const before = readApprovalState(database);
    expect(await fixture.repository.approveDraft(revisionApprovalInput({ companyId: 'foreign-company' })))
      .toBeUndefined();
    expect(readApprovalState(database)).toEqual(before);
    expect(fixture.snapshotRequests).toEqual([]);
    await fixture.repository.approveDraft(revisionApprovalInput());
    const afterApproval = readApprovalState(database);
    expect(await fixture.repository.approveDraft(revisionApprovalInput({
      invoiceId: 'duplicate-invoice', auditEventId: 'duplicate-audit',
    }))).toBeUndefined();
    expect(readApprovalState(database)).toEqual(afterApproval);
    expect(fixture.snapshotRequests).toHaveLength(1);
  });

  it('retains committed revisions across file reopen and acquires the writer lock before reading snapshots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-approval-revision-'));
    const path = join(root, 'synthetic.sqlite');
    let writer: DatabaseConnection | undefined;
    let contender: DatabaseConnection | undefined;
    try {
      writer = new Database(path);
      contender = new Database(path, { timeout: 0 });
      const fileFixture = await createApprovalRevisionFixture(writer, () => {
        try {
          expect(() => contender?.exec('BEGIN IMMEDIATE')).toThrow('database is locked');
        } finally {
          if (contender?.inTransaction) contender.exec('ROLLBACK');
        }
      });
      await fileFixture.drafts.saveDraft(createRevisionDraft());
      await fileFixture.repository.approveDraft(revisionApprovalInput());
      await reopenAndEdit(fileFixture);
      await fileFixture.repository.approveDraft(reapprovalInput());
      expect(fileFixture.snapshotRequests).toHaveLength(2);
      const committed = readApprovalState(writer);
      writer.close();
      writer = new Database(path);
      writer.pragma('foreign_keys = ON');
      await runMigrations(writer);
      expect(readApprovalState(writer)).toEqual(committed);
      expect(writer.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toHaveLength(39);
      expect(writer.pragma('foreign_key_check')).toEqual([]);
    } finally {
      if (contender?.open) contender.close();
      if (writer?.open) writer.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
