import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createOperationalLoggingMiddleware } from '../http/operationalLogging.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { syntheticPdf } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceLegacyResendReader } from '../modules/invoicing/infrastructure/sqliteInvoiceLegacyResendReader.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createLegacyReviewCompositionFixture } from './invoicingLegacyReviewComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

async function fixture() {
  const f = await createLegacyReviewCompositionFixture();
  setInvoiceStatus(f.database, f.scope, 'sent');
  const app = f.createApp({ prepareEmail: async email => email });
  const response = await app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' });
  expect(response.status).toBe(200);
  const { email } = await response.json();
  const selected = await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope);
  const preserved = selected!.preserved!;
  expect(email.documentTarget.documentId).toBe(preserved.id);
  const url = `/invoices/${f.scope.invoiceId}/preserved-documents/${preserved.id}/pdf`;
  return { ...f, app, preserved, url };
}

describe('exact preserved PDF in production composition', () => {
  it('serves the form-selected copy, preserves all persisted data and clears temporary buffers', async () => {
    const f = await fixture();
    const before = publicationState(f.database);
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    const reads = vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async metadata => {
      const content = await read(metadata);
      buffers.push(content);
      return content;
    });
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const authorize = vi.spyOn(InMemoryInvoiceEmailSendAttemptStore.prototype, 'prepare');
    const response = await f.app.request(f.url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(syntheticPdf);
    expect(reads.mock.calls.map(([metadata]) => metadata.storagePath)).toEqual([
      'legacy/original.pdf', f.preserved.storagePath,
    ]);
    expect(buffers).toHaveLength(2);
    expect(buffers.every(content => content.every(byte => byte === 0))).toBe(true);
    expect(publicationState(f.database)).toEqual(before);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
    expect(readFileSync(join(f.root, f.preserved.storagePath))).toEqual(syntheticPdf);
    expect(write).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each(['permission', 'company', 'invoice', 'document', 'source'] as const)('denies wrong %s before file access', async boundary => {
    const f = await fixture();
    const before = publicationState(f.database);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const app = f.createApp({ ...(boundary === 'company' ? { companyId: 'foreign-company' } : {}),
      ...(boundary === 'permission' ? { allowed: false } : {}),
    });
    const invoiceId = boundary === 'invoice' ? 'foreign-invoice' : f.scope.invoiceId;
    const documentId = boundary === 'document' ? 'wrong-document'
      : boundary === 'source' ? f.preserved.binding.sourceDocumentId : f.preserved.id;
    const response = await app.request(`/invoices/${invoiceId}/preserved-documents/${documentId}/pdf`);
    expect(response.status).toBe(boundary === 'permission' ? 403 : 409);
    expect(publicationState(f.database)).toEqual(before);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('does not create a missing preserved copy through the read route', async () => {
    const f = await createLegacyReviewCompositionFixture();
    setInvoiceStatus(f.database, f.scope, 'sent');
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const response = await f.createApp().request(`/invoices/${f.scope.invoiceId}/preserved-documents/missing/pdf`);
    expect(response.status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each([
    ['invoice', ' '], ['document', ' '], ['invoice', '\t'], ['document', '\n'],
  ] as const)('rejects rather than trims the %s identifier (%j)', async (field, whitespace) => {
    const f = await fixture();
    const select = vi.spyOn(SqliteInvoiceLegacyResendReader.prototype, 'findDocuments');
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const invoiceId = field === 'invoice' ? `${whitespace}${f.scope.invoiceId}${whitespace}` : f.scope.invoiceId;
    const documentId = field === 'document' ? `${whitespace}${f.preserved.id}${whitespace}` : f.preserved.id;
    const response = await f.app.request(`/invoices/${encodeURIComponent(invoiceId)}/preserved-documents/${encodeURIComponent(documentId)}/pdf`);
    expect(response.status).toBe(400);
    expect(select).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['beforeRead', 'afterRead'] as const)('contains unexpected selection failure %s and retains safe HTTP diagnostics', async stage => {
    const f = await fixture();
    const logsRoot = temporaryDirectory();
    const logger = createBackendOperationalLogger(logsRoot);
    f.write.mockImplementation(logger.write.bind(logger));
    const before = publicationState(f.database);
    const select = SqliteInvoiceLegacyResendReader.prototype.findDocuments;
    const privateMessage = 'synthetic-secret private@example.invalid C:\\synthetic\\private\\file';
    let calls = 0;
    vi.spyOn(SqliteInvoiceLegacyResendReader.prototype, 'findDocuments').mockImplementation(function (this: SqliteInvoiceLegacyResendReader, input) {
      calls++;
      if (stage === 'beforeRead' || calls === 2) throw new Error(privateMessage);
      return select.call(this, input);
    });
    const buffers: Uint8Array[] = [];
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async metadata => {
      const content = await read(metadata);
      buffers.push(content);
      return content;
    });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono<BackendEnvironment>();
    app.use('*', createOperationalLoggingMiddleware({
      operationalIdentity: {
        appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: { write: f.write },
    }));
    app.route('/', f.app);
    const earliestTimestamp = new Date().toISOString();
    const response = await app.request(f.url);
    expect(response.status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', stage: 'response',
    }));
    expect(JSON.stringify(f.write.mock.calls)).not.toContain(JSON.stringify(privateMessage).slice(1, -1));
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const diagnosticEvents = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(diagnosticEvents).toEqual([expect.objectContaining({
      eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', stage: 'response',
    })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents).toMatchObject({ sourceTruncated: false, incidentSummaries: [
      { eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', count: 1 },
    ] });
    const projected = JSON.stringify({ diagnosticEvents, support, incidents });
    for (const forbidden of [privateMessage, f.scope.invoiceId, f.scope.companyId, f.preserved.id, logsRoot, 'storagePath']) {
      expect(projected).not.toContain(JSON.stringify(forbidden).slice(1, -1));
    }
    expect(buffers).toHaveLength(stage === 'beforeRead' ? 0 : 2);
    expect(buffers.every(content => content.every(byte => byte === 0))).toBe(true);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['source', 'preserved', 'missing'] as const)('rejects %s damage without mutation or regeneration', async damage => {
    const f = await fixture();
    const path = join(f.root, damage === 'source' ? 'legacy/original.pdf' : f.preserved.storagePath);
    if (damage === 'missing') unlinkSync(path);
    else writeFileSync(path, Buffer.from('invalid synthetic PDF'));
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const response = await f.app.request(f.url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Stored invoice document is inconsistent.' });
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_INTEGRITY_FAILED',
      stage: 'read', sideEffectState: 'none', retryable: false,
    }));
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('withholds bytes when cancellation wins during storage IO', async () => {
    const f = await fixture();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async metadata => {
      const content = await read(metadata);
      buffers.push(content);
      if (metadata.storagePath === f.preserved.storagePath) setInvoiceStatus(f.database, f.scope, 'cancelled');
      return content;
    });
    const response = await f.app.request(f.url);
    expect(response.status).toBe(409);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(buffers.every(content => content.every(byte => byte === 0))).toBe(true);
    expect(readFileSync(join(f.root, f.preserved.storagePath))).toEqual(syntheticPdf);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('preserves the integrity failure even when its diagnostic write fails', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, f.preserved.storagePath), Buffer.from('invalid synthetic PDF'));
    f.write.mockImplementationOnce(() => { throw new Error('Synthetic diagnostic failure.'); });
    const response = await f.app.request(f.url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Stored invoice document is inconsistent.' });
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });
});
