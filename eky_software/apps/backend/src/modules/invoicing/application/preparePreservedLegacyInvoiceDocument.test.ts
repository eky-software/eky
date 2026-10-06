import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { syntheticPdf } from '../infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, openPublicationDatabase, publicationState, setInvoiceStatus } from '../infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from '../infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceLegacyResendReader } from '../infrastructure/sqliteInvoiceLegacyResendReader.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import { legacyPreservationFixture } from '../infrastructure/invoiceLegacyPreservation.fixture.js';
import { preparePreservedLegacyInvoiceDocument as prepare } from './preparePreservedLegacyInvoiceDocument.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('preserve verified legacy PDF for later explicit resend confirmation', () => {
  it('publishes independent identical bytes, reuses the copy and leaves history and invoice unchanged', async () => {
    const f = await legacyPreservationFixture();
    const before = publicationState(f.database);
    const first = await prepare(f.input, f.dependencies);
    expect(first.content).toEqual(syntheticPdf);
    expect(first.metadata.binding).toEqual({ kind: 'preservedLegacy', sourceDocumentId: 'legacy-document' });
    expect(first.target).toEqual({ ...f.scope, kind: 'preservedLegacy', sourceDocumentId: 'legacy-document',
      documentId: first.metadata.id, sha256: first.metadata.sha256, sizeBytes: syntheticPdf.byteLength });
    const sourcePath = join(f.root, 'legacy/original.pdf');
    const copyPath = join(f.root, first.metadata.storagePath);
    expect(readFileSync(sourcePath)).toEqual(syntheticPdf);
    expect(readFileSync(copyPath)).toEqual(syntheticPdf);
    expect(statSync(sourcePath).ino).not.toBe(statSync(copyPath).ino);
    expect(statSync(copyPath).nlink).toBe(1);
    const after = publicationState(f.database);
    expect(after).toEqual({ ...before, documents: after.documents });
    expect(after.documents).toHaveLength(2);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const second = await prepare(f.input, f.dependencies);
    expect(second).toEqual(first);
    expect(write).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(after);
  });

  it('keeps the winner when two preparations publish candidates concurrently', async () => {
    const f = await legacyPreservationFixture();
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const results = await Promise.all([prepare(f.input, f.dependencies), prepare(f.input, f.dependencies)]);
    expect(results[0]).toEqual(results[1]);
    expect(write).toHaveBeenCalledTimes(2);
    const candidates = await Promise.all(write.mock.results.map((result) => result.value));
    expect(candidates.filter((file) => existsSync(join(f.root, file.storagePath)))).toHaveLength(1);
    expect(publicationState(f.database).documents).toHaveLength(2);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
  });

  it('retains exact copy identity and bytes after closing and reopening the database', async () => {
    const f = await legacyPreservationFixture();
    const first = await prepare(f.input, f.dependencies);
    const path = join(temporaryDirectory(), 'preserved.sqlite');
    await f.database.backup(path);
    f.database.close();
    const database = openPublicationDatabase(path);
    const before = publicationState(database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const result = await prepare(f.input, { ...f.dependencies,
      invoiceLegacyResendReader: new SqliteInvoiceLegacyResendReader(database),
      invoiceDocumentRepository: new SqliteInvoiceDocumentRepository(database),
    });
    expect(result).toEqual(first);
    expect(write).not.toHaveBeenCalled();
    expect(publicationState(database)).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it.each([false, true])('rejects absent or partly missing history before file access (history=%s)', async (history) => {
    const f = await legacyPreservationFixture(history);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const before = publicationState(f.database);
    await expect(prepare(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('requires backend permission and the actor company before selecting documents', async () => {
    const f = await legacyPreservationFixture();
    const select = vi.spyOn(f.dependencies.invoiceLegacyResendReader, 'findDocuments');
    const actorContext = createActorContext({
      actorId: 'synthetic-actor', companyId: f.scope.companyId, authenticationMode: 'local', permissions: [],
    });
    await expect(prepare({ ...f.input, actorContext }, f.dependencies)).rejects.toBeInstanceOf(AuthorizationError);
    expect(select).not.toHaveBeenCalled();
    await expect(prepare({ ...f.input, actorContext: { ...f.input.actorContext, companyId: 'foreign' } }, f.dependencies))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(select).toHaveBeenCalledExactlyOnceWith({ ...f.scope, companyId: 'foreign' });
  });

  it.each(['missing', 'tampered'] as const)('retains evidence and never regenerates a %s source', async (failure) => {
    const f = await legacyPreservationFixture();
    const sourcePath = join(f.root, 'legacy/original.pdf');
    if (failure === 'missing') unlinkSync(sourcePath); else writeFileSync(sourcePath, '%PDF-changed');
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    await expect(prepare(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(write).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
    if (failure === 'tampered') expect(readFileSync(sourcePath, 'utf8')).toBe('%PDF-changed');
  });

  it('does not replace a corrupt existing copy with a freshly generated or recopied document', async () => {
    const f = await legacyPreservationFixture();
    const result = await prepare(f.input, f.dependencies);
    writeFileSync(join(f.root, result.metadata.storagePath), '%PDF-corrupt');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const before = publicationState(f.database);
    await expect(prepare(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(write).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each([false, true])('discards only its unpublished candidate on a publication conflict (cleanup fails=%s)', async (cleanupFails) => {
    const f = await legacyPreservationFixture();
    const originalWrite = f.storage.writeCandidate.bind(f.storage);
    let candidatePath = '';
    const discard = vi.fn();
    vi.spyOn(f.storage, 'writeCandidate').mockImplementationOnce(async (input) => {
      const file = await originalWrite(input);
      candidatePath = file.storagePath;
      setInvoiceStatus(f.database, f.scope, 'approved');
      discard.mockImplementation(async () => {
        if (cleanupFails) throw new Error('Synthetic cleanup failure');
        await file.discard();
      });
      return { ...file, discard };
    });
    await expect(prepare(f.input, f.dependencies)).rejects.toEqual(new InvoiceDocumentPublicationConflictError(cleanupFails));
    expect(discard).toHaveBeenCalledTimes(1);
    expect(existsSync(join(f.root, candidatePath))).toBe(cleanupFails);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
    expect(publicationState(f.database).documents).toHaveLength(1);
  });

  it.each([false, true])('retains the file after an uncertain publication outcome (committed=%s)', async (committed) => {
    const f = await legacyPreservationFixture();
    const publish = f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument.bind(f.dependencies.invoiceDocumentRepository);
    let candidatePath = '';
    vi.spyOn(f.dependencies.invoiceDocumentRepository, 'publishPreservedLegacyDocument').mockImplementationOnce(async (input) => {
      candidatePath = input.candidate.storagePath;
      if (committed) await publish(input);
      throw new Error('Synthetic uncertain publication');
    });
    await expect(prepare(f.input, f.dependencies)).rejects.toThrow('Synthetic uncertain publication');
    expect(readFileSync(join(f.root, candidatePath))).toEqual(syntheticPdf);
    expect(publicationState(f.database).documents).toHaveLength(committed ? 2 : 1);
  });

  it('rechecks eligibility after copying, retains committed bytes and clears failed response buffers', async () => {
    const f = await legacyPreservationFixture();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async (document) => {
      const content = await read(document);
      buffers.push(content);
      if (buffers.length === 2) setInvoiceStatus(f.database, f.scope, 'approved');
      return content;
    });
    await expect(prepare(f.input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(buffers).toHaveLength(2);
    expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(publicationState(f.database).documents).toHaveLength(2);
    expect(readdirSync(f.root)).toContain('legacy');
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
  });
});
