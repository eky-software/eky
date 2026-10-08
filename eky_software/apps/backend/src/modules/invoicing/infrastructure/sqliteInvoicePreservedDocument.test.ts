import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { insert, removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { eventRow, legacyRevisionId } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import {
  closePublicationDatabases,
  corruptDocumentMetadata,
  createLegacyPublicationFixture,
  documentCandidate,
  expectedRevisionDocument,
  openPublicationDatabase,
  publicationState,
  publishValidatedLegacyRevision,
  setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('SQLite preserved legacy document publication: metadata only', () => {
  it('round-trips all three bindings exactly without relabelling the original or changing invoice history', async () => {
    const { database, scope, repository, source, candidate, original } = await createLegacyPublicationFixture();
    const legacyKey = { ...scope, revisionId: legacyRevisionId(database) };
    const before = publicationState(database);
    const expected = {
      ...candidate, ...scope, documentType: 'approved_invoice_pdf', mimeType: 'application/pdf',
      binding: { kind: 'preservedLegacy', sourceDocumentId: source.documentId },
    };

    expect(await repository.findDocumentById({ ...scope, documentId: original.id })).toEqual(original);
    expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate }))
      .toEqual({ outcome: 'published', document: expected });
    expect(await repository.findDocumentById({ ...scope, documentId: candidate.id })).toEqual(expected);
    expect(await repository.findDocumentById({ ...scope, documentId: source.documentId })).toEqual(original);
    expect(await repository.findDocumentForRevision(legacyKey)).toBeUndefined();
    const after = publicationState(database);
    expect(after).toEqual({ ...before, documents: after.documents });
    expect(after.documents).toHaveLength(2);
    expect(after.documents).toContainEqual(before.documents[0]);
    expect(after.documents).toContainEqual({
      id: candidate.id, company_id: scope.companyId, invoice_id: scope.invoiceId,
      document_type: 'approved_invoice_pdf', file_name: candidate.fileName,
      storage_path: candidate.storagePath, mime_type: 'application/pdf', sha256: source.sha256,
      size_bytes: source.sizeBytes, created_at: candidate.createdAt,
      binding_kind: 'preservedLegacy', revision_id: null, source_document_id: original.id,
    });

    const key = publishValidatedLegacyRevision(database);
    const revisionCandidate = documentCandidate(scope, 'document-revision');
    await repository.publishDocumentIfCurrent({ key, candidate: revisionCandidate });
    expect(await repository.findDocumentById({ ...scope, documentId: revisionCandidate.id }))
      .toEqual(expectedRevisionDocument(key, revisionCandidate));
    expect(await repository.findDocumentForRevision(key)).toEqual(expectedRevisionDocument(key, revisionCandidate));
    expect(await repository.findDocumentById({ ...scope, documentId: candidate.id })).toEqual(expected);
    expect(await repository.findDocumentById({ ...scope, documentId: original.id })).toEqual(original);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('serializes candidates for one exact source and returns the first copy unchanged', async () => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    const contender = documentCandidate(scope, 'document-contender', {
      sha256: source.sha256, sizeBytes: source.sizeBytes, fileName: 'Later name.pdf',
      createdAt: '2027-03-01T00:00:00.000Z',
    });
    const [first, second] = await Promise.all([
      repository.publishPreservedLegacyDocument({ scope, source, candidate }),
      repository.publishPreservedLegacyDocument({ scope, source, candidate: contender }),
    ]);
    expect(first.outcome).toBe('published');
    if (first.outcome === 'conflict') throw new Error('Expected the original publication.');
    expect(second).toEqual({ outcome: 'existing', document: first.document });
    const before = publicationState(database);
    expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate: contender }))
      .toEqual(second);
    expect(await repository.findDocumentById({ ...scope, documentId: contender.id })).toBeUndefined();
    expect(publicationState(database)).toEqual(before);
  });

  it.each(['approved', 'reopened_for_edit', 'cancelled'] as const)(
    'rejects a legacy copy in %s state even if a copy was already published', async (status) => {
      // No unresolved event: the old approved + unknown-SMTP policy remains deliberately undecided.
      const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
      await repository.publishPreservedLegacyDocument({ scope, source, candidate });
      setInvoiceStatus(database, scope, status);
      const before = publicationState(database);
      expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate }))
        .toEqual({ outcome: 'conflict' });
      expect(publicationState(database)).toEqual(before);
    },
  );

  it.each([
    ['source ID', { documentId: 'missing-document' }, {}],
    ['source hash', { sha256: 'b'.repeat(64) }, {}],
    ['source size', { sizeBytes: 65 }, {}],
    ['candidate hash', {}, { sha256: 'b'.repeat(64) }],
    ['candidate size', {}, { sizeBytes: 65 }],
  ] as const)('rejects mismatched %s before returning an existing copy', async (_name, sourceOverride, candidateOverride) => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    const before = publicationState(database);
    expect(await repository.publishPreservedLegacyDocument({
      scope, source: { ...source, ...sourceOverride }, candidate: { ...candidate, ...candidateOverride },
    })).toEqual({ outcome: 'conflict' });
    expect(publicationState(database)).toEqual(before);
  });

  it('scopes source and copy reads and publication by both company and invoice', async () => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    const before = publicationState(database);
    for (const wrongScope of [
      { ...scope, companyId: 'other-company' }, { ...scope, invoiceId: 'other-invoice' },
    ]) {
      const wrongCandidate = documentCandidate(wrongScope, 'new-copy', {
        sha256: source.sha256, sizeBytes: source.sizeBytes,
      });
      expect(await repository.publishPreservedLegacyDocument({ scope: wrongScope, source, candidate: wrongCandidate }))
        .toEqual({ outcome: 'conflict' });
      for (const documentId of [source.documentId, candidate.id]) {
        expect(await repository.findDocumentById({ ...wrongScope, documentId })).toBeUndefined();
      }
    }
    expect(publicationState(database)).toEqual(before);
  });

  it('rejects self-copy, preserved-copy chains and revision documents as legacy sources', async () => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    const key = publishValidatedLegacyRevision(database);
    const revisionCandidate = documentCandidate(scope, 'revision-document', {
      sha256: source.sha256, sizeBytes: source.sizeBytes,
    });
    await repository.publishDocumentIfCurrent({ key, candidate: revisionCandidate });
    const before = publicationState(database);
    const sameIdCandidate = documentCandidate(scope, source.documentId, {
      sha256: source.sha256, sizeBytes: source.sizeBytes,
    });
    expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate: sameIdCandidate }))
      .toEqual({ outcome: 'conflict' });
    for (const documentId of [candidate.id, revisionCandidate.id]) {
      expect(await repository.publishPreservedLegacyDocument({
        scope, source: { ...source, documentId },
        candidate: documentCandidate(scope, 'copy-chain', { sha256: source.sha256, sizeBytes: source.sizeBytes }),
      })).toEqual({ outcome: 'conflict' });
    }
    expect(publicationState(database)).toEqual(before);
  });

  it.each([
    { provider: 'smtp', status: 'attempted' },
    { provider: 'smtp', status: 'outcomeUnknown', documentId: null },
    { provider: 'dryRun', status: 'attempted' },
    { provider: 'gmail', status: 'outcomeUnknown', documentId: null },
  ] as const)('blocks unresolved migrated $provider/$status evidence including missing-document history', async (event) => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture(event);
    const before = publicationState(database);
    expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate }))
      .toEqual({ outcome: 'conflict' });
    expect(publicationState(database)).toEqual(before);
  });

  it.each(['attempted', 'outcomeUnknown'] as const)('rechecks new unresolved %s evidence before returning an existing copy', async (status) => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    insert(database, 'invoice_delivery_events', eventRow({
      id: 'new-unresolved', document_id: candidate.id, binding_kind: 'preservedLegacy',
      revision_id: null, document_sha256: source.sha256, document_size_bytes: source.sizeBytes, status,
    }));
    const before = publicationState(database);
    expect(await repository.publishPreservedLegacyDocument({ scope, source, candidate }))
      .toEqual({ outcome: 'conflict' });
    expect(publicationState(database)).toEqual(before);
  });

  it('does not turn revision publication into SMTP authorization or clear unresolved delivery evidence', async () => {
    const { database, scope, repository } = await createLegacyPublicationFixture({ status: 'outcomeUnknown' });
    const key = publishValidatedLegacyRevision(database);
    const candidate = documentCandidate(scope, 'revision-document');
    const before = publicationState(database);
    expect(await repository.publishDocumentIfCurrent({ key, candidate }))
      .toEqual({ outcome: 'published', document: expectedRevisionDocument(key, candidate) });
    const after = publicationState(database);
    expect(after).toEqual({ ...before, documents: after.documents });
    expect(after.documents).toHaveLength(2);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ status: 'outcomeUnknown', binding_kind: 'legacyOriginal' });
  });

  it('rejects malformed evidence and unsafe candidate paths as integrity errors', async () => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    const before = publicationState(database);
    for (const invalid of [
      { scope, source: { ...source, sha256: 'A'.repeat(64) }, candidate },
      { scope, source: { ...source, sizeBytes: 1.5 }, candidate },
      { scope, source, candidate: { ...candidate, storagePath: 'synthetic/original.pdf' } },
      { scope, source, candidate: { ...candidate, fileName: '' } },
    ]) {
      await expect(repository.publishPreservedLegacyDocument(invalid))
        .rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    }
    expect(publicationState(database)).toEqual(before);
  });

  it('reports a broken preserved source binding without fallback, repair or evidence deletion', async () => {
    const { database, scope, repository, source, candidate } = await createLegacyPublicationFixture();
    await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    corruptDocumentMetadata(database, candidate.id, { source_document_id: 'missing-source' });
    const before = publicationState(database);
    await expect(repository.findDocumentById({ ...scope, documentId: candidate.id }))
      .rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(publicationState(database)).toEqual(before);
  });

  it('rolls back failed preserved publication without mutating the original source', async () => {
    const { database, scope, repository, source, candidate, original } = await createLegacyPublicationFixture();
    const before = publicationState(database);
    database.exec(`
      CREATE TEMP TRIGGER fail_preserved_publication AFTER INSERT ON invoice_documents
      BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_PRESERVED_PUBLICATION_FAILURE'); END;
    `);
    await expect(repository.publishPreservedLegacyDocument({ scope, source, candidate }))
      .rejects.toThrow('SYNTHETIC_PRESERVED_PUBLICATION_FAILURE');
    expect(database.inTransaction).toBe(false);
    expect(publicationState(database)).toEqual(before);
    expect(await repository.findDocumentById({ ...scope, documentId: source.documentId })).toEqual(original);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('retains exact original and preserved metadata after closing and reopening an on-disk database', async () => {
    const { database, scope, repository, source, candidate, original } = await createLegacyPublicationFixture();
    const result = await repository.publishPreservedLegacyDocument({ scope, source, candidate });
    expect(result.outcome).toBe('published');
    if (result.outcome === 'conflict') throw new Error('Expected a preserved copy.');
    const committed = publicationState(database);
    const path = join(temporaryDirectory(), 'legacy-publication.sqlite');
    await database.backup(path);
    database.close();
    const restarted = openPublicationDatabase(path);
    await runMigrations(restarted);
    const restartedRepository = new SqliteInvoiceDocumentRepository(restarted);
    expect(await restartedRepository.findDocumentById({ ...scope, documentId: original.id })).toEqual(original);
    expect(await restartedRepository.findDocumentById({ ...scope, documentId: candidate.id })).toEqual(result.document);
    expect(await restartedRepository.publishPreservedLegacyDocument({ scope, source, candidate }))
      .toEqual({ outcome: 'existing', document: result.document });
    expect(publicationState(restarted)).toEqual(committed);
    expect(restarted.pragma('foreign_key_check')).toEqual([]);
  });
});
