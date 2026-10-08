import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDraftDeliveryHistoryIntegrityError } from '../application/invoiceDraftDeliveryHistoryIntegrityError.js';
import { createApprovalRevisionFixture, createRevisionDraft, revisionApprovalInput } from './invoiceApprovalRevision.fixture.js';
import { createEmailReservationFixture } from './invoiceEmailReservation.fixture.js';
import { closePublicationDatabases, openPublicationDatabase, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDeliveryEventQueries } from './sqliteInvoiceDeliveryEventQueries.js';
import { SqliteInvoiceDraftDeliveryHistoryReader } from './sqliteInvoiceDraftDeliveryHistoryReader.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);
const ordinaryScope = { companyId: 'revision-company', invoiceDraftId: 'revision-draft' };

async function ordinaryFixture() {
  const database = openPublicationDatabase();
  const approval = await createApprovalRevisionFixture(database);
  await approval.drafts.saveDraft(createRevisionDraft());
  return { database, approval, reader: new SqliteInvoiceDraftDeliveryHistoryReader(database) };
}

async function reopenedFixture() {
  const statements: string[] = [];
  const database = openPublicationDatabase(':memory:', sql => statements.push(sql));
  const f = await createEmailReservationFixture(database);
  const reservation = { ...f.input, mode: 'smtpTest' as const };
  expect((await f.delivery.reserveEmailDelivery(reservation)).outcome).toBe('reserved');
  await f.delivery.completeDeliveryEvent({ reservation,
    result: { status: 'succeeded', providerMessageId: 'synthetic-self-test' },
  });
  const reopened = await f.approval.repository.reopenApprovedInvoiceForEditing({
    ...f.key, actorUserId: 'revision-actor', auditEventId: 'reopen-audit', reopenedAt: '2027-01-15T14:00:00.000Z',
  });
  if (!reopened) throw new Error('Synthetic reopen missing.');
  return { ...f, statements, scope: { companyId: f.key.companyId, invoiceDraftId: reopened.draftId },
    reader: new SqliteInvoiceDraftDeliveryHistoryReader(database) };
}

describe('SQLite draft delivery history read model', () => {
  it('reads ordinary empty history with query_only enabled and preserves every persisted row', async () => {
    const f = await ordinaryFixture();
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(f.reader.findDeliveryHistory(ordinaryScope)).resolves.toEqual({ invoiceId: null, events: [] });
    expect(publicationState(f.database)).toEqual(before);
  });

  it('resolves the real approval identity after self-test and reopen in one deferred read transaction', async () => {
    const f = await reopenedFixture();
    const before = publicationState(f.database);
    const query = SqliteInvoiceDeliveryEventQueries.prototype.listDeliveryEvents;
    const events = vi.spyOn(SqliteInvoiceDeliveryEventQueries.prototype, 'listDeliveryEvents')
      .mockImplementation(function(this: SqliteInvoiceDeliveryEventQueries, companyId, invoiceId) {
        expect(f.database.inTransaction).toBe(true);
        return query.call(this, companyId, invoiceId);
      });
    f.database.pragma('query_only = ON');
    f.statements.length = 0;
    const history = await f.reader.findDeliveryHistory(f.scope);
    expect(history).toEqual({ invoiceId: f.key.invoiceId, events: [expect.objectContaining({
      id: f.input.eventId, sendMode: 'smtpTest', status: 'succeeded', documentSource: 'revision',
    })] });
    expect(events).toHaveBeenCalledExactlyOnceWith(f.key.companyId, f.key.invoiceId);
    expect(f.statements.filter(sql => /^(BEGIN|COMMIT|ROLLBACK)/.test(sql))).toEqual(['BEGIN DEFERRED', 'COMMIT']);
    expect(f.database.inTransaction).toBe(false);
    expect(publicationState(f.database)).toEqual(before);
  });

  it('returns reopened identity even if no event has ever been written', async () => {
    const f = await ordinaryFixture();
    await f.approval.repository.approveDraft(revisionApprovalInput());
    await f.approval.repository.reopenApprovedInvoiceForEditing({
      companyId: ordinaryScope.companyId, invoiceId: 'revision-invoice', actorUserId: 'revision-actor',
      auditEventId: 'reopen-audit', reopenedAt: '2027-01-15T14:00:00.000Z',
    });
    await expect(f.reader.findDeliveryHistory(ordinaryScope)).resolves.toEqual({ invoiceId: 'revision-invoice', events: [] });
  });

  it.each(['missing', 'foreign', 'credit', 'credited', 'locked', 'status'] as const)('denies %s before event lookup', async boundary => {
    const f = await reopenedFixture();
    const scope = { ...f.scope };
    if (boundary === 'missing') scope.invoiceDraftId = 'missing-draft';
    if (boundary === 'foreign') scope.companyId = 'foreign-company';
    if (boundary === 'credit') f.database.prepare("UPDATE invoice_drafts SET invoice_kind = 'credit' WHERE id = ?").run(scope.invoiceDraftId);
    if (boundary === 'credited') f.database.prepare('UPDATE invoice_drafts SET credited_invoice_id = ? WHERE id = ?').run(f.key.invoiceId, scope.invoiceDraftId);
    if (boundary === 'locked') f.database.prepare('UPDATE invoice_drafts SET approved_invoice_id = ? WHERE id = ?').run(f.key.invoiceId, scope.invoiceDraftId);
    if (boundary === 'status') {
      f.database.pragma('ignore_check_constraints = ON');
      f.database.prepare("UPDATE invoice_drafts SET status = 'approved' WHERE id = ?").run(scope.invoiceDraftId);
      f.database.pragma('ignore_check_constraints = OFF');
    }
    const before = publicationState(f.database);
    const events = vi.spyOn(SqliteInvoiceDeliveryEventQueries.prototype, 'listDeliveryEvents');
    f.database.pragma('query_only = ON');
    await expect(f.reader.findDeliveryHistory(scope)).resolves.toBeUndefined();
    expect(events).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('ignores a foreign invoice bound to the same source-draft id', async () => {
    const f = await reopenedFixture();
    const foreign = await f.approve('foreign-invoice', 'foreign-company');
    f.database.prepare('UPDATE invoices SET source_draft_id = ? WHERE company_id = ? AND id = ?')
      .run(f.scope.invoiceDraftId, foreign.companyId, foreign.invoiceId);
    f.database.pragma('query_only = ON');
    const result = await f.reader.findDeliveryHistory(f.scope);
    expect(result).toMatchObject({ invoiceId: f.key.invoiceId, events: [{ id: f.input.eventId }] });
    expect(JSON.stringify(result)).not.toContain(foreign.invoiceId);
  });

  it('returns empty ordinary history when only a foreign-company binding exists', async () => {
    const f = await ordinaryFixture();
    const foreignDraft = createRevisionDraft({ id: 'foreign-draft', companyId: 'foreign-company' });
    await f.approval.drafts.saveDraft({ ...foreignDraft,
      lines: foreignDraft.lines.map(line => ({ ...line, id: `foreign-${line.id}` })),
    });
    await f.approval.repository.approveDraft(revisionApprovalInput({
      companyId: 'foreign-company', draftId: foreignDraft.id, invoiceId: 'foreign-invoice',
    }));
    f.database.prepare('UPDATE invoices SET source_draft_id = ? WHERE company_id = ? AND id = ?')
      .run(ordinaryScope.invoiceDraftId, 'foreign-company', 'foreign-invoice');
    f.database.pragma('query_only = ON');
    await expect(f.reader.findDeliveryHistory(ordinaryScope)).resolves.toEqual({ invoiceId: null, events: [] });
  });

  it.each(['approved', 'sent', 'cancelled'] as const)('fails closed on an editable draft bound to a %s invoice', async status => {
    const f = await reopenedFixture();
    setInvoiceStatus(f.database, f.key, status);
    const before = publicationState(f.database);
    const events = vi.spyOn(SqliteInvoiceDeliveryEventQueries.prototype, 'listDeliveryEvents');
    f.database.pragma('query_only = ON');
    await expect(f.reader.findDeliveryHistory(f.scope)).rejects.toBeInstanceOf(InvoiceDraftDeliveryHistoryIntegrityError);
    expect(events).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('rejects an inconsistent credit invoice binding without returning its history', async () => {
    const f = await reopenedFixture();
    const original = await f.approve('another-invoice');
    f.database.prepare("UPDATE invoices SET invoice_kind = 'credit', credited_invoice_id = ? WHERE id = ?")
      .run(original.invoiceId, f.key.invoiceId);
    await expect(f.reader.findDeliveryHistory(f.scope)).rejects.toBeInstanceOf(InvoiceDraftDeliveryHistoryIntegrityError);
  });

  it('uses the existing summary validator and never hides malformed stored event provenance', async () => {
    const f = await reopenedFixture();
    // Corruption fixture only: production constraints intentionally prevent this state.
    f.database.exec('DROP TRIGGER invoice_delivery_events_binding_no_update');
    f.database.pragma('ignore_check_constraints = ON');
    f.database.prepare("UPDATE invoice_delivery_events SET send_mode = 'legacyUnknown' WHERE id = ?").run(f.input.eventId);
    f.database.pragma('ignore_check_constraints = OFF');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(f.reader.findDeliveryHistory(f.scope)).rejects.toBeInstanceOf(InvoiceDraftDeliveryHistoryIntegrityError);
    expect(publicationState(f.database)).toEqual(before);
  });
});
