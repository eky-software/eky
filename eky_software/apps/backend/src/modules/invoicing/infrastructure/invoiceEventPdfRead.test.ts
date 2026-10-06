import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { getInvoiceDeliveryEventPdf } from '../application/getInvoiceDeliveryEventPdf.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { listInvoiceDeliveryEvents } from '../application/listInvoiceDeliveryEvents.js';
import { corruptEvent, historyInput, insertBoundHistoryEvent } from './invoiceEventPdfRead.fixture.js';
import { createLegacyPdfReadFixture, createPdfReadFixture, syntheticPdf } from './invoicePdfRead.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from './sqliteInvoiceDeliveryEventRepository.js';
import { closePublicationDatabases, documentCandidate, nextPublicationRevision, openPublicationDatabase, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

describe('event-bound invoice PDF history', () => {
  it.each(['approved', 'sent', 'cancelled', 'reopened_for_edit'] as const)('reads exact history in %s without granting current eligibility', async (status) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    insertBoundHistoryEvent(f.database, f.document);
    setInvoiceStatus(f.database, f.key, status);
    const reader = new SqliteInvoiceDeliveryEventRepository(f.database);
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.key), {
      invoiceDeliveryEventReader: reader, invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'document', file: { content: syntheticPdf, metadata: f.document } });
    await expect(listInvoiceDeliveryEvents(historyInput(f.key), { invoiceDeliveryEventReader: reader }))
      .resolves.toEqual([expect.objectContaining({ id: 'event-history', status: 'succeeded' })]);
    if (status === 'reopened_for_edit' || status === 'cancelled') {
      await expect(f.repository.findCurrentDocumentForRevision(f.key)).resolves.toBeUndefined();
    }
    expect(publicationState(f.database)).toEqual(before);
  });

  it('does not substitute a newer PDF, including during asynchronous file access', async () => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    insertBoundHistoryEvent(f.database, f.document);
    const originalRead = f.storage.readVerifiedDocument.bind(f.storage);
    const newerContent = Buffer.from('%PDF-1.7\nDifferent newer revision\n%%EOF\n');
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async (document) => {
      await f.publish(nextPublicationRevision(f.database, f.key), 'pdf-newer', newerContent);
      return originalRead(document);
    });
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.key), {
      invoiceDeliveryEventReader: new SqliteInvoiceDeliveryEventRepository(f.database), invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'document', file: { content: syntheticPdf, metadata: f.document } });
    const newer = await f.repository.findDocumentById({ ...f.key, documentId: 'pdf-newer' });
    expect(newer!.sha256).not.toBe(f.document.sha256);
    await expect(originalRead(newer!)).resolves.toEqual(newerContent);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 2 });
  });

  it.each(['company', 'invoice', 'event'] as const)('does not read files for the wrong %s scope', async (boundary) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    insertBoundHistoryEvent(f.database, f.document);
    const scope = { ...f.key, ...(boundary === 'company' ? { companyId: 'another-company' } : {}),
      ...(boundary === 'invoice' ? { invoiceId: 'another-invoice' } : {}) };
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    await expect(getInvoiceDeliveryEventPdf(historyInput(scope, boundary === 'event' ? 'other-event' : 'event-history'), {
      invoiceDeliveryEventReader: new SqliteInvoiceDeliveryEventRepository(f.database), invoiceDocumentStorage: f.storage,
    })).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['missing document', "document_id = 'absent'"],
    ['new null document', 'document_id = NULL'],
    ['revision mismatch', "revision_id = 'another-revision'"],
    ['kind mismatch', "binding_kind = 'preservedLegacy', revision_id = NULL, send_mode = 'customer'"],
    ['hash mismatch', "document_sha256 = 'wrong-hash'"],
    ['size mismatch', 'document_size_bytes = 999'],
    ['unknown new mode', "send_mode = 'legacyUnknown'"],
    ['foreign document', "document_id = 'pdf-foreign'"],
  ])('rejects %s without falling back or reading bytes', async (_name, assignment) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const foreign = await f.approve('foreign-invoice', 'foreign-company');
    await f.publish(foreign, 'pdf-foreign');
    insertBoundHistoryEvent(f.database, f.document);
    corruptEvent(f.database, assignment);
    const before = publicationState(f.database);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    f.database.pragma('query_only = ON');
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.key), {
      invoiceDeliveryEventReader: new SqliteInvoiceDeliveryEventRepository(f.database), invoiceDocumentStorage: f.storage,
    })).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(read).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('preserves explicit legacy provenance and a historic null after actual migration', async () => {
    const f = await createLegacyPdfReadFixture(true);
    const reader = new SqliteInvoiceDeliveryEventRepository(f.database);
    setInvoiceStatus(f.database, f.scope, 'reopened_for_edit');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.scope, 'legacy-event'), {
      invoiceDeliveryEventReader: reader, invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'document', file: {
      content: syntheticPdf, metadata: expect.objectContaining({ id: 'legacy-document', binding: { kind: 'legacyOriginal' } }),
    } });
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.scope, 'legacy-missing-event'), {
      invoiceDeliveryEventReader: reader, invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'legacyMissingDocument' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each([
    ['missing legacy document', "document_id = 'absent'"],
    ['invented legacy revision', "revision_id = 'invented'"],
    ['invented legacy mode', "send_mode = 'smtpTest'"],
    ['invented legacy hash', "document_sha256 = 'invented'"],
    ['invented legacy size', 'document_size_bytes = 64'],
  ])('does not disguise %s as the historical null case', async (_name, assignment) => {
    const f = await createLegacyPdfReadFixture(true);
    corruptEvent(f.database, assignment, 'legacy-event');
    await expect(new SqliteInvoiceDeliveryEventRepository(f.database).findEventDocument(f.scope, 'legacy-event'))
      .rejects.toEqual(new InvoiceDocumentIntegrityError());
  });

  it('reads an exact preserved legacy copy without substituting the original', async () => {
    const f = await createLegacyPdfReadFixture('unambiguous');
    setInvoiceStatus(f.database, f.scope, 'sent');
    const original = await f.dependencies.invoiceDocumentRepository.findDocumentById({ ...f.scope, documentId: 'legacy-document' });
    const file = await f.storage.writeCandidate({ scope: f.scope, documentId: 'legacy-copy', content: syntheticPdf });
    const copy = await f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument({
      scope: f.scope, source: { documentId: original!.id, sha256: original!.sha256, sizeBytes: original!.sizeBytes },
      candidate: documentCandidate(f.scope, 'legacy-copy', file),
    });
    if (copy.outcome === 'conflict') throw new Error('Synthetic legacy copy not published.');
    insertBoundHistoryEvent(f.database, copy.document, { send_mode: 'customer' });
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.scope), {
      invoiceDeliveryEventReader: new SqliteInvoiceDeliveryEventRepository(f.database), invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'document', file: { content: syntheticPdf, metadata: copy.document } });
  });

  it('retains history through database close and reopen', async () => {
    const file = join(temporaryDirectory(), 'history.sqlite');
    const f = await createPdfReadFixture(openPublicationDatabase(file));
    insertBoundHistoryEvent(f.database, f.document);
    setInvoiceStatus(f.database, f.key, 'reopened_for_edit');
    const before = publicationState(f.database);
    f.database.close();
    const database = openPublicationDatabase(file);
    database.pragma('query_only = ON');
    await expect(getInvoiceDeliveryEventPdf(historyInput(f.key), {
      invoiceDeliveryEventReader: new SqliteInvoiceDeliveryEventRepository(database), invoiceDocumentStorage: f.storage,
    })).resolves.toEqual({ kind: 'document', file: { content: syntheticPdf, metadata: f.document } });
    expect(publicationState(database)).toEqual(before);
  });
});
