import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createOperationalLoggingMiddleware } from '../http/operationalLogging.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { InvoiceDocumentIntegrityError } from '../modules/invoicing/application/invoiceDocumentIntegrityError.js';
import { corruptEvent, insertBoundHistoryEvent } from '../modules/invoicing/infrastructure/invoiceEventPdfRead.fixture.js';
import { closePublicationDatabases, documentCandidate, nextPublicationRevision, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createPdfCompositionFixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

async function fixture() {
  const f = await createPdfCompositionFixture();
  const app = f.createApp(f.storage, true, { deliveryPermission: true });
  expect((await f.approve(app)).status).toBe(200);
  const key = f.current();
  const document = await new SqliteInvoiceDocumentRepository(f.database).findDocumentForRevision(key);
  if (!document) throw new Error('Synthetic approval PDF missing.');
  insertBoundHistoryEvent(f.database, document);
  const url = `/invoices/${key.invoiceId}/delivery-events/event-history/pdf`;
  return { ...f, app, key, document, url };
}

describe('event PDF production composition and HTTP', () => {
  it('contains an unexpected history repository failure and preserves safe diagnostic readback', async () => {
    const f = await fixture();
    const logsRoot = temporaryDirectory();
    const before = publicationState(f.database);
    const privateMessage = 'synthetic-secret private@example.invalid C:\\synthetic\\private\\file';
    vi.spyOn(SqliteInvoiceDeliveryEventRepository.prototype, 'findEventDocument')
      .mockImplementationOnce(() => { throw new Error(privateMessage); });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const app = new Hono<BackendEnvironment>();
    app.use('*', createOperationalLoggingMiddleware({
      operationalIdentity: {
        appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: createBackendOperationalLogger(logsRoot),
    }));
    app.route('/', f.app);
    const earliestTimestamp = new Date().toISOString();
    const response = await app.request(f.url);
    expect(response.status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error.' });
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const events = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(events).toEqual([expect.objectContaining({
      eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', stage: 'response',
    })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents: events, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents).toMatchObject({ sourceTruncated: false, incidentSummaries: [
      { eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', count: 1 },
    ] });
    const projected = JSON.stringify({ events, support, incidents });
    for (const value of [privateMessage, f.key.companyId, f.key.invoiceId, f.key.revisionId,
      'event-history', f.document.id, logsRoot, 'storagePath']) {
      expect(projected).not.toContain(JSON.stringify(value).slice(1, -1));
    }
    expect(read).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['approved', 'reopened_for_edit', 'sent', 'cancelled'] as const)('serves exact %s history without mutation or network activity', async (status) => {
    const f = await fixture();
    setInvoiceStatus(f.database, f.key, status);
    const expected = await f.storage.readVerifiedDocument(f.document);
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    const result = await f.app.request(f.url);
    expect(result.status).toBe(200);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array(expected));
    expect(result.headers.get('Content-Length')).toBe(String(expected.byteLength));
    expect(result.headers.get('Content-Type')).toBe('application/pdf');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.get('Content-Disposition')).toBe('inline; filename="invoice.pdf"');
    const history = await f.app.request(`/invoices/${f.key.invoiceId}/delivery-events`);
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toEqual({ events: [expect.objectContaining({ id: 'event-history' })] });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('keeps historical PDF bytes when the current revision changes during the read', async () => {
    const f = await fixture();
    const originalRead = f.storage.readVerifiedDocument.bind(f.storage);
    const expected = await originalRead(f.document);
    const newerContent = Buffer.from('%PDF-1.7\nDifferent newer revision\n%%EOF\n');
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async (document) => {
      const key = nextPublicationRevision(f.database, f.key);
      const file = await f.storage.writeCandidate({ scope: key, documentId: 'newer-pdf', content: newerContent });
      const published = await new SqliteInvoiceDocumentRepository(f.database).publishDocumentIfCurrent({
        key, candidate: documentCandidate(key, 'newer-pdf', file),
      });
      expect(published.outcome).toBe('published');
      return originalRead(document);
    });
    const response = await f.app.request(f.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(expected));
    const current = await f.app.request(`/invoices/${f.key.invoiceId}/pdf`);
    expect(current.status).toBe(200);
    expect(new Uint8Array(await current.arrayBuffer())).toEqual(new Uint8Array(newerContent));
    expect(new Uint8Array(expected)).not.toEqual(new Uint8Array(newerContent));
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['permission', 'company', 'invoice', 'event', 'invalidId'] as const)('denies %s before files are accessed', async (reason) => {
    const f = await fixture();
    const app = f.createApp(f.storage, true, {
      deliveryPermission: reason !== 'permission', companyId: reason === 'company' ? 'other-company' : f.key.companyId,
    });
    const url = reason === 'invoice' ? f.url.replace(f.key.invoiceId, 'other-invoice')
      : reason === 'event' ? f.url.replace('event-history', 'other-event')
      : reason === 'invalidId' ? f.url.replace('event-history', 'x'.repeat(201)) : f.url;
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const generate = vi.spyOn(f.storage, 'writeCandidate');
    const response = await app.request(url);
    expect(response.status).toBe(reason === 'permission' ? 403 : reason === 'invalidId' ? 400 : 404);
    expect(read).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each(['reference', 'bytes'] as const)('carries %s integrity failure through Diagnostics and support readers without identifiers', async (damage) => {
    const f = await fixture();
    const logsRoot = temporaryDirectory();
    const app = f.createApp(f.storage, true, {
      deliveryPermission: true, operationalLogger: createBackendOperationalLogger(logsRoot),
    });
    const privateMessage = 'synthetic-secret private@example.invalid /synthetic/private/path';
    if (damage === 'reference') corruptEvent(f.database, "document_id = 'missing-document'");
    else vi.spyOn(f.storage, 'readVerifiedDocument').mockRejectedValueOnce(new Error(privateMessage));
    const before = publicationState(f.database);
    const earliestTimestamp = new Date().toISOString();
    const response = await app.request(f.url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: new InvoiceDocumentIntegrityError().message });
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const events = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(events).toEqual([expect.objectContaining({
      eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_INTEGRITY_FAILED',
      stage: 'read', retryable: false, sideEffectState: 'none',
    })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents: events, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents.incidentSummaries).toEqual([expect.objectContaining({ errorCode: 'INVOICE_PDF_INTEGRITY_FAILED', count: 1 })]);
    expect(incidents.sourceTruncated).toBe(false);
    const projected = JSON.stringify({ events, support, incidents });
    for (const value of [f.key.companyId, f.key.invoiceId, f.key.revisionId, 'event-history', f.document.id,
      privateMessage, logsRoot, 'companyId', 'entityId', 'storagePath']) expect(projected).not.toContain(value);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('preserves the PDF failure if operational logging fails too', async () => {
    const f = await fixture();
    vi.spyOn(f.storage, 'readVerifiedDocument').mockRejectedValueOnce(new Error('Synthetic storage failure'));
    f.write.mockImplementationOnce(() => { throw new Error('Synthetic logging failure'); });
    const response = await f.app.request(f.url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: new InvoiceDocumentIntegrityError().message });
    expect(f.write).toHaveBeenCalledTimes(1);
  });
});
