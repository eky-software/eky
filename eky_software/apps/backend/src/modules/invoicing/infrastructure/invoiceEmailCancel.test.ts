import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createEmailReservationFixture } from './invoiceEmailReservation.fixture.js';
import { SqliteInvoiceCorrectionRepository } from './sqliteInvoiceCorrectionRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { closePublicationDatabases, openPublicationDatabase, publicationState } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

function cancel(database: DatabaseConnection) {
  const invoice = database.prepare<[], { invoice_number: string }>(
    "SELECT invoice_number FROM invoices WHERE company_id = 'revision-company' AND id = 'revision-invoice'",
  ).get();
  if (!invoice) throw new Error('Synthetic invoice missing.');
  return new SqliteInvoiceCorrectionRepository(database).cancelApprovedInvoice({
    companyId: 'revision-company', invoiceId: 'revision-invoice', actorUserId: 'synthetic-actor',
    auditEventId: 'cancel-audit', confirmationInvoiceNumber: invoice.invoice_number,
    cancellationReason: 'Synthetic cancellation', cancelledAt: '2027-01-16T08:00:00.000Z',
  });
}

describe('cancellation with persistent SMTP reservations', () => {
  it.each(['customer', 'smtpTest'] as const)('retains unresolved %s history and blocks cancellation after restart', async (mode) => {
    const path = join(temporaryDirectory(), 'unresolved.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const reservation = { ...f.input, mode };
    await f.delivery.reserveEmailDelivery(reservation);
    for (const status of ['attempted', 'outcomeUnknown'] as const) {
      if (status === 'outcomeUnknown') await f.delivery.completeDeliveryEvent({ reservation,
        result: { status, safeErrorMessage: null, technicalErrorCode: null },
      });
      const before = publicationState(f.database);
      await expect(cancel(f.database)).resolves.toEqual({ outcome: 'deliveryConflict' });
      const restarted = openPublicationDatabase(path);
      await expect(cancel(restarted)).resolves.toEqual({ outcome: 'deliveryConflict' });
      expect(publicationState(restarted)).toEqual(before);
      restarted.close();
      expect(publicationState(f.database)).toEqual(before);
    }
  });

  it.each([
    ['customer', 'reserveFirst'], ['customer', 'cancelFirst'],
    ['smtpTest', 'reserveFirst'], ['smtpTest', 'cancelFirst'],
  ] as const)('serializes %s / %s across connections and preserves the decision after restart', async (mode, order) => {
    const path = join(temporaryDirectory(), 'cancel.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const other = openPublicationDatabase(path);
    const reservation = { ...f.input, mode };
    const reserve = () => f.delivery.reserveEmailDelivery(reservation);
    const results = await Promise.all(order === 'reserveFirst'
      ? [reserve(), cancel(other)] : [cancel(other), reserve()]);
    expect(results).toEqual(order === 'reserveFirst'
      ? [expect.objectContaining({ outcome: 'reserved' }), { outcome: 'deliveryConflict' }]
      : [expect.objectContaining({ outcome: 'cancelled' }), { outcome: 'conflict' }]);
    const before = publicationState(f.database);
    f.database.close(); other.close();
    const restarted = openPublicationDatabase(path);
    await expect(new SqliteInvoiceDeliveryEventRepository(restarted).reserveEmailDelivery({
      ...reservation, eventId: 'after-restart',
    })).resolves.toEqual({ outcome: 'conflict' });
    await expect(cancel(restarted)).resolves.toEqual({
      outcome: order === 'reserveFirst' ? 'deliveryConflict' : 'notCancellable',
    });
    expect(publicationState(restarted)).toEqual(before);
  });

  it.each(['customer', 'smtpTest'] as const)('allows cancellation after confirmed %s failure without removing its evidence', async (mode) => {
    const f = await createEmailReservationFixture();
    const reservation = { ...f.input, mode };
    await f.delivery.reserveEmailDelivery(reservation);
    await f.delivery.completeDeliveryEvent({ reservation,
      result: { status: 'failed', safeErrorMessage: null, technicalErrorCode: null },
    });
    const before = publicationState(f.database);
    await expect(cancel(f.database)).resolves.toMatchObject({ outcome: 'cancelled' });
    const after = publicationState(f.database);
    expect(after.documents).toEqual(before.documents);
    expect(after.events).toEqual(before.events);
    await expect(f.delivery.reserveEmailDelivery({ ...reservation, eventId: 'after-cancellation' }))
      .resolves.toEqual({ outcome: 'conflict' });
  });

  it('does not write cancellation or reservation while another connection owns the write lock', async () => {
    const path = join(temporaryDirectory(), 'locked.sqlite');
    const f = await createEmailReservationFixture(openPublicationDatabase(path));
    const other = openPublicationDatabase(path);
    const before = publicationState(f.database);
    f.database.exec('BEGIN IMMEDIATE');
    try {
      await expect(cancel(other)).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      await expect(new SqliteInvoiceDeliveryEventRepository(other).reserveEmailDelivery(f.input))
        .rejects.toMatchObject({ code: 'SQLITE_BUSY' });
      expect(publicationState(f.database)).toEqual(before);
    } finally {
      f.database.exec('ROLLBACK');
    }
    expect(publicationState(f.database)).toEqual(before);
  });
});
