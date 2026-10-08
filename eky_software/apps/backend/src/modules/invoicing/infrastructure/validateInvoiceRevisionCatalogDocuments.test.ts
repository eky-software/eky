import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  insert, migrate, removeDirectories, type Row,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createBindingDatabase, eventRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { toInvoiceDocumentRow } from './invoiceDocumentPersistenceMapping.js';
import { corruptEvent, insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';
import { totalChanges } from './sqliteInvoiceContentRevisionReader.fixture.js';
import {
  closePublicationDatabases, corruptDocumentMetadata, createLegacyPublicationFixture,
  createPublicationFixture, documentCandidate, nextPublicationRevision,
  openPublicationDatabase, publicationState, setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

async function createDocumentFixture() {
  const database = openPublicationDatabase();
  const fixture = await createPublicationFixture(database);
  const result = await fixture.repository.publishDocumentIfCurrent({
    key: fixture.key, candidate: documentCandidate(fixture.key),
  });
  if (result.outcome === 'conflict') throw new Error('Synthetic document missing.');
  insertBoundHistoryEvent(database, result.document);
  return { ...fixture, database, document: result.document };
}

async function expectInvalid(database: DatabaseConnection) {
  const before = publicationState(database);
  const changes = totalChanges(database);
  database.pragma('query_only = ON');
  await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
    .rejects.toThrow('INVOICE_BACKUP_CATALOG_INVALID');
  expect(publicationState(database)).toStrictEqual(before);
  expect(totalChanges(database)).toBe(changes);
  expect(database.inTransaction).toBe(false);
}

describe('invoice revision catalog document bindings', () => {
  it.each<[string, Row]>([
    ['missing revision', { revision_id: 'missing' }],
    ['partial revision', { revision_id: null }],
    ['revision with legacy source', { source_document_id: 'missing' }],
    ['unknown variant', { binding_kind: 'unknown' }],
    ['legacy with revision', { binding_kind: 'legacyOriginal' }],
    ['foreign company', { company_id: 'foreign-company' }],
    ['missing invoice', { invoice_id: 'missing' }],
    ['invalid hash', { sha256: 'x'.repeat(64) }],
    ['invalid size', { size_bytes: 0 }],
    ['wrong path', { storage_path: '../outside.pdf' }],
    ['wrong type', { document_type: 'other' }],
    ['wrong media type', { mime_type: 'text/html' }],
  ])('rejects %s on a historical document', async (_label, values) => {
    const fixture = await createDocumentFixture();
    nextPublicationRevision(fixture.database, fixture.key);
    corruptDocumentMetadata(fixture.database, fixture.document.id, values);
    await expectInvalid(fixture.database);
  });

  it('rejects a valid revision belonging to a different invoice', async () => {
    const fixture = await createDocumentFixture();
    const other = await fixture.approve('other-invoice');
    corruptDocumentMetadata(fixture.database, fixture.document.id, { revision_id: other.revisionId });
    await expectInvalid(fixture.database);
  });

  it('does not treat an unverified legacy snapshot as a document revision', async () => {
    const fixture = await createLegacyPublicationFixture();
    const row = fixture.database.prepare<[], { revision_id: string }>(
      'SELECT revision_id FROM invoice_current_revisions',
    ).get()!;
    const candidate = documentCandidate(fixture.scope, fixture.original.id);
    corruptDocumentMetadata(fixture.database, fixture.original.id, {
      binding_kind: 'revision', revision_id: row.revision_id,
      storage_path: candidate.storagePath,
    });
    await expectInvalid(fixture.database);
  });

  it.each<[string, Row]>([
    ['missing source', { source_document_id: 'missing' }],
    ['null source', { source_document_id: null }],
    ['self source', { source_document_id: 'document-preserved' }],
    ['different hash', { sha256: 'b'.repeat(64) }],
    ['different size', { size_bytes: 65 }],
    ['unexpected revision', { revision_id: 'unexpected' }],
  ])('rejects preserved legacy %s', async (_label, values) => {
    const fixture = await createLegacyPublicationFixture();
    const result = await fixture.repository.publishPreservedLegacyDocument(fixture);
    expect(result.outcome).toBe('published');
    corruptDocumentMetadata(fixture.database, fixture.candidate.id, values);
    await expectInvalid(fixture.database);
  });

  it('rejects a preserved copy sourced from another preserved copy', async () => {
    const fixture = await createLegacyPublicationFixture();
    const result = await fixture.repository.publishPreservedLegacyDocument(fixture);
    if (result.outcome === 'conflict') throw new Error('Synthetic preserved copy missing.');
    const candidate = documentCandidate(fixture.scope, 'document-second-copy', {
      sha256: result.document.sha256, sizeBytes: result.document.sizeBytes,
    });
    // First insert a distinct revision variant, then corrupt it into a chained legacy copy.
    const revision = fixture.database.prepare<[], { revision_id: string }>(
      'SELECT revision_id FROM invoice_current_revisions',
    ).get()!;
    const guard = fixture.database.prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'invoice_documents_insert_guard'",
    ).get()!;
    fixture.database.exec('DROP TRIGGER invoice_documents_insert_guard');
    try {
      const documentRow = toInvoiceDocumentRow({
        ...result.document, ...candidate, binding: { kind: 'revision', revisionId: revision.revision_id },
      });
      insert(fixture.database, 'invoice_documents', { ...documentRow });
    } finally {
      fixture.database.exec(guard.sql);
    }
    corruptDocumentMetadata(fixture.database, candidate.id, {
      binding_kind: 'preservedLegacy', revision_id: null, source_document_id: result.document.id,
    });
    await expectInvalid(fixture.database);
  });

  it('retains documents for a cancelled invoice instead of applying send eligibility', async () => {
    const fixture = await createDocumentFixture();
    setInvoiceStatus(fixture.database, fixture.key, 'cancelled');
    await expect(new SqliteInvoiceBackupArtifactCatalog(fixture.database, 'revisionHistory').listAuthoritativeArtifacts())
      .resolves.toHaveLength(1);
  });
});

describe('invoice revision catalog event bindings', () => {
  it.each([
    ['missing document', "document_id = 'missing'"],
    ['null document', 'document_id = NULL'],
    ['missing revision', "revision_id = 'missing'"],
    ['null revision', 'revision_id = NULL'],
    ['wrong variant', "binding_kind = 'preservedLegacy', revision_id = NULL, send_mode = 'customer'"],
    ['wrong hash', `document_sha256 = '${'b'.repeat(64)}'`],
    ['wrong size', 'document_size_bytes = 138'],
    ['null hash', 'document_sha256 = NULL'],
    ['null size', 'document_size_bytes = NULL'],
    ['foreign company', "company_id = 'foreign-company'"],
    ['wrong invoice', "invoice_id = 'missing'"],
    ['unknown mode', "send_mode = 'unknown'"],
    ['legacy mode', "send_mode = 'legacyUnknown'"],
    ['wrong provider', "provider = 'gmail'"],
    ['wrong method', "delivery_method = 'other'"],
    ['unknown status', "status = 'unknown'"],
  ])('rejects event %s independently of current revision selection', async (_label, assignment) => {
    const fixture = await createDocumentFixture();
    nextPublicationRevision(fixture.database, fixture.key);
    corruptEvent(fixture.database, assignment);
    await expectInvalid(fixture.database);
  });

  it.each([
    ['customer', 'email', 'smtp'], ['smtpTest', 'email', 'smtp'],
    ['dryRun', 'email', 'dryRun'], ['manual', 'manual', 'manual'], ['manual', 'print', 'manual'],
  ])('accepts bound %s / %s / %s events for an old revision', async (mode, method, provider) => {
    const fixture = await createDocumentFixture();
    insertBoundHistoryEvent(fixture.database, fixture.document, {
      id: 'additional-event', send_mode: mode, delivery_method: method, provider,
    });
    nextPublicationRevision(fixture.database, fixture.key);
    await expect(new SqliteInvoiceBackupArtifactCatalog(fixture.database, 'revisionHistory').listAuthoritativeArtifacts())
      .resolves.toHaveLength(1);
  });

  it.each([
    'revision_id = NULL, document_sha256 = NULL, document_size_bytes = NULL, send_mode = \'customer\'',
    "binding_kind = 'revision', revision_id = 'missing', send_mode = 'smtpTest'",
    "company_id = 'foreign-company'",
  ])('rejects corrupted legacy-null relationships: %s', async (assignment) => {
    const fixture = await createLegacyPublicationFixture({ status: 'succeeded', documentId: null });
    corruptEvent(fixture.database, assignment, 'legacy-smtp-event');
    await expectInvalid(fixture.database);
  });

  it('retains all valid legacy providers, nulls and multiple unresolved events', async () => {
    const database = await createBindingDatabase();
    await migrate(database);
    const before = publicationState(database);
    await expect(new SqliteInvoiceBackupArtifactCatalog(database, 'revisionHistory').listAuthoritativeArtifacts())
      .resolves.toHaveLength(1);
    expect(publicationState(database)).toStrictEqual(before);
  });

  it('rejects multiple new unresolved SMTP reservations without rejecting legacy history', async () => {
    const fixture = await createDocumentFixture();
    const row = eventRow({
      company_id: fixture.key.companyId, invoice_id: fixture.key.invoiceId,
      document_id: fixture.document.id, revision_id: fixture.key.revisionId,
      document_sha256: fixture.document.sha256, document_size_bytes: fixture.document.sizeBytes,
    });
    insert(fixture.database, 'invoice_delivery_events', row);
    const index = fixture.database.prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'invoice_delivery_events_unresolved_smtp_key'",
    ).get()!;
    const guard = fixture.database.prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'invoice_delivery_events_insert_guard'",
    ).get()!;
    fixture.database.exec('DROP INDEX invoice_delivery_events_unresolved_smtp_key');
    fixture.database.exec('DROP TRIGGER invoice_delivery_events_insert_guard');
    try {
      insert(fixture.database, 'invoice_delivery_events', { ...row, id: 'second-reservation' });
    } finally {
      fixture.database.exec(guard.sql);
    }
    // The invalid fixture cannot restore its unique index until the duplicate is removed.
    expect(index.sql).toContain('CREATE UNIQUE INDEX');
    await expectInvalid(fixture.database);
  });
});
