import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  historicalDatabase,
  insert,
  migrate,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { InvoiceDeliveryEventRow } from '../../../database/schema.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { ReservedEmailFields } from '../ports/invoiceDeliveryEventRepository.js';
import type { CompleteManualInvoiceDeliveryInput } from '../ports/invoiceManualDeliveryFinalizer.js';
import { createEmailReservationFixture } from './invoiceEmailReservation.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import {
  documentCandidate,
  publishValidatedLegacyRevision,
} from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';

export type DeliveryRepositoryFixture = Awaited<ReturnType<typeof createEmailReservationFixture>>;
type ReservationOverrides = Partial<ReservedEmailFields & {
  eventId: string;
  target: RevisionInvoiceDeliveryTarget;
}>;

export function createDryRunEvent(
  target: RevisionInvoiceDeliveryTarget,
  overrides: Partial<InvoiceDryRunDeliveryEvent> = {},
): InvoiceDryRunDeliveryEvent {
  return {
    bodyPreview: 'Synthetic invoice attached.',
    ccEmail: 'copy@example.invalid',
    companyId: target.companyId,
    createdAt: '2027-01-15T13:00:00.000Z',
    createdBy: 'synthetic-actor',
    deliveryMethod: 'email',
    documentId: target.documentId,
    id: 'event-1',
    invoiceId: target.invoiceId,
    provider: 'dryRun',
    providerMessageId: null,
    recipientEmail: 'customer@example.invalid',
    safeErrorMessage: null,
    status: 'succeeded',
    subject: 'Synthetic invoice 20270001',
    technicalErrorCode: null,
    target,
    ...overrides,
  };
}

export function manualDeliveryInput(
  target: RevisionInvoiceDeliveryTarget,
  overrides: Partial<CompleteManualInvoiceDeliveryInput> = {},
): CompleteManualInvoiceDeliveryInput {
  return {
    actorUserId: 'synthetic-actor',
    auditEventId: 'audit-manual-1',
    deliveredAt: '2027-01-15T15:00:00.000Z',
    deliveryEventId: 'manual-event-1',
    deliveryMethod: 'manual',
    target,
    ...overrides,
  };
}

export async function reserveCustomerDelivery(
  fixture: DeliveryRepositoryFixture,
  overrides: ReservationOverrides = {},
) {
  const result = await fixture.delivery.reserveEmailDelivery({ ...fixture.input, ...overrides });
  if (result.outcome !== 'reserved' || result.reservation.mode !== 'customer') {
    throw new Error('Synthetic customer delivery was not reserved.');
  }
  return { ...result, reservation: result.reservation };
}

export async function reserveSmtpTestDelivery(
  fixture: DeliveryRepositoryFixture,
  overrides: ReservationOverrides = {},
) {
  const result = await fixture.delivery.reserveEmailDelivery({
    ...fixture.input, ...overrides, mode: 'smtpTest',
  });
  if (result.outcome !== 'reserved' || result.reservation.mode !== 'smtpTest') {
    throw new Error('Synthetic SMTP test delivery was not reserved.');
  }
  return result.reservation;
}

export const unresolvedDeliveryCases = (['attempted', 'outcomeUnknown'] as const).flatMap((status) => [
  { source: 'customer' as const, provider: 'smtp' as const, status },
  { source: 'smtpTest' as const, provider: 'smtp' as const, status },
  ...(['dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other'] as const).map((provider) => ({
    source: 'legacy' as const, provider, status,
  })),
]);

export async function createUnresolvedDeliveryFixture(
  fixture: DeliveryRepositoryFixture,
  testCase: (typeof unresolvedDeliveryCases)[number],
) {
  if (testCase.source === 'legacy') {
    return createMigratedUnresolvedDeliveryFixture(testCase.provider, testCase.status);
  }
  const reservation = testCase.source === 'customer'
    ? (await reserveCustomerDelivery(fixture)).reservation
    : await reserveSmtpTestDelivery(fixture);
  if (testCase.status === 'outcomeUnknown') {
    await fixture.delivery.completeDeliveryEvent({
      reservation,
      result: {
        status: 'outcomeUnknown',
        safeErrorMessage: 'Outcome unknown.',
        technicalErrorCode: 'SMTP_FINAL_RESPONSE_MISSING',
      },
    });
  }
  return { database: fixture.database, delivery: fixture.delivery, target: fixture.input.target };
}

async function createMigratedUnresolvedDeliveryFixture(
  provider: InvoiceDeliveryEvent['provider'],
  status: 'attempted' | 'outcomeUnknown',
) {
  const database = await historicalDatabase();
  // Unsupported new-send providers exist only as real pre-039 history.
  insert(database, 'invoice_delivery_events', {
    id: 'legacy-unresolved-event',
    company_id: 'dev-company',
    invoice_id: 'invoice-1',
    document_id: null,
    delivery_method: provider === 'manual' ? 'manual' : provider === 'other' ? 'other' : 'email',
    provider,
    status,
    created_at: '2026-07-10T10:00:00.000Z',
  });
  await migrate(database);
  const key = publishValidatedLegacyRevision(database);
  const published = await new SqliteInvoiceDocumentRepository(database).publishDocumentIfCurrent({
    key, candidate: documentCandidate(key),
  });
  if (published.outcome === 'conflict') throw new Error('Synthetic document publication failed.');
  const target: RevisionInvoiceDeliveryTarget = {
    ...key,
    kind: 'revision',
    documentId: published.document.id,
    sha256: published.document.sha256,
    sizeBytes: published.document.sizeBytes,
  };
  return { database, target, delivery: new SqliteInvoiceDeliveryEventRepository(database) };
}

export function readInvoiceStatus(database: DatabaseConnection, invoiceId: string) {
  return database.prepare<[string], { status: string; updated_at: string }>(
    'SELECT status, updated_at FROM invoices WHERE id = ?',
  ).get(invoiceId);
}

export function readEventTerminalFields(database: DatabaseConnection, eventId: string) {
  return database.prepare<[string], Pick<InvoiceDeliveryEventRow,
    'provider_message_id' | 'safe_error_message' | 'status' | 'technical_error_code'
  >>(`
    SELECT provider_message_id, safe_error_message, status, technical_error_code
    FROM invoice_delivery_events WHERE id = ?
  `).get(eventId);
}

export function countDeliveryEvents(database: DatabaseConnection): number {
  return database.prepare<[], { count: number }>(
    'SELECT COUNT(*) AS count FROM invoice_delivery_events',
  ).get()!.count;
}

export function countInvoiceAuditEvents(database: DatabaseConnection): number {
  return database.prepare<[], { count: number }>(
    'SELECT COUNT(*) AS count FROM invoice_audit_events',
  ).get()!.count;
}
