import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { legacyPreservationFixture } from '../infrastructure/invoiceLegacyPreservation.fixture.js';
import { syntheticPdf } from '../infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, openPublicationDatabase, publicationState, setInvoiceStatus } from '../infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceLegacyResendReader } from '../infrastructure/sqliteInvoiceLegacyResendReader.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { preparePreservedLegacyInvoiceDocument } from './preparePreservedLegacyInvoiceDocument.js';
import { readPreservedLegacyInvoiceDocument as read } from './readPreservedLegacyInvoiceDocument.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

async function preparedFixture() {
  const f = await legacyPreservationFixture();
  const prepared = await preparePreservedLegacyInvoiceDocument(f.input, f.dependencies);
  return { ...f, prepared, readInput: {
    actorContext: f.input.actorContext, invoiceId: f.scope.invoiceId, documentId: prepared.metadata.id,
  } };
}

describe('read an exact preserved legacy PDF without publishing or authorizing SMTP', () => {
  it('returns the prepared identity and verified bytes without changing files, invoice or history', async () => {
    const f = await preparedFixture();
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const publish = vi.spyOn(f.dependencies.invoiceDocumentRepository, 'publishPreservedLegacyDocument');
    const storageRead = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async (document) => {
      const content = await storageRead(document);
      buffers.push(content);
      return content;
    });

    const result = await read(f.readInput, f.dependencies);

    expect(result).toEqual(f.prepared);
    expect(result.content).toBe(buffers[1]);
    expect(result.content).toEqual(syntheticPdf);
    expect(buffers[0]).toEqual(Buffer.alloc(syntheticPdf.byteLength));
    expect(write).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
    expect(readFileSync(join(f.root, result.metadata.storagePath))).toEqual(syntheticPdf);
  });

  it('does not create a copy when none has been prepared', async () => {
    const f = await legacyPreservationFixture();
    const before = publicationState(f.database);
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    await expect(read({ ...f.input, documentId: 'not-prepared' }, f.dependencies))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(storageRead).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['legacy-document', 'another-document'])('rejects %s instead of reading the latest available PDF', async (documentId) => {
    const f = await preparedFixture();
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    await expect(read({ ...f.readInput, documentId }, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(storageRead).not.toHaveBeenCalled();
  });

  it('requires permission before any lookup', async () => {
    const f = await preparedFixture();
    const find = vi.spyOn(f.dependencies.invoiceLegacyResendReader, 'findDocuments');
    const actorContext = createActorContext({
      actorId: 'synthetic-actor', companyId: f.scope.companyId, authenticationMode: 'local', permissions: [],
    });
    await expect(read({ ...f.readInput, actorContext }, f.dependencies)).rejects.toBeInstanceOf(AuthorizationError);
    expect(find).not.toHaveBeenCalled();
  });

  it.each(['company', 'invoice'])('does not cross the %s boundary', async (boundary) => {
    const f = await preparedFixture();
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    const input = boundary === 'company'
      ? { ...f.readInput, actorContext: { ...f.readInput.actorContext, companyId: 'foreign-company' } }
      : { ...f.readInput, invoiceId: 'foreign-invoice' };
    await expect(read(input, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(storageRead).not.toHaveBeenCalled();
  });

  it('rejects a missing document identity before lookup', async () => {
    const f = await preparedFixture();
    const find = vi.spyOn(f.dependencies.invoiceLegacyResendReader, 'findDocuments');
    await expect(read({ ...f.readInput, documentId: '' }, f.dependencies)).rejects.toBeInstanceOf(InvoiceDraftValidationError);
    expect(find).not.toHaveBeenCalled();
  });

  it.each([
    ['source', 'missing'], ['source', 'tampered'], ['preserved', 'missing'], ['preserved', 'tampered'],
  ] as const)('retains evidence and never repairs the %s when %s', async (which, failure) => {
    const f = await preparedFixture();
    const path = join(f.root, which === 'source' ? 'legacy/original.pdf' : f.prepared.metadata.storagePath);
    if (failure === 'missing') unlinkSync(path); else writeFileSync(path, '%PDF-changed');
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const publish = vi.spyOn(f.dependencies.invoiceDocumentRepository, 'publishPreservedLegacyDocument');
    await expect(read(f.readInput, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(write).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
    expect(existsSync(path)).toBe(failure !== 'missing');
    if (failure === 'tampered') expect(readFileSync(path, 'utf8')).toBe('%PDF-changed');
  });

  it('rejects a no-longer-eligible invoice before file access', async () => {
    const f = await preparedFixture();
    setInvoiceStatus(f.database, f.scope, 'approved');
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    await expect(read(f.readInput, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(storageRead).not.toHaveBeenCalled();
  });

  it('rechecks eligibility after file IO and clears buffers on conflict', async () => {
    const f = await preparedFixture();
    const storageRead = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async (document) => {
      const content = await storageRead(document);
      buffers.push(content);
      if (buffers.length === 2) setInvoiceStatus(f.database, f.scope, 'approved');
      return content;
    });
    await expect(read(f.readInput, f.dependencies)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(buffers).toHaveLength(2);
    expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(readFileSync(join(f.root, f.prepared.metadata.storagePath))).toEqual(syntheticPdf);
  });

  it('clears successful reads if metadata changes before the final selection', async () => {
    const f = await preparedFixture();
    const selected = await f.dependencies.invoiceLegacyResendReader.findDocuments(f.scope);
    if (selected?.preserved === undefined) throw new Error('Synthetic prepared PDF missing');
    vi.spyOn(f.dependencies.invoiceLegacyResendReader, 'findDocuments')
      .mockResolvedValueOnce(selected)
      .mockResolvedValueOnce({ ...selected, preserved: { ...selected.preserved, fileName: 'changed.pdf' } });
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    await expect(read(f.readInput, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    const buffers = await Promise.all(storageRead.mock.results.map((result) => result.value));
    expect(buffers.every((buffer) => buffer.every((byte: number) => byte === 0))).toBe(true);
  });

  it('does not expose raw storage errors and clears the earlier source buffer', async () => {
    const f = await preparedFixture();
    const sourceBuffer = Buffer.from(syntheticPdf);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockResolvedValueOnce(sourceBuffer)
      .mockRejectedValueOnce(new Error('Synthetic private storage detail'));
    await expect(read(f.readInput, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(sourceBuffer).toEqual(Buffer.alloc(syntheticPdf.byteLength));
  });

  it('requires consistent scoped metadata from the reader before storage access', async () => {
    const f = await preparedFixture();
    const selected = await f.dependencies.invoiceLegacyResendReader.findDocuments(f.scope);
    if (selected?.preserved === undefined) throw new Error('Synthetic prepared PDF missing');
    vi.spyOn(f.dependencies.invoiceLegacyResendReader, 'findDocuments')
      .mockResolvedValueOnce({ ...selected, preserved: { ...selected.preserved, companyId: 'foreign-company' } });
    const storageRead = vi.spyOn(f.storage, 'readVerifiedDocument');
    await expect(read(f.readInput, f.dependencies)).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(storageRead).not.toHaveBeenCalled();
  });

  it('reads the same independently preserved bytes after reopening the database', async () => {
    const f = await preparedFixture();
    const path = join(temporaryDirectory(), 'preserved-read.sqlite');
    await f.database.backup(path);
    f.database.close();
    const database = openPublicationDatabase(path);
    const before = publicationState(database);
    const result = await read(f.readInput, {
      invoiceLegacyResendReader: new SqliteInvoiceLegacyResendReader(database),
      invoiceDocumentStorage: f.storage,
    });
    expect(result).toEqual(f.prepared);
    expect(publicationState(database)).toEqual(before);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });
});
