import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { generateInvoiceRevisionPdfDocument } from '../application/generateApprovedInvoicePdfDocument.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from '../application/invoiceDocumentPublicationConflictError.js';
import type { ApprovedInvoicePdfContent } from '../domain/approvedInvoicePdfContent.js';
import type { InvoiceRevisionKey } from '../domain/invoiceContentRevision.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';
import { SqliteInvoiceContentRevisionReader } from './sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';
import {
  closePublicationDatabases, createPublicationFixture, nextPublicationRevision,
  openPublicationDatabase, publicationState, setInvoiceStatus,
} from './sqliteInvoiceDocumentPublication.fixture.js';

const createdAt = '2027-01-15T13:00:00.000Z';
const pdf = new TextEncoder().encode('%PDF-synthetic-exact-revision');

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

async function fixture() {
  const root = temporaryDirectory();
  const databasePath = join(root, 'synthetic.sqlite');
  const database = openPublicationDatabase(databasePath);
  const publication = await createPublicationFixture(database);
  const storageRoot = join(root, 'documents');
  const storage = new LocalInvoiceDocumentStorage(storageRoot);
  const render = vi.fn(async (_content: ApprovedInvoicePdfContent) => pdf);
  const dependencies = {
    invoiceContentRevisionReader: new SqliteInvoiceContentRevisionReader(database),
    invoiceDocumentRepository: publication.repository,
    invoiceDocumentStorage: storage,
    renderApprovedInvoicePdf: render,
  };
  const generate = (key = publication.key) => generateInvoiceRevisionPdfDocument({ key, createdAt }, dependencies);
  return { ...publication, root, databasePath, database, storageRoot, storage, render, dependencies, generate };
}

describe('revision PDF generation with real SQLite and files', () => {
  it('publishes exact bytes and reuses them read-only after reopening the database', async () => {
    const f = await fixture();
    const document = await f.generate();
    expect(document).toMatchObject({
      companyId: f.key.companyId, invoiceId: f.key.invoiceId,
      binding: { kind: 'revision', revisionId: f.key.revisionId },
      sha256: createHash('sha256').update(pdf).digest('hex'), sizeBytes: pdf.length,
    });
    expect(Buffer.from(await f.storage.readVerifiedDocument(document))).toEqual(Buffer.from(pdf));
    const before = publicationState(f.database);
    f.database.close();
    const reopened = openPublicationDatabase(f.databasePath);
    reopened.pragma('query_only = ON');
    await expect(generateInvoiceRevisionPdfDocument({ key: f.key, createdAt }, {
      ...f.dependencies,
      invoiceContentRevisionReader: new SqliteInvoiceContentRevisionReader(reopened),
      invoiceDocumentRepository: new SqliteInvoiceDocumentRepository(reopened),
    })).resolves.toEqual(document);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(publicationState(reopened)).toEqual(before);
  });

  it('uses the stored snapshot despite later changes to live invoice columns', async () => {
    const f = await fixture();
    const revision = await f.dependencies.invoiceContentRevisionReader.getRevision(f.key);
    f.database.prepare('UPDATE invoices SET note = ? WHERE company_id = ? AND id = ?')
      .run('Later mutable projection', f.key.companyId, f.key.invoiceId);
    await f.generate();
    expect(f.render.mock.calls[0]?.[0].note).toBe(revision?.note);
    expect(f.render.mock.calls[0]?.[0].note).not.toBe('Later mutable projection');
  });

  it('discards only the delayed old candidate and preserves the new revision PDF', async () => {
    const f = await fixture();
    let nextKey: InvoiceRevisionKey | undefined;
    f.render.mockImplementationOnce(async () => {
      nextKey = nextPublicationRevision(f.database, f.key);
      await f.generate(nextKey);
      return new TextEncoder().encode('%PDF-delayed-old-revision');
    });
    await expect(f.generate()).rejects.toBeInstanceOf(InvoiceDocumentPublicationConflictError);
    expect(nextKey).toBeDefined();
    const current = await f.repository.findDocumentForRevision(nextKey!);
    expect(current).toBeDefined();
    expect(Buffer.from(await f.storage.readVerifiedDocument(current!))).toEqual(Buffer.from(pdf));
    expect(await f.repository.findDocumentForRevision(f.key)).toBeUndefined();
    const files = await readdir(f.storageRoot, { recursive: true });
    expect(files.filter((path) => path.endsWith('.pdf'))).toHaveLength(1);
  });

  it('keeps both independently stored revision files when a newer revision publishes', async () => {
    const f = await fixture();
    const original = await f.generate();
    const nextKey = nextPublicationRevision(f.database, f.key);
    const next = await f.generate(nextKey);
    expect(next.id).not.toBe(original.id);
    expect(next.storagePath).not.toBe(original.storagePath);
    expect(Buffer.from(await f.storage.readVerifiedDocument(original))).toEqual(Buffer.from(pdf));
    expect(Buffer.from(await f.storage.readVerifiedDocument(next))).toEqual(Buffer.from(pdf));
    expect(await f.repository.findDocumentForRevision(f.key)).toEqual(original);
    const before = publicationState(f.database);
    await expect(f.generate()).rejects.toBeInstanceOf(InvoiceDocumentPublicationConflictError);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it('keeps only the winner of two competing publications of the same revision', async () => {
    const f = await fixture();
    f.render.mockImplementationOnce(async () => {
      await f.generate();
      return new TextEncoder().encode('%PDF-losing-candidate');
    });
    const winner = await f.generate();
    expect(Buffer.from(await f.storage.readVerifiedDocument(winner))).toEqual(Buffer.from(pdf));
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 1 });
    const files = await readdir(f.storageRoot, { recursive: true });
    expect(files.filter((path) => path.endsWith('.pdf'))).toHaveLength(1);
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it('retains corrupt cached bytes and metadata instead of silently regenerating history', async () => {
    const f = await fixture();
    const document = await f.generate();
    const path = join(f.storageRoot, document.storagePath);
    const corrupt = new TextEncoder().encode('%PDF-corrupt-history');
    await writeFile(path, corrupt);
    const before = publicationState(f.database);
    await expect(f.generate()).rejects.toBeInstanceOf(InvoiceDocumentIntegrityError);
    expect(await readFile(path)).toEqual(Buffer.from(corrupt));
    expect(publicationState(f.database)).toEqual(before);
    expect(f.render).toHaveBeenCalledTimes(1);
  });

  it.each(['reopened_for_edit', 'cancelled'] as const)('rejects a cached PDF after a %s transition during its read', async (status) => {
    const f = await fixture();
    const document = await f.generate();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async (metadata) => {
      const bytes = await read(metadata);
      setInvoiceStatus(f.database, f.key, status);
      return bytes;
    });
    await expect(f.generate()).rejects.toBeInstanceOf(InvoiceDocumentPublicationConflictError);
    expect(Buffer.from(await read(document))).toEqual(Buffer.from(pdf));
    expect(await f.repository.findDocumentForRevision(f.key)).toEqual(document);
    expect(f.render).toHaveBeenCalledTimes(1);
  });
});
