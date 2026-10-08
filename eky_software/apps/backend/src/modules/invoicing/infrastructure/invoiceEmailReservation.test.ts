import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { insert, removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { documentRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDeliveryReservation } from '../domain/invoiceDeliveryReservation.js';
import type { ReserveEmailDeliveryInput } from '../ports/invoiceDeliveryEventRepository.js';
import { createEmailReservationFixture, invoiceDeliveryState, readReservedEvent, reservationFields } from './invoiceEmailReservation.fixture.js';
import { closePublicationDatabases, createLegacyPublicationFixture, nextPublicationRevision, openPublicationDatabase, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('persistent exact SMTP reservation', () => {
  it.each(['customer', 'smtpTest'] as const)('reserves %s before network without changing the invoice', async (mode) => {
    const f = await createEmailReservationFixture();
    const before = invoiceDeliveryState(f.database);
    const input = { ...f.input, mode, ccEmail: mode === 'customer' ? 'copy@example.invalid' : '' };
    await expect(f.delivery.reserveEmailDelivery(input)).resolves.toEqual({
      outcome: 'reserved', reservation: { eventId: input.eventId, mode, target: f.input.target },
      invoiceStatusAtReservation: 'approved',
    });
    expect(readReservedEvent(f.database)).toMatchObject({
      status: 'attempted', provider: 'smtp', delivery_method: 'email', send_mode: mode,
      company_id: f.key.companyId, invoice_id: f.key.invoiceId, revision_id: f.key.revisionId,
      document_id: f.document.id, document_sha256: f.document.sha256, document_size_bytes: f.document.sizeBytes,
      recipient_email: input.recipientEmail, cc_email: input.ccEmail, body_preview: input.bodyPreview,
      subject: input.subject, created_by: input.createdBy, created_at: input.createdAt,
      provider_message_id: null, safe_error_message: null, technical_error_code: null,
    });
    expect(invoiceDeliveryState(f.database)).toEqual(before);
  });

  it.each([
    { companyId: 'foreign-company' }, { invoiceId: 'foreign-invoice' }, { revisionId: 'foreign-revision' },
    { documentId: 'missing-document' }, { sha256: 'b'.repeat(64) }, { sizeBytes: 21 },
  ])('rejects changed target %j without writing', async (change) => {
    const f = await createEmailReservationFixture();
    const before = publicationState(f.database);
    await expect(f.delivery.reserveEmailDelivery({ ...f.input, target: { ...f.input.target, ...change } }))
      .resolves.toEqual({ outcome: 'conflict' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['cancelled', 'reopened_for_edit'] as const)('rejects %s and an old revision', async (status) => {
    const f = await createEmailReservationFixture();
    setInvoiceStatus(f.database, f.key, status);
    await expect(f.delivery.reserveEmailDelivery(f.input)).resolves.toEqual({ outcome: 'conflict' });
    setInvoiceStatus(f.database, f.key, 'approved');
    nextPublicationRevision(f.database, f.key);
    await expect(f.delivery.reserveEmailDelivery(f.input)).resolves.toEqual({ outcome: 'conflict' });
    expect(readReservedEvent(f.database)).toBeUndefined();
  });

  it('allows only one reservation across two connections and retains it after reopen', async () => {
    const path = join(temporaryDirectory(), 'reservation.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const otherDb = openPublicationDatabase(path);
    const other = new SqliteInvoiceDeliveryEventRepository(otherDb);
    const results = await Promise.all([
      f.delivery.reserveEmailDelivery(f.input), other.reserveEmailDelivery({ ...f.input, eventId: 'second' }),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(['reserved', 'conflict']);
    const before = readReservedEvent(f.database);
    f.database.close(); otherDb.close();
    const restartedDb = openPublicationDatabase(path);
    const restarted = new SqliteInvoiceDeliveryEventRepository(restartedDb);
    await expect(restarted.reserveEmailDelivery({ ...f.input, eventId: 'after-restart' }))
      .resolves.toEqual({ outcome: 'conflict' });
    expect(readReservedEvent(restartedDb)).toEqual(before);
  });

  it('begins IMMEDIATE before reading eligibility and rolls back insert failure', async () => {
    const sql: string[] = [];
    const f = await createEmailReservationFixture(openPublicationDatabase(':memory:', (statement) => sql.push(statement)));
    f.database.exec("CREATE TRIGGER synthetic_reserve_failure BEFORE INSERT ON invoice_delivery_events BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END");
    const before = publicationState(f.database);
    sql.length = 0;
    await expect(f.delivery.reserveEmailDelivery(f.input)).rejects.toThrow('SYNTHETIC');
    expect(sql[0]).toBe('BEGIN IMMEDIATE');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['attempted', 'outcomeUnknown', 'failed'] as const)('rejects migrated legacy %s history', async (status) => {
    const f = await createLegacyPublicationFixture({ status });
    // A valid preserved target isolates the history guard from the missing-document guard.
    insert(f.database, 'invoice_documents', documentRow({
      id: f.candidate.id, storage_path: f.candidate.storagePath,
      binding_kind: 'preservedLegacy', revision_id: null, source_document_id: f.original.id,
    }));
    const input: ReserveEmailDeliveryInput = { ...reservationFields, eventId: 'new', mode: 'customer', target: {
      ...f.scope, kind: 'preservedLegacy', sourceDocumentId: f.original.id, documentId: f.candidate.id,
      sha256: f.original.sha256, sizeBytes: f.original.sizeBytes,
    } };
    const before = publicationState(f.database);
    await expect(new SqliteInvoiceDeliveryEventRepository(f.database).reserveEmailDelivery(input)).resolves.toEqual({ outcome: 'conflict' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each([true, false])('requires an unambiguous original event reference (present=%s)', async (present) => {
    const f = await createLegacyPublicationFixture({ status: 'succeeded', ...(present ? {} : { documentId: null }) });
    const published = await f.repository.publishPreservedLegacyDocument({ scope: f.scope, source: f.source, candidate: f.candidate });
    expect(published.outcome).toBe(present ? 'published' : 'conflict');
    const input: ReserveEmailDeliveryInput = { ...reservationFields, eventId: 'new', mode: 'customer', target: {
      ...f.scope, kind: 'preservedLegacy', sourceDocumentId: f.original.id, documentId: f.candidate.id,
      sha256: f.original.sha256, sizeBytes: f.original.sizeBytes,
    } };
    const before = readReservedEvent(f.database, 'legacy-smtp-event');
    const result = await new SqliteInvoiceDeliveryEventRepository(f.database).reserveEmailDelivery(input);
    expect(result.outcome).toBe(present ? 'reserved' : 'conflict');
    expect(readReservedEvent(f.database, 'legacy-smtp-event')).toEqual(before);
    if (result.outcome === 'reserved') expect(result.invoiceStatusAtReservation).toBe('sent');
  });

  it('denies runtime attempts to bypass SMTP reservation or use legacy test mode', async () => {
    const f = await createEmailReservationFixture();
    const invalid = { ...f.input, mode: 'smtpTest', target: { ...f.input.target, kind: 'preservedLegacy', sourceDocumentId: 'old' } };
    await expect(f.delivery.reserveEmailDelivery(invalid as ReserveEmailDeliveryInput)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.delivery.reserveEmailDelivery({ ...f.input, mode: 'smtpTest', ccEmail: 'copy@example.invalid' }))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    // The general historical writer must not remain an alternative SMTP entrypoint.
    await expect(f.delivery.saveDeliveryEvent({ provider: 'smtp' } as never)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(readReservedEvent(f.database)).toBeUndefined();
  });
});

function checkReservationTypes(target: InvoiceDeliveryReservation['target']) {
  if (target.kind !== 'preservedLegacy') return;
  // @ts-expect-error A preserved legacy document is never an SMTP self-test target.
  const invalid: InvoiceDeliveryReservation = { eventId: 'type-only', mode: 'smtpTest', target };
  return invalid;
}
void checkReservationTypes;
