import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  failMigrationHistoryWrite, migrate, migrationName, removeDirectories, type Row,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { bindingState } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import {
  contentFields, lineFields, project,
} from '../../../database/migration/invoiceContentRevisionMigrationSnapshot.fixture.js';
import { readDeliveryTarget, readEligibleDeliveryInvoice } from './invoiceDeliveryReservationPersistence.js';
import {
  conflictEventId, createConflictPreservedCandidate, createLegacyConflictPoststateFixture,
  insertPreviouslyPreservedCandidate, laterEventId, laterPdf, readConflictEvent,
} from './invoiceLegacyConflictPoststate.fixture.js';
import { legacyPreservationFixture } from './invoiceLegacyPreservation.fixture.js';
import { createLegacyPdfReadFixture, syntheticPdf } from './invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceLegacyResendReader } from './sqliteInvoiceLegacyResendReader.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

async function migratePreservingOriginalFields(database: DatabaseConnection) {
  const before = bindingState(database);
  expect(before.migrations).toHaveLength(38);
  await migrate(database);
  const after = bindingState(database);
  expect(after.migrations).toHaveLength(39);
  expect(after.migrations).toContainEqual(expect.objectContaining({ name: migrationName }));
  expect(after.metadata).toHaveLength(before.metadata.length + 1);
  expect(after.metadata).toEqual(expect.arrayContaining(before.metadata));
  expect(after.invoices).toEqual(before.invoices);
  expect(after.lines).toEqual(before.lines);
  expect(after.docs).toEqual(before.docs.map(row => ({
    ...row, binding_kind: 'legacyOriginal', revision_id: null, source_document_id: null,
  })));
  expect(after.events).toEqual(before.events.map(row => ({
    ...row, binding_kind: 'legacyOriginal', revision_id: null, send_mode: 'legacyUnknown',
    document_sha256: null, document_size_bytes: null,
  })));
  expect(database.prepare('SELECT * FROM invoice_content_revisions').all()).toHaveLength(before.invoices.length);
  for (const invoice of before.invoices) {
    const revision = database.prepare<[string, string], Row>(`
      SELECT * FROM invoice_content_revisions WHERE company_id = ? AND invoice_id = ?
    `).get(invoice.company_id as string, invoice.id as string);
    expect(revision).toMatchObject({ origin: 'legacySnapshot', vat_breakdown_state: 'unavailable' });
    if (!revision) throw new Error('Expected a migrated legacy snapshot.');
    expect(project(revision, contentFields)).toEqual(project(invoice, contentFields));
  }
  for (const line of before.lines) {
    const revisionLine = database.prepare<[string], Row>(
      'SELECT * FROM invoice_revision_lines WHERE line_id = ?',
    ).get(line.id as string);
    if (!revisionLine) throw new Error('Expected a migrated legacy line.');
    expect(project(revisionLine, lineFields)).toEqual(project(line, lineFields));
  }
  expect(database.prepare('SELECT * FROM invoice_revision_vat_breakdown').all()).toEqual([]);
  expect(database.inTransaction).toBe(false);
  expect(database.pragma('foreign_key_check')).toEqual([]);
  return after;
}

function expectHistoricalSetNull(f: Awaited<ReturnType<typeof createLegacyConflictPoststateFixture>>) {
  expect(f.snapshotA).toMatchObject({ status: 'approved', subject: 'Snapshot A', total_gross_cents: 12_550 });
  expect(f.database.prepare('SELECT id, invoice_number, reference_number FROM invoices').get()).toEqual(
    project(f.snapshotA, ['id', 'invoice_number', 'reference_number']),
  );
  expect(f.attempted).toMatchObject({ status: 'attempted', document_id: f.original.id });
  expect(f.deletedDocuments).toBe(1);
  expect(f.afterDelete).toEqual({ ...f.beforeDelete, document_id: null });
  expect(f.database.pragma('foreign_keys', { simple: true })).toBe(1);
}

describe('legacy conflict poststates through production migration 038 -> 039 (not an old-runtime replay)', () => {
  it.each([
    { evidence: 'BP4 delayed success', outcome: 'succeeded' },
    { evidence: 'BP5 uncertain outcome', outcome: 'outcomeUnknown' },
  ] as const)(
    'preserves the known R02 $evidence/null poststate without inventing a delivery revision or source', async ({ outcome }) => {
      const f = await createLegacyConflictPoststateFixture(outcome);
      expectHistoricalSetNull(f);
      expect(f.beforeDelete.status).toBe(outcome === 'succeeded' ? 'attempted' : 'outcomeUnknown');
      expect(f.database.prepare('SELECT status, subject, total_gross_cents FROM invoices').get()).toEqual(
        outcome === 'succeeded'
          ? { status: 'sent', subject: 'Snapshot B', total_gross_cents: 25_100 }
          : { status: 'reopened_for_edit', subject: 'Snapshot A', total_gross_cents: 12_550 },
      );
      const migrated = await migratePreservingOriginalFields(f.database);
      expect(migrated.docs).toEqual([]);
      expect(f.database.prepare('SELECT * FROM invoice_current_revisions').all())
        .toHaveLength(outcome === 'succeeded' ? 1 : 0);
      expect(readConflictEvent(f.database)).toMatchObject({
        status: outcome, document_id: null, binding_kind: 'legacyOriginal',
        revision_id: null, send_mode: 'legacyUnknown', document_sha256: null, document_size_bytes: null,
      });
      const before = publicationState(f.database);
      f.database.pragma('query_only = ON');
      try {
        expect(await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope)).toBeUndefined();
      } finally {
        f.database.pragma('query_only = OFF');
      }
      expect(publicationState(f.database)).toEqual(before);
      expect(bindingState(f.database)).toEqual(migrated);
      // An unreferenced fixture file is not a substitute source and must not be rewritten by migration/reads.
      expect(Buffer.from(await f.storage.readVerifiedDocument(f.original))).toEqual(syntheticPdf);
    },
  );

  it.each(['succeeded', 'outcomeUnknown'] as const)(
    'rejects an old %s/null event despite a later valid PDF/event and an otherwise valid preserved sent target', async (outcome) => {
      const f = await createLegacyConflictPoststateFixture(outcome, true);
      expectHistoricalSetNull(f);
      const migrated = await migratePreservingOriginalFields(f.database);
      if (!f.later) throw new Error('Expected the later synthetic legacy document.');
      const later = f.later;
      expect(migrated.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: conflictEventId, document_id: null, status: outcome }),
        expect.objectContaining({ id: laterEventId, document_id: later.id, status: 'succeeded' }),
      ]));
      const reader = new SqliteInvoiceLegacyResendReader(f.database);
      const documents = new SqliteInvoiceDocumentRepository(f.database);
      const delivery = new SqliteInvoiceDeliveryEventRepository(f.database);
      const preserved = await createConflictPreservedCandidate(f.storage, later);
      expect(await documents.findDocumentById({ ...f.scope, documentId: later.id })).toEqual(later);
      expect(Buffer.from(preserved.content)).toEqual(laterPdf);
      expect(Buffer.from(preserved.content)).not.toEqual(syntheticPdf);
      const beforePublication = publicationState(f.database);
      expect(await reader.findDocuments(f.scope)).toBeUndefined();
      expect(publicationState(f.database)).toEqual(beforePublication);
      expect(await documents.publishPreservedLegacyDocument(preserved)).toEqual({ outcome: 'conflict' });
      expect(publicationState(f.database)).toEqual(beforePublication);

      insertPreviouslyPreservedCandidate(f.database, later, preserved.candidate);
      expect(await documents.findDocumentById({ ...f.scope, documentId: preserved.candidate.id }))
        .toEqual(preserved.document);
      f.database.transaction(() => {
        expect(readEligibleDeliveryInvoice(f.database, preserved.target)).toMatchObject({
          status: 'sent', origin: 'legacySnapshot', revision_id: expect.any(String),
        });
        expect(readDeliveryTarget(f.database, preserved.target)).toBe(true);
      }).immediate();
      expect(f.database.pragma('foreign_key_check')).toEqual([]);
      const beforeReservation = publicationState(f.database);
      expect(await reader.findDocuments(f.scope)).toBeUndefined();
      expect(publicationState(f.database)).toEqual(beforeReservation);
      expect(await documents.publishPreservedLegacyDocument(preserved)).toEqual({ outcome: 'conflict' });
      expect(publicationState(f.database)).toEqual(beforeReservation);
      expect(await delivery.reserveEmailDelivery(preserved.reservation)).toEqual({ outcome: 'conflict' });
      expect(publicationState(f.database)).toEqual(beforeReservation);
      expect(f.database.inTransaction).toBe(false);

      expect(() => f.database.prepare('UPDATE invoice_delivery_events SET document_id = ? WHERE id = ?')
        .run(later.id, conflictEventId)).toThrow('INVOICE_DELIVERY_BINDING_IMMUTABLE');
      expect(() => f.database.prepare('DELETE FROM invoice_delivery_events WHERE id = ?')
        .run(conflictEventId)).toThrow('INVOICE_DELIVERY_IMMUTABLE');
      expect(() => f.database.prepare('DELETE FROM invoice_documents WHERE id = ?')
        .run(later.id)).toThrow('INVOICE_DOCUMENT_IMMUTABLE');
      expect(publicationState(f.database)).toEqual(beforeReservation);
      expect(Buffer.from(await f.storage.readVerifiedDocument(f.original))).toEqual(syntheticPdf);
      expect(Buffer.from(await f.storage.readVerifiedDocument(later))).toEqual(laterPdf);
      expect(Buffer.from(await f.storage.readVerifiedDocument(preserved.candidate))).toEqual(laterPdf);
      expect(f.database.pragma('foreign_key_check')).toEqual([]);
    },
  );

  it('allows repeated intact sent events for the same non-null source to publish and reserve without rewriting history', async () => {
    const f = await createLegacyPdfReadFixture('repeated');
    setInvoiceStatus(f.database, f.scope, 'sent');
    const reader = new SqliteInvoiceLegacyResendReader(f.database);
    const documents = await reader.findDocuments(f.scope);
    if (!documents) throw new Error('Expected an intact legacy source.');
    expect(documents.preserved).toBeUndefined();
    const preserved = await createConflictPreservedCandidate(f.storage, documents.source);
    const before = publicationState(f.database);
    expect(before.events).toHaveLength(2);
    for (const event of before.events) {
      expect(event).toMatchObject({
        document_id: documents.source.id, status: 'succeeded', binding_kind: 'legacyOriginal',
        revision_id: null, send_mode: 'legacyUnknown',
      });
    }
    expect(await f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument(preserved))
      .toEqual({ outcome: 'published', document: preserved.document });
    expect(await reader.findDocuments(f.scope))
      .toEqual({ source: documents.source, preserved: preserved.document });
    const afterPublication = publicationState(f.database);
    expect(afterPublication).toEqual({ ...before, documents: afterPublication.documents });
    expect(afterPublication.documents).toHaveLength(before.documents.length + 1);
    expect(afterPublication.documents).toEqual(expect.arrayContaining(before.documents));
    expect(await new SqliteInvoiceDeliveryEventRepository(f.database).reserveEmailDelivery(preserved.reservation))
      .toEqual({ outcome: 'reserved', reservation: {
        eventId: preserved.reservation.eventId, mode: 'customer', target: preserved.target,
      }, invoiceStatusAtReservation: 'sent' });
    const afterReservation = publicationState(f.database);
    expect(afterReservation).toEqual({ ...afterPublication, events: afterReservation.events });
    expect(afterReservation.events).toHaveLength(before.events.length + 1);
    expect(afterReservation.events).toEqual(expect.arrayContaining(before.events));
    expect(afterReservation.events).toContainEqual(expect.objectContaining({
      id: preserved.reservation.eventId, document_id: preserved.candidate.id, status: 'attempted',
      binding_kind: 'preservedLegacy', revision_id: null, send_mode: 'customer',
      document_sha256: documents.source.sha256, document_size_bytes: documents.source.sizeBytes,
    }));
    expect(Buffer.from(await f.storage.readVerifiedDocument(documents.source))).toEqual(syntheticPdf);
    expect(Buffer.from(await f.storage.readVerifiedDocument(preserved.candidate))).toEqual(syntheticPdf);
    expect(f.database.inTransaction).toBe(false);
    expect(f.database.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['succeeded', 'outcomeUnknown'] as const)(
    'rolls back all 039 data/schema/history writes for the %s/null poststate on migration failure', async (outcome) => {
      const f = await createLegacyConflictPoststateFixture(outcome, true);
      failMigrationHistoryWrite(f.database);
      const before = bindingState(f.database);
      await expect(migrate(f.database)).rejects.toMatchObject({ errorCode: 'MIGRATION_EXECUTION_FAILED' });
      expect(bindingState(f.database)).toEqual(before);
      expect(f.database.inTransaction).toBe(false);
      expect(f.database.pragma('foreign_key_check')).toEqual([]);
      expect(Buffer.from(await f.storage.readVerifiedDocument(f.original))).toEqual(syntheticPdf);
      if (!f.later) throw new Error('Expected the later synthetic document.');
      expect(Buffer.from(await f.storage.readVerifiedDocument(f.later))).toEqual(laterPdf);
    },
  );

  it.each(['publication', 'reservation'] as const)(
    'rolls back a failed %s for the intact legacy control without rewriting original evidence', async (operation) => {
      const f = await legacyPreservationFixture();
      const documents = await f.dependencies.invoiceLegacyResendReader.findDocuments(f.scope);
      if (!documents) throw new Error('Expected an intact legacy source.');
      const preserved = await createConflictPreservedCandidate(f.storage, documents.source);
      if (operation === 'reservation') {
        expect((await f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument(preserved)).outcome)
          .toBe('published');
      }
      const before = publicationState(f.database);
      const table = operation === 'publication' ? 'invoice_documents' : 'invoice_delivery_events';
      f.database.exec(`
        CREATE TEMP TRIGGER fail_legacy_conflict_write AFTER INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_LEGACY_CONFLICT_WRITE_FAILURE'); END;
      `);
      const write = operation === 'publication'
        ? f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument(preserved)
        : new SqliteInvoiceDeliveryEventRepository(f.database).reserveEmailDelivery(preserved.reservation);
      await expect(write).rejects.toThrow('SYNTHETIC_LEGACY_CONFLICT_WRITE_FAILURE');
      expect(publicationState(f.database)).toEqual(before);
      expect(f.database.inTransaction).toBe(false);
      expect(f.database.pragma('foreign_key_check')).toEqual([]);
      expect(Buffer.from(await f.storage.readVerifiedDocument(documents.source))).toEqual(syntheticPdf);
      expect(Buffer.from(await f.storage.readVerifiedDocument(preserved.candidate))).toEqual(syntheticPdf);
    },
  );
});
