import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { InvoiceDocumentIntegrityError } from '../modules/invoicing/application/invoiceDocumentIntegrityError.js';
import { closePublicationDatabases, nextPublicationRevision, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createPdfCompositionFixture as fixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

describe('invoice PDF read production composition', () => {
  it.each(['approved', 'sent', 'cancelled'] as const)('returns exact %s bytes and safe metadata through both GET routes', async (status) => {
    const f = await fixture();
    const app = f.createApp();
    expect((await f.approve(app)).status).toBe(200);
    const key = f.current();
    setInvoiceStatus(f.database, key, status);
    const document = await new SqliteInvoiceDocumentRepository(f.database).findDocumentForRevision(key);
    const before = publicationState(f.database);
    const expected = await f.storage.readVerifiedDocument(document!);
    f.database.pragma('query_only = ON');
    const pdf = await app.request(`/invoices/${key.invoiceId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(new Uint8Array(expected));
    expect(pdf.headers.get('Content-Length')).toBe(String(expected.byteLength));
    const metadata = await app.request(`/invoices/${key.invoiceId}/pdf/metadata`);
    expect(metadata.status).toBe(200);
    const { binding: _internalBinding, ...publicDocument } = document!;
    await expect(metadata.json()).resolves.toStrictEqual({ document: publicDocument });
    expect(publicationState(f.database)).toEqual(before);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['reopened', 'otherCompany', 'otherInvoice'] as const)('denies %s preview without generation or file access', async (reason) => {
    const f = await fixture();
    expect((await f.approve(f.createApp())).status).toBe(200);
    const key = f.current();
    if (reason === 'reopened') setInvoiceStatus(f.database, key, 'reopened_for_edit');
    const app = f.createApp(f.storage, true, { companyId: reason === 'otherCompany' ? 'other-company' : key.companyId });
    const invoiceId = reason === 'otherInvoice' ? 'other-invoice' : key.invoiceId;
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    for (const suffix of ['', '/metadata']) expect((await app.request(`/invoices/${invoiceId}/pdf${suffix}`)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['', '/metadata'])('returns conflict instead of superseded content from GET %s', async (suffix) => {
    const f = await fixture();
    const app = f.createApp();
    expect((await f.approve(app)).status).toBe(200);
    const key = f.current();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async (document) => {
      const content = await read(document);
      nextPublicationRevision(f.database, key);
      return content;
    });
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const response = await app.request(`/invoices/${key.invoiceId}/pdf${suffix}`);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice PDF changed before the read completed.' });
    expect(write).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['', '/metadata'])('preserves safe integrity evidence through log, Diagnostics, support reader and incident index (%s)', async (suffix) => {
    const f = await fixture();
    const logsRoot = temporaryDirectory();
    const app = f.createApp(f.storage, true, { operationalLogger: createBackendOperationalLogger(logsRoot) });
    expect((await f.approve(app)).status).toBe(200);
    const key = f.current();
    const before = publicationState(f.database);
    const privateMessage = 'synthetic-secret private@example.invalid /synthetic/private/path';
    vi.spyOn(f.storage, 'readVerifiedDocument').mockRejectedValueOnce(new Error(privateMessage));
    const earliestTimestamp = new Date().toISOString();
    const response = await app.request(`/invoices/${key.invoiceId}/pdf${suffix}`);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: new InvoiceDocumentIntegrityError().message });
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const diagnosticEvents = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(diagnosticEvents).toEqual([expect.objectContaining({
      eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_INTEGRITY_FAILED',
      stage: 'read', retryable: false, sideEffectState: 'none',
    })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents.sourceTruncated).toBe(false);
    expect(incidents.incidentSummaries).toEqual([expect.objectContaining({
      eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_INTEGRITY_FAILED', count: 1,
    })]);
    const projected = JSON.stringify({ diagnosticEvents, support, incidents });
    for (const forbidden of [key.invoiceId, key.companyId, key.revisionId, privateMessage, logsRoot, 'companyId', 'entityId', 'storagePath']) {
      expect(projected).not.toContain(forbidden);
    }
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('does not replace the integrity failure when the diagnostic writer also fails', async () => {
    const f = await fixture();
    const app = f.createApp();
    expect((await f.approve(app)).status).toBe(200);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockRejectedValueOnce(new Error('Synthetic storage failure'));
    f.write.mockImplementationOnce(() => { throw new Error('Synthetic logger failure'); });
    const response = await app.request(`/invoices/${f.current().invoiceId}/pdf`);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: new InvoiceDocumentIntegrityError().message });
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});
