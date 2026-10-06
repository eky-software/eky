import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  historicalDatabase, insert, temporaryDirectory, type Row,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { documentRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import type { LegacyOriginalInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { PreservedLegacyInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceDocumentCandidate } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { reservationFields } from './invoiceEmailReservation.fixture.js';
import { syntheticPdf } from './invoicePdfRead.fixture.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';
import { documentCandidate, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

export type LegacyConflictOutcome = 'succeeded' | 'outcomeUnknown';

const scope: InvoiceScope = { companyId: 'dev-company', invoiceId: 'invoice-1' };
export const conflictEventId = 'legacy-conflict-event';
export const laterEventId = 'legacy-later-event';
export const laterPdf = Buffer.from('%PDF-1.7\nSynthetic later snapshot B\n%%EOF\n');

function setSnapshot(database: DatabaseConnection, version: 'A' | 'B'): void {
  const [net, vat, gross, time] = version === 'A'
    ? [10_000, 2_550, 12_550, '2026-06-13T10:00:00.000Z'] as const
    : [20_000, 5_100, 25_100, '2026-06-13T10:02:00.000Z'] as const;
  database.prepare(`
    UPDATE invoices SET subject = ?, total_net_cents = ?, total_vat_cents = ?,
      total_gross_cents = ?, approved_at = ?, updated_at = ?
    WHERE company_id = ? AND id = ?
  `).run(`Snapshot ${version}`, net, vat, gross, time, time, scope.companyId, scope.invoiceId);
  database.prepare('DELETE FROM invoice_lines WHERE invoice_id = ? AND id <> ?')
    .run(scope.invoiceId, 'line-1');
  database.prepare(`
    UPDATE invoice_lines SET description = ?, quantity_hundredths = 100, unit_price_cents = ?,
      vat_rate_basis_points = 2550, discount_type = 'none', discount_value = 0,
      base_cents = ?, discount_cents = 0, net_cents = ?, vat_cents = ?, gross_cents = ?
    WHERE invoice_id = ? AND id = ?
  `).run(`Snapshot ${version} work`, net, net, net, vat, gross, scope.invoiceId, 'line-1');
}

async function insertHistoricalDocument(
  database: DatabaseConnection,
  storage: InvoiceDocumentStorage,
  id: string,
  content: Uint8Array,
): Promise<LegacyOriginalInvoiceDocumentMetadata> {
  const file = await storage.writeCandidate({ scope, documentId: id, content });
  const candidate = documentCandidate(scope, id, {
    storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes,
    createdAt: id === 'legacy-document-a' ? '2026-06-13T10:00:00.000Z' : '2026-06-13T10:04:00.000Z',
  });
  const row = documentRow({
    id, company_id: scope.companyId, invoice_id: scope.invoiceId,
    file_name: candidate.fileName, storage_path: candidate.storagePath,
    sha256: candidate.sha256, size_bytes: candidate.sizeBytes, created_at: candidate.createdAt,
  });
  delete row.binding_kind;
  delete row.revision_id;
  delete row.source_document_id;
  insert(database, 'invoice_documents', row);
  return {
    ...candidate, ...scope, documentType: 'approved_invoice_pdf', mimeType: 'application/pdf',
    binding: { kind: 'legacyOriginal' },
  };
}

function historicalEvent(documentId: string, overrides: Row = {}): Row {
  return {
    id: conflictEventId, company_id: scope.companyId, invoice_id: scope.invoiceId,
    document_id: documentId, delivery_method: 'email', provider: 'smtp', status: 'attempted',
    recipient_email: 'recipient@example.invalid', cc_email: 'copy@example.invalid',
    subject: 'Snapshot A delivery', body_preview: 'Synthetic original preview',
    provider_message_id: null, safe_error_message: null, technical_error_code: null,
    created_at: '2026-06-13T10:01:00.000Z', created_by: 'synthetic-original-actor',
    ...overrides,
  };
}

export function readConflictEvent(database: DatabaseConnection): Row {
  const row = database.prepare<[string], Row>('SELECT * FROM invoice_delivery_events WHERE id = ?')
    .get(conflictEventId);
  if (!row) throw new Error('Synthetic original event missing.');
  return row;
}

// SQL fixture construction of known persisted poststates, not a replay of the old runtime or SMTP bug.
export async function createLegacyConflictPoststateFixture(
  outcome: LegacyConflictOutcome,
  withLaterSuccessfulDelivery = false,
) {
  const database = await historicalDatabase();
  const storage = new LocalInvoiceDocumentStorage(temporaryDirectory());
  setSnapshot(database, 'A');
  const snapshotA = database.prepare<[string, string], Row>(
    'SELECT * FROM invoices WHERE company_id = ? AND id = ?',
  ).get(scope.companyId, scope.invoiceId);
  if (!snapshotA) throw new Error('Synthetic snapshot A missing.');
  const original = await insertHistoricalDocument(database, storage, 'legacy-document-a', syntheticPdf);
  insert(database, 'invoice_delivery_events', historicalEvent(original.id));
  const attempted = readConflictEvent(database);
  if (outcome === 'outcomeUnknown') {
    database.prepare(`
      UPDATE invoice_delivery_events SET status = 'outcomeUnknown',
        safe_error_message = 'Synthetic uncertain delivery', technical_error_code = 'SYNTHETIC_UNKNOWN'
      WHERE id = ?
    `).run(conflictEventId);
  }
  const beforeDelete = readConflictEvent(database);
  const deletedDocuments = database.prepare('DELETE FROM invoice_documents WHERE id = ?').run(original.id).changes;
  const afterDelete = readConflictEvent(database);
  setInvoiceStatus(database, scope, 'reopened_for_edit');
  if (outcome === 'succeeded') {
    setSnapshot(database, 'B');
    setInvoiceStatus(database, scope, 'approved');
    database.prepare(`
      UPDATE invoice_delivery_events SET status = 'succeeded', provider_message_id = ? WHERE id = ?
    `).run('synthetic-delayed-success', conflictEventId);
    setInvoiceStatus(database, scope, 'sent');
  }
  let later: LegacyOriginalInvoiceDocumentMetadata | undefined;
  if (withLaterSuccessfulDelivery) {
    // Extend the null poststate with otherwise eligible sent data; this is not the original BP5 end state.
    if (outcome === 'outcomeUnknown') {
      setSnapshot(database, 'B');
      setInvoiceStatus(database, scope, 'sent');
    }
    later = await insertHistoricalDocument(database, storage, 'legacy-document-b', laterPdf);
    insert(database, 'invoice_delivery_events', historicalEvent(later.id, {
      id: laterEventId, status: 'succeeded', subject: 'Snapshot B delivery',
      provider_message_id: 'synthetic-later-success', created_at: '2026-06-13T10:05:00.000Z',
    }));
  }
  return { database, scope, storage, snapshotA, original, later, attempted, beforeDelete, afterDelete, deletedDocuments };
}

export async function createConflictPreservedCandidate(
  storage: InvoiceDocumentStorage,
  original: LegacyOriginalInvoiceDocumentMetadata,
) {
  const scope: InvoiceScope = { companyId: original.companyId, invoiceId: original.invoiceId };
  const content = await storage.readVerifiedDocument(original);
  const file = await storage.writeCandidate({ scope, documentId: 'preserved-conflict-candidate', content });
  const candidate = documentCandidate(scope, 'preserved-conflict-candidate', {
    storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes,
  });
  const source = { documentId: original.id, sha256: original.sha256, sizeBytes: original.sizeBytes };
  const target: PreservedLegacyInvoiceDeliveryTarget = {
    ...scope, kind: 'preservedLegacy', documentId: candidate.id, sourceDocumentId: original.id,
    sha256: candidate.sha256, sizeBytes: candidate.sizeBytes,
  };
  return {
    scope, source, candidate, content, target,
    reservation: { eventId: 'new-legacy-attempt', mode: 'customer' as const, target, ...reservationFields },
    document: {
      ...candidate, ...scope, documentType: 'approved_invoice_pdf' as const, mimeType: 'application/pdf' as const,
      binding: { kind: 'preservedLegacy' as const, sourceDocumentId: original.id },
    },
  };
}

export function insertPreviouslyPreservedCandidate(
  database: DatabaseConnection,
  original: LegacyOriginalInvoiceDocumentMetadata,
  candidate: InvoiceDocumentCandidate,
): void {
  // Model an already catalogued target only. Keep production foreign keys, CHECKs and triggers enabled.
  insert(database, 'invoice_documents', documentRow({
    id: candidate.id, company_id: original.companyId, invoice_id: original.invoiceId,
    file_name: candidate.fileName, storage_path: candidate.storagePath, sha256: candidate.sha256,
    size_bytes: candidate.sizeBytes, created_at: candidate.createdAt,
    binding_kind: 'preservedLegacy', revision_id: null, source_document_id: original.id,
  }));
}
