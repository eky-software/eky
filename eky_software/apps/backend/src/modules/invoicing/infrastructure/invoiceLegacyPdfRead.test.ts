import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { removeDirectories } from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { getApprovedInvoicePdfDocument } from '../application/getApprovedInvoicePdfDocument.js';
import { getApprovedInvoicePdfMetadata } from '../application/getApprovedInvoicePdfMetadata.js';
import { createLegacyPdfReadFixture, syntheticPdf } from './invoicePdfRead.fixture.js';
import { closePublicationDatabases, documentCandidate, publicationState, publishValidatedLegacyRevision, setInvoiceStatus } from './sqliteInvoiceDocumentPublication.fixture.js';

afterEach(closePublicationDatabases);
afterAll(removeDirectories);

describe('migrated legacy PDF preview', () => {
  it.each(['approved', 'sent', 'cancelled'] as const)('reads %s legacy bytes without claiming a revision binding', async (status) => {
    const f = await createLegacyPdfReadFixture();
    setInvoiceStatus(f.database, f.scope, status);
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    const document = await getApprovedInvoicePdfDocument(f.scope, f.dependencies);
    expect(document.content).toEqual(syntheticPdf);
    expect(document.metadata.id).toBe('legacy-document');
    expect(document.metadata).toHaveProperty('binding', { kind: 'legacyOriginal' });
    await expect(getApprovedInvoicePdfMetadata(f.scope, f.dependencies)).resolves.toEqual(document.metadata);
    expect(publicationState(f.database)).toEqual(before);
  });

  it('does not select a preserved delivery copy as the legacy preview', async () => {
    const f = await createLegacyPdfReadFixture('unambiguous');
    setInvoiceStatus(f.database, f.scope, 'sent');
    const original = await getApprovedInvoicePdfMetadata(f.scope, f.dependencies);
    const file = await f.storage.writeCandidate({ scope: f.scope, documentId: 'preserved-copy', content: syntheticPdf });
    const result = await f.dependencies.invoiceDocumentRepository.publishPreservedLegacyDocument({
      scope: f.scope, source: { documentId: original.id, sha256: original.sha256, sizeBytes: original.sizeBytes },
      candidate: documentCandidate(f.scope, 'preserved-copy', {
        storagePath: file.storagePath, sha256: file.sha256, sizeBytes: file.sizeBytes,
      }),
    });
    expect(result.outcome).toBe('published');
    f.database.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfMetadata(f.scope, f.dependencies)).resolves.toEqual(original);
  });

  it('does not use original legacy bytes as a new validated revision PDF', async () => {
    const f = await createLegacyPdfReadFixture();
    publishValidatedLegacyRevision(f.database);
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    await expect(getApprovedInvoicePdfDocument(f.scope, f.dependencies)).rejects.toEqual(new ApprovedInvoiceDocumentNotFoundError());
    expect(publicationState(f.database)).toEqual(before);
  });
});
