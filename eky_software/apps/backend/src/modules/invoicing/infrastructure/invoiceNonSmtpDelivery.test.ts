import { afterEach, describe, expect, it } from 'vitest';

import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import type { CompleteManualInvoiceDeliveryInput } from '../ports/invoiceManualDeliveryFinalizer.js';
import { createEmailReservationFixture } from './invoiceEmailReservation.fixture.js';
import { closePublicationDatabases, nextPublicationRevision, openPublicationDatabase, publicationState } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);

describe('revision-bound manual and dry-run delivery', () => {
  it('records manual delivery and its exact content evidence atomically', async () => {
    const f = await createEmailReservationFixture();
    await expect(f.delivery.completeManualDelivery(manualInput(f.input.target))).resolves.toMatchObject({ outcome: 'completed' });
    expect(f.database.prepare('SELECT binding_kind, revision_id, send_mode, document_sha256, document_size_bytes FROM invoice_delivery_events').get())
      .toEqual({ binding_kind: 'revision', revision_id: f.key.revisionId, send_mode: 'manual',
        document_sha256: f.document.sha256, document_size_bytes: f.document.sizeBytes });
  });

  it('rejects a dry-run that attempts to smuggle an unresolved SMTP status', async () => {
    const f = await createEmailReservationFixture();
    const before = publicationState(f.database);
    await expect(f.delivery.saveDeliveryEvent({ ...dryRunEvent(f.input.target), status: 'attempted' } as unknown as InvoiceDryRunDeliveryEvent))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['manual', 'print'] as const)('does not duplicate %s events, audit or timestamp for a competing completion', async (deliveryMethod) => {
    const f = await createEmailReservationFixture();
    await f.delivery.completeManualDelivery({ ...manualInput(f.input.target), deliveryMethod });
    const before = publicationState(f.database);
    await expect(f.delivery.completeManualDelivery({ ...manualInput(f.input.target), deliveryMethod,
      deliveryEventId: 'second-event', auditEventId: 'second-audit', deliveredAt: '2027-01-17T00:00:00Z',
    })).resolves.toEqual({ outcome: 'alreadySent', updatedAt: manualInput(f.input.target).deliveredAt });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['succeeded', 'failed'] as const)('retains exact dry-run %s history without changing status or blocking reopen', async (status) => {
    const f = await createEmailReservationFixture();
    const before = publicationState(f.database);
    const event = { ...dryRunEvent(f.input.target), status };
    await expect(f.delivery.saveDeliveryEvent(event)).resolves.toEqual(event);
    const after = publicationState(f.database);
    expect({ ...after, events: [] }).toEqual(before);
    expect(after.events).toEqual([expect.objectContaining({
      send_mode: 'dryRun', revision_id: f.key.revisionId,
      document_sha256: f.document.sha256, document_size_bytes: f.document.sizeBytes,
    })]);
    await expect(f.approval.repository.reopenApprovedInvoiceForEditing({
      ...f.key, actorUserId: 'synthetic-actor', auditEventId: 'reopen-audit', reopenedAt: event.createdAt,
    })).resolves.toBeDefined();
    expect(publicationState(f.database).events).toEqual(after.events);
    expect(publicationState(f.database).documents).toEqual(before.documents);
  });

  it.each(['companyId', 'invoiceId', 'revisionId', 'documentId', 'sha256', 'sizeBytes'] as const)(
    'rejects wrong %s without any write in either path', async (field) => {
      const f = await createEmailReservationFixture();
      const target = { ...f.input.target, [field]: field === 'sizeBytes' ? 138 : field === 'sha256' ? 'a'.repeat(64) : 'wrong-id' };
      const before = publicationState(f.database);
      const manual = f.delivery.completeManualDelivery(manualInput(target));
      if (field === 'companyId' || field === 'invoiceId') await expect(manual).resolves.toBeUndefined();
      else await expect(manual).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      await expect(f.delivery.saveDeliveryEvent(dryRunEvent(target))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      expect(publicationState(f.database)).toEqual(before);
    },
  );

  it('rejects stale revision after a new current pointer was published', async () => {
    const f = await createEmailReservationFixture();
    nextPublicationRevision(f.database, f.key);
    const before = publicationState(f.database);
    await expect(f.delivery.completeManualDelivery(manualInput(f.input.target))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.delivery.saveDeliveryEvent(dryRunEvent(f.input.target))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['customer', 'smtpTest'] as const)('blocks manual delivery when %s is unresolved', async (mode) => {
    const f = await createEmailReservationFixture();
    const reservation = { ...f.input, mode };
    await f.delivery.reserveEmailDelivery(reservation);
    for (const status of ['attempted', 'outcomeUnknown'] as const) {
      if (status === 'outcomeUnknown') await f.delivery.completeDeliveryEvent({ reservation,
        result: { status, safeErrorMessage: null, technicalErrorCode: null },
      });
      const before = publicationState(f.database);
      await expect(f.delivery.completeManualDelivery(manualInput(f.input.target))).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
      expect(publicationState(f.database)).toEqual(before);
    }
  });

  it('rolls back event and sent transition if manual audit fails, starting IMMEDIATE before reads', async () => {
    const statements: string[] = [];
    const f = await createEmailReservationFixture(openPublicationDatabase(':memory:', (sql) => statements.push(sql)));
    f.database.exec(`CREATE TRIGGER synthetic_manual_audit_failure BEFORE INSERT ON invoice_audit_events
      WHEN NEW.action = 'invoice.marked_sent_manually' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END`);
    const before = publicationState(f.database);
    statements.length = 0;
    await expect(f.delivery.completeManualDelivery(manualInput(f.input.target))).rejects.toThrow('SYNTHETIC');
    expect(statements[0]).toBe('BEGIN IMMEDIATE');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['smtp', 'manual', 'gmail', 'microsoft'] as const)('rejects %s through the dry-run writer', async (provider) => {
    const f = await createEmailReservationFixture();
    const before = publicationState(f.database);
    await expect(f.delivery.saveDeliveryEvent({ ...dryRunEvent(f.input.target), provider } as unknown as InvoiceDryRunDeliveryEvent))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
  });
});

function manualInput(target: RevisionInvoiceDeliveryTarget): CompleteManualInvoiceDeliveryInput {
  return { target, actorUserId: 'synthetic-actor', auditEventId: 'manual-audit', deliveryEventId: 'manual-event',
    deliveryMethod: 'print', deliveredAt: '2027-01-16T08:00:00.000Z' };
}

function dryRunEvent(target: RevisionInvoiceDeliveryTarget): InvoiceDryRunDeliveryEvent {
  return {
    id: 'dry-run-event', companyId: target.companyId, invoiceId: target.invoiceId,
    documentId: target.documentId, target, provider: 'dryRun', deliveryMethod: 'email', status: 'succeeded',
    recipientEmail: 'recipient@example.invalid', ccEmail: '', subject: '', bodyPreview: '',
    providerMessageId: null, safeErrorMessage: null, technicalErrorCode: null,
    createdAt: '2027-01-16T08:00:00.000Z', createdBy: 'synthetic-actor',
  };
}
