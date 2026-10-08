import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import { createPublicationFixture, documentCandidate, openPublicationDatabase } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';

export async function createEmailReservationFixture(database: DatabaseConnection = openPublicationDatabase()) {
  const f = await createPublicationFixture(database);
  const published = await f.repository.publishDocumentIfCurrent({ key: f.key, candidate: documentCandidate(f.key) });
  if (published.outcome === 'conflict') throw new Error('Synthetic document publication failed.');
  const target: RevisionInvoiceDeliveryTarget = {
    ...f.key, kind: 'revision', documentId: published.document.id,
    sha256: published.document.sha256, sizeBytes: published.document.sizeBytes,
  };
  const input = { eventId: 'reserved-event', mode: 'customer' as const, target, ...reservationFields };
  return { ...f, database, document: published.document, input,
    delivery: new SqliteInvoiceDeliveryEventRepository(database) };
}

export const reservationFields = {
  recipientEmail: 'recipient@example.invalid', ccEmail: '', subject: 'Synthetic invoice',
  bodyPreview: 'Synthetic preview', createdAt: '2027-01-15T13:00:00.000Z', createdBy: 'synthetic-actor',
};

export function readReservedEvent(database: DatabaseConnection, eventId = 'reserved-event') {
  return database.prepare<[string], InvoiceDeliveryEventRow>(
    'SELECT * FROM invoice_delivery_events WHERE id = ?',
  ).get(eventId);
}

export function invoiceDeliveryState(database: DatabaseConnection) {
  return database.prepare('SELECT status, updated_at FROM invoices ORDER BY id').all();
}
