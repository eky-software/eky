import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { getApprovedInvoicePdfDocument } from '../application/getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from '../application/getApprovedInvoicePdfMetadata.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDocumentReadConflictError } from '../application/invoiceDocumentReadConflictError.js';
import { readStoredInvoiceDocument } from '../application/readStoredInvoiceDocument.js';
import { createPdfReadFixture, pdfReadDependencies, syntheticPdf } from './invoicePdfRead.fixture.js';
import { closePublicationDatabases, nextPublicationRevision, openPublicationDatabase, publicationState, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('stored invoice PDF read with real SQLite and files', () => {
  it.each(['approved', 'sent', 'cancelled'] as const)('reads the current %s PDF without mutation', async (status) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    setInvoiceStatus(f.database, f.key, status);
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    const document = await getApprovedInvoicePdfDocument(f.key, f.dependencies);
    expect(document).toEqual({ content: syntheticPdf, metadata: f.document });
    await expect(getApprovedInvoicePdfMetadata(f.key, f.dependencies)).resolves.toEqual(f.document);
    expect(publicationState(f.database)).toEqual(before);
  });

  it('detaches reopened preview while keeping the exact historical PDF readable', async () => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    setInvoiceStatus(f.database, f.key, 'reopened_for_edit');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfDocument(f.key, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    await expect(readStoredInvoiceDocument({ ...f.key, documentId: f.document.id }, f.dependencies))
      .resolves.toEqual({ content: syntheticPdf, metadata: f.document });
    expect(publicationState(f.database)).toEqual(before);
  });

  it('never falls back to an older revision while the new PDF is absent', async () => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const next = nextPublicationRevision(f.database, f.key);
    const before = publicationState(f.database);
    await expect(getApprovedInvoicePdfDocument(f.key, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(publicationState(f.database)).toEqual(before);
    const newer = await f.publish(next, 'pdf-newer');
    await expect(getApprovedInvoicePdfMetadata(f.key, f.dependencies)).resolves.toEqual(newer);
    await expect(readStoredInvoiceDocument({ ...f.key, documentId: f.document.id }, f.dependencies))
      .resolves.toEqual({ content: syntheticPdf, metadata: f.document });
  });

  it.each(['newRevision', 'reopen', 'readFailure'] as const)('preserves all evidence when %s occurs during the read', async (change) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    let afterChange: ReturnType<typeof publicationState> | undefined;
    const dependencies = { ...f.dependencies, invoiceDocumentStorage: {
      async readVerifiedDocument(document: typeof f.document) {
        const content = await f.storage.readVerifiedDocument(document);
        if (change === 'reopen') setInvoiceStatus(f.database, f.key, 'reopened_for_edit');
        else await f.publish(nextPublicationRevision(f.database, f.key), 'pdf-newer');
        afterChange = publicationState(f.database);
        if (change === 'readFailure') throw new Error('Synthetic private read failure');
        return content;
      },
    } };
    await expect(getApprovedInvoicePdfDocument(f.key, dependencies)).rejects.toEqual(
      change === 'readFailure' ? new InvoiceDocumentIntegrityError() : new InvoiceDocumentReadConflictError(),
    );
    expect(publicationState(f.database)).toEqual(afterChange);
    const documents = f.database.prepare('SELECT storage_path AS storagePath, sha256, size_bytes AS sizeBytes FROM invoice_documents').all();
    for (const document of documents) {
      await expect(f.storage.readVerifiedDocument(document as typeof f.document)).resolves.toEqual(syntheticPdf);
    }
  });

  it.each(['missing', 'changedBytes'] as const)('reports %s as integrity failure without repair or metadata deletion', async (damage) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const path = join(f.root, f.document.storagePath);
    if (damage === 'missing') rmSync(path);
    else writeFileSync(path, '%PDF-1.7\nDifferent synthetic bytes\n%%EOF\n');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfDocument(f.key, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    await expect(getApprovedInvoicePdfMetadata(f.key, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['companyId', 'invoiceId'] as const)('keeps preview and exact reads in the %s boundary', async (field) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const scope = { ...f.key, [field]: 'other-synthetic-scope' };
    await expect(getApprovedInvoicePdfDocument(scope, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    await expect(readStoredInvoiceDocument({ ...scope, documentId: f.document.id }, f.dependencies))
      .rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
  });

  it.each(['absent', 'missingRevision', 'otherInvoice'] as const)('fails closed for a broken current pointer (%s)', async (damage) => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const other = await f.approve('other-invoice');
    f.database.pragma('foreign_keys = OFF');
    if (damage === 'absent') {
      f.database.prepare('DELETE FROM invoice_current_revisions WHERE invoice_id = ?').run(f.key.invoiceId);
    } else {
      f.database.prepare('UPDATE invoice_current_revisions SET revision_id = ? WHERE invoice_id = ?')
        .run(damage === 'otherInvoice' ? other.revisionId : 'missing-revision', f.key.invoiceId);
    }
    f.database.pragma('foreign_keys = ON');
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfDocument(f.key, f.dependencies)).rejects.toEqual(new InvoiceDocumentIntegrityError());
    expect(publicationState(f.database)).toEqual(before);
    await expect(f.storage.readVerifiedDocument(f.document)).resolves.toEqual(syntheticPdf);
  });

  it('allows cancellation during preview without borrowing send or generation eligibility', async () => {
    const f = await createPdfReadFixture(openPublicationDatabase());
    const dependencies = { ...f.dependencies, invoiceDocumentStorage: {
      async readVerifiedDocument(document: typeof f.document) {
        const content = await f.storage.readVerifiedDocument(document);
        setInvoiceStatus(f.database, f.key, 'cancelled');
        return content;
      },
    } };
    await expect(getApprovedInvoicePdfDocument(f.key, dependencies))
      .resolves.toEqual({ content: syntheticPdf, metadata: f.document });
    await expect(f.repository.findCurrentDocumentForRevision(f.key)).resolves.toBeUndefined();
  });

  it('reads the exact persisted revision and PDF after reopening the database', async () => {
    const path = join(temporaryDirectory(), 'invoice.sqlite');
    const f = await createPdfReadFixture(openPublicationDatabase(path));
    const before = publicationState(f.database);
    f.database.close();
    const reopened = openPublicationDatabase(path);
    reopened.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfDocument(f.key, pdfReadDependencies(reopened, f.storage)))
      .resolves.toEqual({ content: syntheticPdf, metadata: f.document });
    expect(publicationState(reopened)).toEqual(before);
  });
});
