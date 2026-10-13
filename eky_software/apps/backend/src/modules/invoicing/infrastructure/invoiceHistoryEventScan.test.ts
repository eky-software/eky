import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { createInvoiceDocumentStoragePath } from './invoiceDocumentFilePolicy.js';
import { corruptEvent, insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import { createEventScanFixture, eventCheckOutcome, previousEventCatalogCheck } from './invoiceHistoryEventScan.fixture.js';
import { invoiceHistoryEventScanSql, validateInvoiceHistoryEvents } from './invoiceHistoryEventScan.js';
import { readInvoiceEventDocument } from './readInvoiceEventDocument.js';
import { SqliteInvoiceBackupArtifactCatalog } from './sqliteInvoiceBackupArtifactCatalog.js';
import { closePublicationDatabases, createLegacyPublicationFixture, documentCandidate } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

function compare(database: DatabaseConnection) {
  return database.transaction(() => {
    const previous = eventCheckOutcome(() => previousEventCatalogCheck(database));
    const current = eventCheckOutcome(() => validateInvoiceHistoryEvents(database));
    expect(current).toBe(previous);
    return current;
  }).deferred();
}

describe('bounded event-history acceptance parity', () => {
  it.each(['customer', 'smtpTest', 'dryRun', 'manual', 'legacyUnknown', 'unknown'])(
    'retains all status/provider/method rules for %s', async mode => {
      const f = await createEventScanFixture();
      for (const status of ['prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown', 'unknown']) {
        for (const provider of ['dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other', 'unknown']) {
          for (const method of ['email', 'manual', 'print', 'other', 'unknown']) {
            // Every value is a closed synthetic literal, not application input.
            corruptEvent(f.database, `send_mode = '${mode}', status = '${status}', provider = '${provider}', delivery_method = '${method}'`);
            compare(f.database);
          }
        }
      }
    },
  );

  it.each([
    ['document blob', "document_id = CAST(document_id AS BLOB)"],
    ['revision blob', 'revision_id = CAST(revision_id AS BLOB)'],
    ['company blob', 'company_id = CAST(company_id AS BLOB)'],
    ['invoice blob', 'invoice_id = CAST(invoice_id AS BLOB)'],
    ['hash blob', 'document_sha256 = CAST(document_sha256 AS BLOB)'],
    ['hash suffix NUL', "document_sha256 = document_sha256 || char(0)"],
    ['hash malformed bytes', "document_sha256 = CAST(x'80' AS TEXT)"],
    ['size blob', "document_size_bytes = CAST('137' AS BLOB)"],
    ['size fraction', 'document_size_bytes = 137.5'],
    ['size null', 'document_size_bytes = NULL'],
    ['size numeric text', "document_size_bytes = '137'"],
    ['size exact real', 'document_size_bytes = 137.0'],
    ['event blob ID', 'id = CAST(id AS BLOB)'],
    ['unknown binding', "binding_kind = 'unknown'"],
    ['large invalid mode', "send_mode = replace(hex(zeroblob(32768)), '0', 'x')"],
    ['missing invoice', "invoice_id = 'absent'"],
  ])('matches ordinary lookup and strict comparison for %s', async (_label, assignment) => {
    const f = await createEventScanFixture();
    corruptEvent(f.database, assignment);
    const before = f.database.serialize();
    compare(f.database);
    expect(f.database.serialize()).toEqual(before);
    expect(f.database.inTransaction).toBe(false);
  });

  it.each([null, undefined])('preserves legacy early return, including document %s', async documentId => {
    const f = await createLegacyPublicationFixture({ status: 'succeeded', ...(documentId === null ? { documentId } : {}) });
    for (const provider of ['dryRun', 'smtp', 'gmail', 'microsoft', 'manual', 'other']) {
      for (const status of ['prepared', 'attempted', 'succeeded', 'failed', 'outcomeUnknown']) {
        corruptEvent(f.database, `provider = '${provider}', status = '${status}', delivery_method = 'other'`, 'legacy-smtp-event');
        expect(compare(f.database)).toBe('accepted');
      }
    }
    corruptEvent(f.database, "company_id = 'absent'", 'legacy-smtp-event');
    expect(compare(f.database)).toBe('rejected');
  });

  it.each([
    "revision_id = 'unexpected'", "send_mode = 'smtpTest'", "document_sha256 = 'unexpected'",
    'document_size_bytes = 64', "document_id = 'absent'", "provider = 'unknown'",
  ])('preserves malformed legacy rejection: %s', async assignment => {
    const f = await createLegacyPublicationFixture({ status: 'succeeded', documentId: null });
    corruptEvent(f.database, assignment, 'legacy-smtp-event');
    expect(compare(f.database)).toBe('rejected');
  });

  it.each(['customer', 'smtpTest', 'manual'])('preserves copied legacy binding for %s', async mode => {
    const f = await createLegacyPublicationFixture();
    const copy = await f.repository.publishPreservedLegacyDocument(f);
    if (copy.outcome === 'conflict') throw new Error('SYNTHETIC_COPY_MISSING');
    insertBoundHistoryEvent(f.database, copy.document, { send_mode: 'customer' });
    corruptEvent(f.database, `send_mode = '${mode}'`);
    expect(compare(f.database)).toBe(mode === 'customer' ? 'accepted' : 'rejected');
  });

  it('scopes unresolved conflicts to modern events for the same invoice', async () => {
    const f = await createEventScanFixture();
    corruptEvent(f.database, "status = 'attempted'");
    insertBoundHistoryEvent(f.database, f.document, { id: 'second-event' });
    f.database.exec('DROP INDEX invoice_delivery_events_unresolved_smtp_key; DROP TRIGGER invoice_delivery_events_unresolved_update_guard');
    corruptEvent(f.database, "status = 'outcomeUnknown'", 'second-event');
    expect(compare(f.database)).toBe('rejected');
    corruptEvent(f.database, "binding_kind = 'legacyOriginal', revision_id = NULL, send_mode = 'legacyUnknown', document_id = NULL, document_sha256 = NULL, document_size_bytes = NULL", 'second-event');
    expect(compare(f.database)).toBe('accepted');
    const otherKey = await f.approve('other-invoice', 'foreign-company');
    const otherDocument = await f.repository.publishDocumentIfCurrent({
      key: otherKey, candidate: { ...f.document, id: 'other-document',
        storagePath: createInvoiceDocumentStoragePath(otherKey, 'other-document') },
    });
    if (otherDocument.outcome === 'conflict') throw new Error('SYNTHETIC_DOCUMENT_MISSING');
    insertBoundHistoryEvent(f.database, otherDocument.document, { id: 'other-event', status: 'attempted' });
    expect(compare(f.database)).toBe('accepted');
  });

  it('accepts distinct invoices in one company with unresolved deliveries', async () => {
    const f = await createEventScanFixture();
    corruptEvent(f.database, "status = 'attempted'");
    const key = await f.approve('other-invoice');
    const published = await f.repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, 'other-document') });
    if (published.outcome === 'conflict') throw new Error('SYNTHETIC_DOCUMENT_MISSING');
    insertBoundHistoryEvent(f.database, published.document, { id: 'other-event', status: 'outcomeUnknown' });
    expect(compare(f.database)).toBe('accepted');
    await expect(new SqliteInvoiceBackupArtifactCatalog(f.database, 'revisionHistory').listAuthoritativeArtifacts()).resolves.toHaveLength(2);
  });

  it('retains BLOB event IDs and distinguishes identical TEXT bytes when checking unresolved duplicates', async () => {
    const f = await createEventScanFixture();
    corruptEvent(f.database, 'id = CAST(id AS BLOB)');
    expect(compare(f.database)).toBe('accepted');
    insertBoundHistoryEvent(f.database, f.document);
    expect(compare(f.database)).toBe('accepted');
    await expect(new SqliteInvoiceBackupArtifactCatalog(f.database, 'revisionHistory').listAuthoritativeArtifacts()).resolves.toHaveLength(1);
    f.database.exec(`
      DROP INDEX invoice_delivery_events_unresolved_smtp_key;
      DROP TRIGGER invoice_delivery_events_unresolved_update_guard;
      UPDATE invoice_delivery_events SET status = 'attempted';
    `);
    expect(compare(f.database)).toBe('rejected');
  });

  it('retains exact Unicode, NUL and composed/decomposed event identities without normalization', async () => {
    const f = await createEventScanFixture();
    for (const id of ['event-\u{1f600}', 'event-\u0000-one', 'event-\u0000-two', 'event-\u00e9', 'event-e\u0301', 'event-\uFFFD']) {
      insertBoundHistoryEvent(f.database, f.document, { id });
      expect(readInvoiceEventDocument(f.database, f.key, id)).toEqual({ kind: 'document', document: f.document });
    }
    expect(compare(f.database)).toBe('accepted');
    await expect(new SqliteInvoiceBackupArtifactCatalog(f.database, 'revisionHistory').listAuthoritativeArtifacts()).resolves.toHaveLength(1);
  });

  it('retains distinct Unicode invoice/document reference keys, including supplementary characters', async () => {
    const f = await createEventScanFixture();
    for (const id of ['invoice-\u{1f600}', 'invoice-\u00e9', 'invoice-e\u0301']) {
      const key = await f.approve(id);
      const published = await f.repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, `${id}-document`) });
      if (published.outcome === 'conflict') throw new Error('SYNTHETIC_DOCUMENT_MISSING');
      insertBoundHistoryEvent(f.database, published.document, { id: `${id}-event`, status: 'attempted' });
      expect(readInvoiceEventDocument(f.database, key, `${id}-event`)).toEqual({ kind: 'document', document: published.document });
    }
    expect(compare(f.database)).toBe('accepted');
    await expect(new SqliteInvoiceBackupArtifactCatalog(f.database, 'revisionHistory').listAuthoritativeArtifacts()).resolves.toHaveLength(4);
  });

  it('keeps legacy reference validation ahead of document lookup errors in the ordinary reader', async () => {
    const f = await createLegacyPublicationFixture();
    corruptEvent(f.database, "send_mode = 'smtpTest'", 'legacy-smtp-event');
    const prepare = f.database.prepare.bind(f.database);
    let documentReads = 0;
    vi.spyOn(f.database, 'prepare').mockImplementation(sql => {
      if (sql.includes('FROM invoice_documents')) { documentReads++; throw new Error('SYNTHETIC_READ_ERROR'); }
      return prepare(sql);
    });
    expect(() => readInvoiceEventDocument(f.database, f.scope, 'legacy-smtp-event')).toThrow(InvoiceDocumentIntegrityError);
    expect(documentReads).toBe(0);
  });

  it('does not allocate event IDs, arbitrary text or a growing unresolved-key set', async () => {
    const f = await createEventScanFixture();
    f.database.transaction(() => {
      for (let i = 0; i < 1000; i++) insertBoundHistoryEvent(f.database, f.document, { id: `event-${i}` });
    })();
    corruptEvent(f.database, "id = replace(hex(zeroblob(65536)), '0', 'x'), subject = replace(hex(zeroblob(65536)), '0', 'y')");
    const before = f.database.serialize();
    let count = 0;
    for (const row of f.database.prepare<[], Record<string, unknown>>(invoiceHistoryEventScanSql).iterate()) {
      count++;
      expect(Object.keys(row)).toHaveLength(13);
      for (const value of Object.values(row)) {
        expect(value === 0 || value === 1 || value === null || value === 'revision').toBe(true);
      }
    }
    expect(count).toBe(1001);
    await expect(new SqliteInvoiceBackupArtifactCatalog(f.database, 'revisionHistory').listAuthoritativeArtifacts()).resolves.toHaveLength(1);
    expect(f.database.serialize()).toEqual(before);
  });

  it('uses existing reference indexes without a sorting or grouping table', async () => {
    const f = await createEventScanFixture();
    const plan = f.database.prepare<[], { detail: string }>('EXPLAIN QUERY PLAN ' + invoiceHistoryEventScanSql).all();
    expect(plan.some(row => /SEARCH document.*(?:PRIMARY KEY|INDEX)/.test(row.detail))).toBe(true);
    expect(plan.some(row => /SEARCH other.*(?:PRIMARY KEY|INDEX)/.test(row.detail))).toBe(true);
    expect(plan.some(row => /TEMP B-TREE|MATERIALIZE|AUTOMATIC.*INDEX/.test(row.detail))).toBe(false);
  });

  it('requires the owning snapshot transaction and handles empty history', async () => {
    const f = await createEventScanFixture();
    expect(() => validateInvoiceHistoryEvents(f.database)).toThrow(InvoiceDocumentIntegrityError);
    f.database.exec('DROP TRIGGER invoice_delivery_events_no_delete; DELETE FROM invoice_delivery_events');
    expect(compare(f.database)).toBe('accepted');
  });
});
