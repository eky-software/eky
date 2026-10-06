import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { historicalDatabase, insert, migrate, removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { createRevisionDraft, revisionApprovalInput } from './invoiceApprovalRevision.fixture.js';
import { createEmailReservationFixture, readReservedEvent } from './invoiceEmailReservation.fixture.js';
import { SqliteInvoiceApprovalRepository } from './sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceContentRevisionReader } from './sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceDraftRepository } from './sqliteInvoiceDraftRepository.js';
import { closePublicationDatabases, documentCandidate, openPublicationDatabase, publicationState } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

const reopenInput = {
  companyId: 'revision-company', invoiceId: 'revision-invoice', actorUserId: 'revision-actor',
  auditEventId: 'reopen-audit', reopenedAt: '2027-01-16T08:00:00.000Z',
};
const success = { status: 'succeeded', providerMessageId: 'synthetic-message' } as const;

describe('reopen with persistent SMTP reservations', () => {
  it.each(['customer', 'smtpTest'] as const)('blocks attempted and unknown %s without changing any retained state', async (mode) => {
    const path = join(temporaryDirectory(), 'unresolved.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const reservation = { ...f.input, mode };
    await f.delivery.reserveEmailDelivery(reservation);
    for (const outcome of ['attempted', 'outcomeUnknown'] as const) {
      if (outcome === 'outcomeUnknown') await f.delivery.completeDeliveryEvent({ reservation,
        result: { status: outcome, safeErrorMessage: null, technicalErrorCode: null },
      });
      const before = publicationState(f.database);
      await expect(f.approval.repository.reopenApprovedInvoiceForEditing(reopenInput))
        .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      expect(publicationState(f.database)).toEqual(before);
      const restartedDb = openPublicationDatabase(path);
      await expect(new SqliteInvoiceApprovalRepository(restartedDb).reopenApprovedInvoiceForEditing(reopenInput))
        .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      expect(publicationState(restartedDb)).toEqual(before);
      restartedDb.close();
    }
  });

  it('retains self-test revision, PDF and event while reapproval advances only the current pointer', async () => {
    const f = await createEmailReservationFixture();
    const reservation = { ...f.input, mode: 'smtpTest' as const };
    await f.delivery.reserveEmailDelivery(reservation);
    await f.delivery.completeDeliveryEvent({ reservation, result: success });
    const reader = new SqliteInvoiceContentRevisionReader(f.database);
    const oldRevision = await reader.getRevision(f.key);
    const oldEvent = readReservedEvent(f.database);
    const sequence = f.database.prepare('SELECT * FROM invoice_number_sequences').all();
    await expect(f.approval.repository.reopenApprovedInvoiceForEditing(reopenInput)).resolves.toEqual({
      invoiceId: f.key.invoiceId, draftId: `${f.key.invoiceId}-draft`,
    });
    expect(await reader.getCurrentRevision(f.key)).toBeUndefined();
    expect(await reader.getRevision(f.key)).toEqual(oldRevision);
    expect(await f.repository.findDocumentForRevision(f.key)).toEqual(f.document);
    expect(readReservedEvent(f.database)).toEqual(oldEvent);
    await expect(f.delivery.reserveEmailDelivery({ ...f.input, eventId: 'during-edit' }))
      .resolves.toEqual({ outcome: 'conflict' });

    const reapproved = await f.approval.repository.approveDraft(revisionApprovalInput({
      draftId: `${f.key.invoiceId}-draft`, auditEventId: 'reapprove-audit', approvedAt: '2027-01-16T10:00:00.000Z',
    }));
    if (!reapproved) throw new Error('Synthetic reapproval failed.');
    expect(reapproved.invoiceId).toBe(f.key.invoiceId);
    expect(reapproved.revisionKey.revisionId).not.toBe(f.key.revisionId);
    expect(f.database.prepare('SELECT * FROM invoice_number_sequences').all()).toEqual(sequence);
    expect(await reader.getRevision(f.key)).toEqual(oldRevision);
    expect(readReservedEvent(f.database)).toEqual(oldEvent);
    const document = await f.repository.publishDocumentIfCurrent({
      key: reapproved.revisionKey, candidate: documentCandidate(f.key, 'new-revision-document'),
    });
    expect(document.outcome).toBe('published');
    await expect(f.delivery.reserveEmailDelivery({ ...f.input, eventId: 'stale-customer-target' }))
      .resolves.toEqual({ outcome: 'conflict' });
    await expect(f.delivery.completeDeliveryEvent({ reservation, result: success }))
      .resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(await f.repository.findDocumentForRevision(f.key)).toEqual(f.document);
  });

  it('keeps customer success locked but permits a confirmed failed delivery to reopen', async () => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    await f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success });
    const before = publicationState(f.database);
    await expect(f.approval.repository.reopenApprovedInvoiceForEditing(reopenInput)).resolves.toBeUndefined();
    expect(publicationState(f.database)).toEqual(before);

    const failed = await createEmailReservationFixture();
    await failed.delivery.reserveEmailDelivery(failed.input);
    await failed.delivery.completeDeliveryEvent({ reservation: failed.input,
      result: { status: 'failed', safeErrorMessage: null, technicalErrorCode: null },
    });
    const failedEvent = readReservedEvent(failed.database);
    await expect(failed.approval.repository.reopenApprovedInvoiceForEditing(reopenInput)).resolves.toBeDefined();
    expect(readReservedEvent(failed.database)).toEqual(failedEvent);
    expect(await failed.repository.findDocumentForRevision(failed.key)).toEqual(failed.document);
  });

  it('begins IMMEDIATE before reads and rolls back the pointer, draft and invoice if audit fails', async () => {
    const statements: string[] = [];
    const f = await createEmailReservationFixture(openPublicationDatabase(':memory:', (sql) => statements.push(sql)));
    f.database.exec(`CREATE TRIGGER synthetic_reopen_audit_failure BEFORE INSERT ON invoice_audit_events
      WHEN NEW.action = 'invoice.reopened_for_edit' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END`);
    const before = publicationState(f.database);
    statements.length = 0;
    await expect(f.approval.repository.reopenApprovedInvoiceForEditing(reopenInput)).rejects.toThrow('SYNTHETIC');
    expect(statements[0]).toBe('BEGIN IMMEDIATE');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['reserveFirst', 'reopenFirst'] as const)('serializes competing connections (%s) and preserves the decision after restart', async (order) => {
    const path = join(temporaryDirectory(), 'reopen.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const otherDb = openPublicationDatabase(path);
    const other = new SqliteInvoiceApprovalRepository(otherDb);
    const reserve = () => f.delivery.reserveEmailDelivery(f.input);
    const reopen = () => other.reopenApprovedInvoiceForEditing(reopenInput);
    const results = await Promise.allSettled(order === 'reserveFirst' ? [reserve(), reopen()] : [reopen(), reserve()]);
    if (order === 'reserveFirst') {
      expect(results).toEqual([
        { status: 'fulfilled', value: expect.objectContaining({ outcome: 'reserved' }) },
        { status: 'rejected', reason: expect.any(InvoiceDeliveryConflictError) },
      ]);
    } else {
      expect(results).toEqual([
        { status: 'fulfilled', value: { invoiceId: f.key.invoiceId, draftId: `${f.key.invoiceId}-draft` } },
        { status: 'fulfilled', value: { outcome: 'conflict' } },
      ]);
    }
    const before = publicationState(f.database);
    f.database.close(); otherDb.close();
    const restartedDb = openPublicationDatabase(path);
    await expect(new SqliteInvoiceDeliveryEventRepository(restartedDb).reserveEmailDelivery({ ...f.input, eventId: 'restart' }))
      .resolves.toEqual({ outcome: 'conflict' });
    const restartedApproval = new SqliteInvoiceApprovalRepository(restartedDb);
    if (order === 'reserveFirst') {
      await expect(restartedApproval.reopenApprovedInvoiceForEditing(reopenInput))
        .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    } else {
      await expect(restartedApproval.reopenApprovedInvoiceForEditing(reopenInput)).resolves.toBeUndefined();
    }
    expect(publicationState(restartedDb)).toEqual(before);
  });

  it.each(['attempted', 'outcomeUnknown'] as const)('blocks direct reapproval of migrated reopened history with %s', async (status) => {
    const database = await historicalDatabase();
    database.prepare("UPDATE invoices SET status = 'reopened_for_edit' WHERE id = 'invoice-1'").run();
    await new SqliteInvoiceDraftRepository(database).updateDraft(createRevisionDraft({
      id: 'draft-1', companyId: 'dev-company', customerId: 'customer-1', billingRecipientCustomerId: null,
    }));
    insert(database, 'invoice_delivery_events', {
      id: 'old-open-event', company_id: 'dev-company', invoice_id: 'invoice-1', document_id: null,
      provider: 'smtp', delivery_method: 'email', status, created_at: '2026-07-01T00:00:00Z',
    });
    await migrate(database);
    expect(database.prepare('SELECT * FROM invoice_current_revisions').all()).toEqual([]);
    const repository = new SqliteInvoiceApprovalRepository(database, {
      getSnapshotData: () => { throw new Error('Unexpected snapshot access before conflict.'); },
    });
    const before = publicationState(database);
    await expect(repository.approveDraft(revisionApprovalInput({
      companyId: 'dev-company', invoiceId: 'unused-new-id', draftId: 'draft-1',
    }))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(repository.approveDraft(revisionApprovalInput({
      companyId: 'foreign-company', draftId: 'draft-1',
    }))).resolves.toBeUndefined();
    expect(publicationState(database)).toEqual(before);
    const path = join(temporaryDirectory(), 'legacy-unresolved.sqlite');
    await database.backup(path);
    database.close();
    const restartedDb = openPublicationDatabase(path);
    await expect(new SqliteInvoiceApprovalRepository(restartedDb).approveDraft(revisionApprovalInput({
      companyId: 'dev-company', invoiceId: 'unused-new-id', draftId: 'draft-1',
    }))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(restartedDb)).toEqual(before);
  });

  it('does not start reopen or reservation while another connection holds the write lock', async () => {
    const path = join(temporaryDirectory(), 'locked-reopen.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const otherDb = openPublicationDatabase(path);
    const before = publicationState(f.database);
    f.database.exec('BEGIN IMMEDIATE');
    try {
      await expect(new SqliteInvoiceApprovalRepository(otherDb).reopenApprovedInvoiceForEditing(reopenInput))
        .rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      await expect(new SqliteInvoiceDeliveryEventRepository(otherDb).reserveEmailDelivery(f.input))
        .rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      expect(publicationState(f.database)).toEqual(before);
    } finally {
      f.database.exec('ROLLBACK');
    }
    expect(publicationState(f.database)).toEqual(before);
  });

  it('does not block own correction for another company unresolved delivery', async () => {
    const f = await createEmailReservationFixture();
    const foreign = await f.approve('foreign-invoice', 'foreign-company');
    const document = documentCandidate(foreign, 'foreign-document');
    expect((await f.repository.publishDocumentIfCurrent({ key: foreign, candidate: document })).outcome).toBe('published');
    await expect(f.delivery.reserveEmailDelivery({ ...f.input, target: {
      ...foreign, kind: 'revision', documentId: document.id, sha256: document.sha256, sizeBytes: document.sizeBytes,
    } })).resolves.toMatchObject({ outcome: 'reserved' });
    await expect(f.approval.repository.reopenApprovedInvoiceForEditing(reopenInput)).resolves.toBeDefined();
    await expect(f.approval.repository.approveDraft(revisionApprovalInput({
      draftId: `${f.key.invoiceId}-draft`, auditEventId: 'reapprove-audit',
    }))).resolves.toMatchObject({ invoiceId: f.key.invoiceId, status: 'approved' });
    expect(readReservedEvent(f.database)).toMatchObject({ invoice_id: foreign.invoiceId, status: 'attempted' });
  });
});
