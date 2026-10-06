import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../domain/invoiceLegacyDeliveryReviewRequiredError.js';
import { reservationFields } from './invoiceEmailReservation.fixture.js';
import { SqliteInvoiceApprovalRepository } from './sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { closePublicationDatabases, createLegacyPublicationFixture, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('transactional hold for unknown legacy approved SMTP delivery', () => {
  it.each(['succeeded', 'attempted', 'outcomeUnknown', 'failed'] as const)(
    'keeps original %s history and rejects direct reopen and manual finalization', async (status) => {
      const f = await createLegacyPublicationFixture({ status });
      setInvoiceStatus(f.database, f.scope, 'approved');
      const reader = new SqliteInvoiceDeliveryEventRepository(f.database);
      expect(await reader.requiresLegacyDeliveryReview(f.scope)).toBe(true);
      for (const scope of [{ ...f.scope, companyId: 'other-company' }, { ...f.scope, invoiceId: 'other-invoice' }]) {
        expect(await reader.requiresLegacyDeliveryReview(scope)).toBe(false);
      }
      const repository = new SqliteInvoiceApprovalRepository(f.database);
      const before = publicationState(f.database);
      const input = { ...f.scope, actorUserId: 'synthetic-actor', auditEventId: 'synthetic-review-event' };
      await expect(repository.reopenApprovedInvoiceForEditing({ ...input, reopenedAt: '2027-01-15T13:00:00.000Z' }))
        .rejects.toBeInstanceOf(InvoiceLegacyDeliveryReviewRequiredError);
      await expect(repository.markApprovedInvoiceSent({ ...input, markedSentAt: '2027-01-15T13:00:00.000Z' }))
        .rejects.toBeInstanceOf(InvoiceLegacyDeliveryReviewRequiredError);
      expect(publicationState(f.database)).toEqual(before);
    },
  );

  it.each(['sent', 'reopened_for_edit', 'cancelled'] as const)('does not extend this hold to %s invoices', async (status) => {
    const f = await createLegacyPublicationFixture();
    setInvoiceStatus(f.database, f.scope, status);
    expect(await new SqliteInvoiceDeliveryEventRepository(f.database).requiresLegacyDeliveryReview(f.scope)).toBe(false);
  });

  it.each([null, { status: 'succeeded', provider: 'dryRun' }, { status: 'succeeded', provider: 'gmail' },
    { status: 'succeeded', provider: 'microsoft' }] as const)(
    'does not infer unknown SMTP mode from other history %j', async (event) => {
      const f = await createLegacyPublicationFixture(event);
      setInvoiceStatus(f.database, f.scope, 'approved');
      expect(await new SqliteInvoiceDeliveryEventRepository(f.database).requiresLegacyDeliveryReview(f.scope)).toBe(false);
    },
  );

  it('rechecks the hold at reservation, without invalidating a valid sent-invoice resend', async () => {
    const f = await createLegacyPublicationFixture();
    const publication = await f.repository.publishPreservedLegacyDocument(f);
    expect(publication.outcome).toBe('published');
    const repository = new SqliteInvoiceDeliveryEventRepository(f.database);
    expect(await repository.requiresLegacyDeliveryReview(f.scope)).toBe(false);
    const input = { ...reservationFields, eventId: 'new-resend', mode: 'customer' as const, target: {
      ...f.scope, kind: 'preservedLegacy' as const, documentId: f.candidate.id, sourceDocumentId: f.original.id,
      sha256: f.original.sha256, sizeBytes: f.original.sizeBytes,
    } };
    // A changed state after a preflight cannot authorize a send. The exact PDF exists.
    setInvoiceStatus(f.database, f.scope, 'approved');
    const before = publicationState(f.database);
    await expect(repository.reserveEmailDelivery(input)).rejects.toBeInstanceOf(InvoiceLegacyDeliveryReviewRequiredError);
    expect(publicationState(f.database)).toEqual(before);
    setInvoiceStatus(f.database, f.scope, 'sent');
    await expect(repository.reserveEmailDelivery(input)).resolves.toMatchObject({
      outcome: 'reserved', invoiceStatusAtReservation: 'sent',
    });
  });
});
