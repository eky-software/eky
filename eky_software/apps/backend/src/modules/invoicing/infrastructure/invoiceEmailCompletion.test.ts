import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { CustomerEmailCompletionInput, OtherEmailCompletionInput } from '../domain/invoiceDeliveryReservation.js';
import { createEmailReservationFixture, invoiceDeliveryState, readReservedEvent, reservationFields } from './invoiceEmailReservation.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { closePublicationDatabases, createLegacyPublicationFixture, nextPublicationRevision, openPublicationDatabase, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

const success = { status: 'succeeded' as const, providerMessageId: '<synthetic@example.invalid>' };

describe('exact SMTP completion', () => {
  it('atomically marks customer success with the reservation time and makes repeats a no-op', async () => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    const input = { reservation: f.input, result: success };
    await expect(f.delivery.completeSuccessfulEmailDelivery(input)).resolves.toEqual({ outcome: 'completed' });
    expect(invoiceDeliveryState(f.database)).toEqual([{ status: 'sent', updated_at: f.input.createdAt }]);
    expect(readReservedEvent(f.database)).toMatchObject({ status: 'succeeded', provider_message_id: success.providerMessageId });
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({ ...input,
      result: { ...success, providerMessageId: ` ${success.providerMessageId} ` },
    })).resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it('completes SMTP self-test without sent, even when the same acknowledgement is repeated after reopening', async () => {
    const f = await createEmailReservationFixture();
    const reservation = { ...f.input, mode: 'smtpTest' as const };
    const beforeInvoice = invoiceDeliveryState(f.database);
    await f.delivery.reserveEmailDelivery(reservation);
    await expect(f.delivery.completeDeliveryEvent({ reservation, result: success })).resolves.toEqual({ outcome: 'completed' });
    expect(invoiceDeliveryState(f.database)).toEqual(beforeInvoice);
    setInvoiceStatus(f.database, f.key, 'reopened_for_edit');
    const before = publicationState(f.database);
    await expect(f.delivery.completeDeliveryEvent({ reservation, result: success })).resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it('keeps resend timestamps and identifies later repetitions without changing a newer reservation', async () => {
    const f = await createEmailReservationFixture();
    setInvoiceStatus(f.database, f.key, 'sent');
    const beforeInvoice = invoiceDeliveryState(f.database);
    const reserved = await f.delivery.reserveEmailDelivery(f.input);
    expect(reserved).toMatchObject({ outcome: 'reserved', invoiceStatusAtReservation: 'sent' });
    await f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success });
    expect(invoiceDeliveryState(f.database)).toEqual(beforeInvoice);
    const next = { ...f.input, eventId: 'next-attempt' };
    await f.delivery.reserveEmailDelivery(next);
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success }))
      .resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(publicationState(f.database)).toEqual(before);
    expect(readReservedEvent(f.database, next.eventId)?.status).toBe('attempted');
  });

  it.each(['customer', 'smtpTest'] as const)('retains failed/unknown outcomes for %s and never marks sent', async (mode) => {
    for (const status of ['failed', 'outcomeUnknown'] as const) {
      const f = await createEmailReservationFixture();
      const reservation = { ...f.input, mode };
      const result = { status, safeErrorMessage: 'Safe delivery outcome.', technicalErrorCode: 'SAFE_TEST_CODE' };
      const beforeInvoice = invoiceDeliveryState(f.database);
      await f.delivery.reserveEmailDelivery(reservation);
      await expect(f.delivery.completeDeliveryEvent({ reservation, result })).resolves.toEqual({ outcome: 'completed' });
      await expect(f.delivery.completeDeliveryEvent({ reservation, result })).resolves.toEqual({ outcome: 'alreadyCompleted' });
      expect(invoiceDeliveryState(f.database)).toEqual(beforeInvoice);
      expect(readReservedEvent(f.database)).toMatchObject({
        status, safe_error_message: result.safeErrorMessage, technical_error_code: result.technicalErrorCode,
        provider_message_id: null,
      });
      const next = await f.delivery.reserveEmailDelivery({ ...reservation, eventId: 'next-attempt' });
      expect(next.outcome).toBe(status === 'failed' ? 'reserved' : 'conflict');
    }
  });

  it.each([
    { companyId: 'other-company' }, { invoiceId: 'other-invoice' }, { revisionId: 'other-revision' },
    { documentId: 'other-document' }, { sha256: 'c'.repeat(64) }, { sizeBytes: 33 },
  ])('rejects changed completion target %j without mutations', async (change) => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({ result: success,
      reservation: { ...f.input, target: { ...f.input.target, ...change } },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
  });

  it('rejects wrong event, completion entrypoint, mode and inconsistent terminal acknowledgements', async () => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({
      reservation: { ...f.input, eventId: 'absent' }, result: success,
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.delivery.completeDeliveryEvent({ reservation: f.input, result: success } as unknown as OtherEmailCompletionInput))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.delivery.completeSuccessfulEmailDelivery({
      reservation: { ...f.input, mode: 'smtpTest' }, result: success,
    } as unknown as CustomerEmailCompletionInput)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
    await f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success });
    const completed = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({
      reservation: f.input, result: { ...success, providerMessageId: 'different' },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.delivery.completeDeliveryEvent({ reservation: f.input,
      result: { status: 'failed', safeErrorMessage: null, technicalErrorCode: null },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(completed);
  });

  it.each(['revision', 'cancelled', 'reopened_for_edit'] as const)('does not mark a changed %s target sent', async (change) => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    if (change === 'revision') nextPublicationRevision(f.database, f.key);
    else setInvoiceStatus(f.database, f.key, change);
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success }))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(f.database)).toEqual(before);
    expect(readReservedEvent(f.database)?.status).toBe('attempted');
    await expect(f.delivery.completeDeliveryEvent({ reservation: f.input,
      result: { status: 'outcomeUnknown', safeErrorMessage: 'Could not finalize.', technicalErrorCode: null },
    })).resolves.toEqual({ outcome: 'completed' });
  });

  it('rolls back event completion when the invoice transition fails', async () => {
    const f = await createEmailReservationFixture();
    await f.delivery.reserveEmailDelivery(f.input);
    f.database.exec("CREATE TRIGGER synthetic_sent_failure BEFORE UPDATE OF status ON invoices WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END");
    const before = publicationState(f.database);
    await expect(f.delivery.completeSuccessfulEmailDelivery({ reservation: f.input, result: success })).rejects.toThrow('SYNTHETIC');
    expect(publicationState(f.database)).toEqual(before);
  });

  it('persists unknown outcome and blocks a new attempt after database restart', async () => {
    const path = join(temporaryDirectory(), 'completion.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    await f.delivery.reserveEmailDelivery(f.input);
    const input: OtherEmailCompletionInput = { reservation: f.input,
      result: { status: 'outcomeUnknown', safeErrorMessage: null, technicalErrorCode: null } };
    await f.delivery.completeDeliveryEvent(input);
    f.database.close();
    const database = openPublicationDatabase(path);
    const repository = new SqliteInvoiceDeliveryEventRepository(database);
    const before = publicationState(database);
    await expect(repository.completeDeliveryEvent(input)).resolves.toEqual({ outcome: 'alreadyCompleted' });
    await expect(repository.reserveEmailDelivery({ ...f.input, eventId: 'restart-attempt' })).resolves.toEqual({ outcome: 'conflict' });
    await expect(repository.completeSuccessfulEmailDelivery({ reservation: f.input, result: success }))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(publicationState(database)).toEqual(before);
  });

  it('completes a preserved legacy resend without changing the original history or invoice', async () => {
    const f = await createLegacyPublicationFixture({ status: 'succeeded' });
    await f.repository.publishPreservedLegacyDocument({ scope: f.scope, source: f.source, candidate: f.candidate });
    const input = { ...reservationFields, eventId: 'new-legacy-attempt', mode: 'customer' as const, target: {
      ...f.scope, kind: 'preservedLegacy' as const, documentId: f.candidate.id, sourceDocumentId: f.original.id,
      sha256: f.original.sha256, sizeBytes: f.original.sizeBytes,
    } };
    const repository = new SqliteInvoiceDeliveryEventRepository(f.database);
    const beforeInvoice = invoiceDeliveryState(f.database);
    const original = readReservedEvent(f.database, 'legacy-smtp-event');
    await repository.reserveEmailDelivery(input);
    await expect(repository.completeSuccessfulEmailDelivery({ reservation: input, result: success })).resolves.toEqual({ outcome: 'completed' });
    await expect(repository.completeSuccessfulEmailDelivery({ reservation: input, result: success })).resolves.toEqual({ outcome: 'alreadyCompleted' });
    expect(invoiceDeliveryState(f.database)).toEqual(beforeInvoice);
    expect(readReservedEvent(f.database, 'legacy-smtp-event')).toEqual(original);
    await expect(repository.completeSuccessfulEmailDelivery({ result: success,
      reservation: { ...input, target: { ...input.target, sourceDocumentId: 'other-source' } },
    })).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
  });
});
