import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { legacyRevisionId } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceDocumentCandidate } from '../ports/invoiceDocumentRepository.js';
import { createInvoiceDocumentStoragePath, invoiceDocumentMaximumSizeBytes } from './invoiceDocumentFilePolicy.js';
import {
  closePublicationDatabases,
  corruptDocumentMetadata,
  createLegacyPublicationFixture,
  createPublicationFixture,
  documentCandidate,
  expectedRevisionDocument,
  nextPublicationRevision,
  openPublicationDatabase,
  publicationState,
  publishValidatedLegacyRevision,
  setCurrentRevision,
  setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('SQLite invoice document publication: metadata only', () => {
  it.each([
    ['approved', 1], ['sent', 10 * 1024 * 1024],
  ] as const)('round-trips all revision metadata for %s at size %i without delivery side effects', async (status, sizeBytes) => {
    const statements: string[] = [];
    const database = openPublicationDatabase(':memory:', (sql) => statements.push(sql));
    const { key, repository } = await createPublicationFixture(database);
    setInvoiceStatus(database, key, status);
    expect(invoiceDocumentMaximumSizeBytes).toBe(10 * 1024 * 1024);
    expect(database.prepare("SELECT name FROM schema_migrations WHERE name = '039_add_invoice_content_revisions.sql'").get())
      .toEqual({ name: '039_add_invoice_content_revisions.sql' });
    const candidate = documentCandidate(key, 'document-roundtrip', { sizeBytes });
    const expected = expectedRevisionDocument(key, candidate);
    const before = publicationState(database);
    statements.length = 0;

    expect(await repository.publishDocumentIfCurrent({ key, candidate }))
      .toEqual({ outcome: 'published', document: expected });
    const transaction = [...statements];
    expect(transaction[0]?.trim()).toBe('BEGIN IMMEDIATE');
    expect(transaction.at(-1)?.trim()).toBe('COMMIT');
    expect(await repository.findDocumentForRevision(key)).toEqual(expected);
    expect(await repository.findDocumentById({ ...key, documentId: candidate.id })).toEqual(expected);
    expect(publicationState(database)).toEqual({
      ...before,
      documents: [{
        id: candidate.id, company_id: key.companyId, invoice_id: key.invoiceId,
        document_type: 'approved_invoice_pdf', file_name: candidate.fileName,
        storage_path: candidate.storagePath, mime_type: 'application/pdf', sha256: candidate.sha256,
        size_bytes: sizeBytes, created_at: candidate.createdAt, binding_kind: 'revision',
        revision_id: key.revisionId, source_document_id: null,
      }],
    });
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('returns the current winner unchanged even when a later valid candidate has different metadata', async () => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    const candidate = documentCandidate(key);
    await repository.publishDocumentIfCurrent({ key, candidate });
    const before = publicationState(database);
    const contender = documentCandidate(key, 'document-contender', {
      fileName: 'Different.pdf', sha256: 'b'.repeat(64), sizeBytes: 4096,
      createdAt: '2027-02-01T00:00:00.000Z',
    });

    expect(await repository.publishDocumentIfCurrent({ key, candidate: contender }))
      .toEqual({ outcome: 'existing', document: expectedRevisionDocument(key, candidate) });
    expect(await repository.findDocumentById({ ...key, documentId: contender.id })).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it('reads exact historical revisions and IDs without current, latest or missing-document fallback', async () => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    const first = documentCandidate(key);
    await repository.publishDocumentIfCurrent({ key, candidate: first });
    const next = nextPublicationRevision(database, key);
    expect(await repository.findDocumentForRevision(next)).toBeUndefined();
    const second = documentCandidate(next, 'document-second', { sha256: 'c'.repeat(64) });
    await repository.publishDocumentIfCurrent({ key: next, candidate: second });
    const current = nextPublicationRevision(database, next);
    const before = publicationState(database);

    expect(await repository.findDocumentForRevision(key)).toEqual(expectedRevisionDocument(key, first));
    expect(await repository.findDocumentForRevision(next)).toEqual(expectedRevisionDocument(next, second));
    expect(await repository.findDocumentForRevision(current)).toBeUndefined();
    expect(await repository.findDocumentById({ ...key, documentId: first.id }))
      .toEqual(expectedRevisionDocument(key, first));
    expect(await repository.findDocumentById({ ...key, documentId: 'missing-document' })).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it('scopes both readers by company, invoice and exact revision or document identity', async () => {
    const database = openPublicationDatabase();
    const { key, repository, approve } = await createPublicationFixture(database);
    const other = await approve('other-invoice');
    const foreign = await approve('foreign-invoice', 'foreign-company');
    const candidate = documentCandidate(key);
    await repository.publishDocumentIfCurrent({ key, candidate });
    const before = publicationState(database);

    for (const scoped of [other, foreign, { ...key, companyId: 'missing-company' }, { ...key, invoiceId: 'missing-invoice' }]) {
      expect(await repository.findDocumentForRevision({ ...scoped, revisionId: key.revisionId })).toBeUndefined();
      expect(await repository.findDocumentById({ ...scoped, documentId: candidate.id })).toBeUndefined();
    }
    expect(await repository.findDocumentForRevision({ ...key, revisionId: other.revisionId })).toBeUndefined();
    expect(await repository.findDocumentForRevision({ ...key, revisionId: 'missing-revision' })).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it.each(['company', 'invoice', 'revision', 'other-invoice-revision', 'foreign-revision'] as const)(
    'rejects a valid candidate with a missing or wrong %s target', async (mismatch) => {
      const database = openPublicationDatabase();
      const { key, repository, approve } = await createPublicationFixture(database);
      const other = await approve('other-invoice');
      const foreign = await approve('foreign-invoice', 'foreign-company');
      await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key) });
      const wrong = {
        ...key,
        ...(mismatch === 'company' ? { companyId: foreign.companyId } : {}),
        ...(mismatch === 'invoice' ? { invoiceId: other.invoiceId } : {}),
        ...(mismatch === 'revision' ? { revisionId: 'missing-revision' } : {}),
        ...(mismatch === 'other-invoice-revision' ? { revisionId: other.revisionId } : {}),
        ...(mismatch === 'foreign-revision' ? { revisionId: foreign.revisionId } : {}),
      };
      const before = publicationState(database);
      expect(await repository.publishDocumentIfCurrent({ key: wrong, candidate: documentCandidate(wrong, 'wrong-target') }))
        .toEqual({ outcome: 'conflict' });
      expect(publicationState(database)).toEqual(before);
    },
  );

  describe.each([false, true])('with an earlier document: %s', (hasDocument) => {
    it.each(['stale', 'reopened_for_edit', 'cancelled'] as const)('rejects late %s publication before returning any old winner', async (state) => {
      const database = openPublicationDatabase();
      const { key, repository } = await createPublicationFixture(database);
      const first = documentCandidate(key);
      if (hasDocument) await repository.publishDocumentIfCurrent({ key, candidate: first });
      if (state === 'stale') nextPublicationRevision(database, key);
      else setInvoiceStatus(database, key, state);
      const before = publicationState(database);

      expect(await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, 'late-document') }))
        .toEqual({ outcome: 'conflict' });
      expect(await repository.findDocumentForRevision(key))
        .toEqual(hasDocument ? expectedRevisionDocument(key, first) : undefined);
      expect(publicationState(database)).toEqual(before);
    });
  });

  it('rejects publication when the current pointer is absent even with an existing document', async () => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key) });
    database.prepare('DELETE FROM invoice_current_revisions WHERE company_id = ? AND invoice_id = ?')
      .run(key.companyId, key.invoiceId);
    const before = publicationState(database);
    expect(await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, 'late-document') }))
      .toEqual({ outcome: 'conflict' });
    expect(publicationState(database)).toEqual(before);
  });

  it('refuses an unvalidated legacy snapshot and accepts a separate authoritative validated legacy revision', async () => {
    const { database, scope, repository, original } = await createLegacyPublicationFixture();
    const legacyKey = { ...scope, revisionId: legacyRevisionId(database) };
    const before = publicationState(database);
    expect(await repository.publishDocumentIfCurrent({ key: legacyKey, candidate: documentCandidate(scope) }))
      .toEqual({ outcome: 'conflict' });
    expect(await repository.findDocumentForRevision(legacyKey)).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
    const key = publishValidatedLegacyRevision(database);
    const candidate = documentCandidate(scope);
    expect(await repository.publishDocumentIfCurrent({ key, candidate }))
      .toEqual({ outcome: 'published', document: expectedRevisionDocument(key, candidate) });
    expect(await repository.findDocumentById({ ...scope, documentId: original.id })).toEqual(original);
  });

  it.each([
    ['empty ID', { id: '' }],
    ['empty filename', { fileName: '   ' }],
    ['control in filename', { fileName: 'invoice\n.pdf' }],
    ['empty timestamp', { createdAt: '' }],
    ['short hash', { sha256: 'a'.repeat(63) }],
    ['uppercase hash', { sha256: 'A'.repeat(64) }],
    ['nonhex hash', { sha256: 'g'.repeat(64) }],
    ['zero size', { sizeBytes: 0 }],
    ['fractional size', { sizeBytes: 1.5 }],
    ['oversize', { sizeBytes: 10 * 1024 * 1024 + 1 }],
    ['string size', { sizeBytes: '137' }],
    ['traversal path', { storagePath: '../approved-invoice.pdf' }],
    ['shared invoice path', { storagePath: 'revision-company/revision-invoice/approved-invoice.pdf' }],
  ] as const)('rejects malformed candidate %s without metadata writes', async (_name, override) => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    const before = publicationState(database);
    const candidate = { ...documentCandidate(key), ...override } as unknown as InvoiceDocumentCandidate;
    await expect(repository.publishDocumentIfCurrent({ key, candidate })).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(publicationState(database)).toEqual(before);
    expect(database.inTransaction).toBe(false);
  });

  it('rejects another candidate ID path and a foreign scope path, including when a winner already exists', async () => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key) });
    const before = publicationState(database);
    for (const storagePath of [
      createInvoiceDocumentStoragePath(key, 'some-other-document'),
      createInvoiceDocumentStoragePath({ ...key, companyId: 'foreign-company' }, 'document-contender'),
    ]) {
      const candidate = documentCandidate(key, 'document-contender', { storagePath });
      await expect(repository.publishDocumentIfCurrent({ key, candidate })).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    }
    expect(publicationState(database)).toEqual(before);
  });

  it.each([
    ['wrong path', { storage_path: 'synthetic/wrong.pdf' }],
    ['wrong hash', { sha256: 'z'.repeat(64) }],
    ['wrong size', { size_bytes: 0 }],
    ['wrong MIME', { mime_type: 'text/plain' }],
    ['mixed binding', { source_document_id: 'unexpected-source' }],
    ['missing revision', { revision_id: 'missing-revision' }],
  ] as const)('fails closed on stored %s without deleting or repairing evidence', async (_name, corruption) => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    const candidate = documentCandidate(key);
    await repository.publishDocumentIfCurrent({ key, candidate });
    corruptDocumentMetadata(database, candidate.id, corruption);
    const before = publicationState(database);
    await expect(repository.findDocumentById({ ...key, documentId: candidate.id }))
      .rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    const lookupKey = 'revision_id' in corruption ? { ...key, revisionId: corruption.revision_id } : key;
    await expect(repository.findDocumentForRevision(lookupKey)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(publicationState(database)).toEqual(before);
  });

  it('does not overwrite a document ID owned by another invoice', async () => {
    const database = openPublicationDatabase();
    const { key, repository, approve } = await createPublicationFixture(database);
    const foreign = await approve('foreign-invoice', 'foreign-company');
    const first = documentCandidate(foreign);
    await repository.publishDocumentIfCurrent({ key: foreign, candidate: first });
    const before = publicationState(database);
    expect(await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, first.id) }))
      .toEqual({ outcome: 'conflict' });
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back a failure after the metadata INSERT and releases the transaction', async () => {
    const statements: string[] = [];
    const database = openPublicationDatabase(':memory:', (sql) => statements.push(sql));
    const { key, repository } = await createPublicationFixture(database);
    const before = publicationState(database);
    database.exec(`
      CREATE TEMP TRIGGER fail_document_publication AFTER INSERT ON invoice_documents
      BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_DOCUMENT_PUBLICATION_FAILURE'); END;
    `);
    statements.length = 0;
    await expect(repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key) }))
      .rejects.toThrow('SYNTHETIC_DOCUMENT_PUBLICATION_FAILURE');
    expect(statements[0]?.trim()).toBe('BEGIN IMMEDIATE');
    expect(statements.at(-1)?.trim()).toBe('ROLLBACK');
    expect(database.inTransaction).toBe(false);
    expect(publicationState(database)).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('serializes competing publication calls to one winner and one existing result', async () => {
    const database = openPublicationDatabase();
    const { key, repository } = await createPublicationFixture(database);
    const first = documentCandidate(key);
    const second = documentCandidate(key, 'document-second', { sha256: 'b'.repeat(64) });
    // The synchronous SQLite transactions serialize these calls; this is not a parallel-worker claim.
    const results = await Promise.all([
      repository.publishDocumentIfCurrent({ key, candidate: first }),
      repository.publishDocumentIfCurrent({ key, candidate: second }),
    ]);
    expect(results).toEqual([
      { outcome: 'published', document: expectedRevisionDocument(key, first) },
      { outcome: 'existing', document: expectedRevisionDocument(key, first) },
    ]);
    expect(database.prepare('SELECT id FROM invoice_documents').all()).toEqual([{ id: first.id }]);
  });

  it('locks before eligibility reads, shares the winner across connections and retains metadata after reopen', async () => {
    const path = join(temporaryDirectory(), 'publication.sqlite');
    let contender: ReturnType<typeof openPublicationDatabase> | undefined;
    let armed = false;
    let lockError: unknown;
    let probed = false;
    const database = openPublicationDatabase(path, (sql) => {
      if (!armed || probed || !/\bSELECT\b/i.test(sql) || !contender) return;
      probed = true;
      try { contender.exec('BEGIN IMMEDIATE'); }
      catch (error) { lockError = error; }
      finally { if (contender.inTransaction) contender.exec('ROLLBACK'); }
    });
    const { key, repository } = await createPublicationFixture(database);
    contender = openPublicationDatabase(path);
    const otherRepository = new SqliteInvoiceDocumentRepository(contender);
    const candidate = documentCandidate(key);
    armed = true;
    expect(await repository.publishDocumentIfCurrent({ key, candidate }))
      .toEqual({ outcome: 'published', document: expectedRevisionDocument(key, candidate) });
    armed = false;
    expect(probed).toBe(true);
    expect(lockError).toMatchObject({ code: 'SQLITE_BUSY' });
    expect(await otherRepository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, 'contender') }))
      .toEqual({ outcome: 'existing', document: expectedRevisionDocument(key, candidate) });

    const next = nextPublicationRevision(contender, key);
    const nextCandidate = documentCandidate(next, 'next-document');
    await otherRepository.publishDocumentIfCurrent({ key: next, candidate: nextCandidate });
    expect(await repository.publishDocumentIfCurrent({ key, candidate: documentCandidate(key, 'late-document') }))
      .toEqual({ outcome: 'conflict' });
    setCurrentRevision(contender, next);
    setInvoiceStatus(contender, key, 'reopened_for_edit');
    const committed = publicationState(database);
    database.close();
    contender.close();
    const reopened = openPublicationDatabase(path);
    await runMigrations(reopened);
    const restartedRepository = new SqliteInvoiceDocumentRepository(reopened);
    expect(publicationState(reopened)).toEqual(committed);
    expect(await restartedRepository.findDocumentForRevision(key)).toEqual(expectedRevisionDocument(key, candidate));
    expect(await restartedRepository.findDocumentById({ ...next, documentId: nextCandidate.id }))
      .toEqual(expectedRevisionDocument(next, nextCandidate));
    expect(await restartedRepository.publishDocumentIfCurrent({ key: next, candidate: documentCandidate(next, 'after-restart') }))
      .toEqual({ outcome: 'conflict' });
    expect(publicationState(reopened)).toEqual(committed);
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
  });
});
