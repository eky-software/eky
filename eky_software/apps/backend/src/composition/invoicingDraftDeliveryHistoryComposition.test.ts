import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createOperationalLoggingMiddleware } from '../http/operationalLogging.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { closePublicationDatabases, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDraftDeliveryHistoryReader } from '../modules/invoicing/infrastructure/sqliteInvoiceDraftDeliveryHistoryReader.js';
import type { InvoiceSmtpTestDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createPdfCompositionFixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);
const url = '/invoice-drafts/revision-draft/delivery-history';

async function reopenedFixture() {
  const f = await createPdfCompositionFixture();
  const sendTestEmail = vi.fn<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>().mockImplementation(async input => ({
    provider: 'smtp', testMode: true, deliveredTo: input.emailTestRecipientOverride,
    providerMessageId: 'synthetic-self-test-message',
  }));
  const app = f.createApp(f.storage, true, {
    deliveryPermission: true,
    infrastructureAdapters: { invoiceSmtpTestDeliveryProvider: { sendTestEmail } },
    invoiceEmailSettingsReader: { getEmailSettings: async () => ({
      emailDeliveryProvider: 'dnaSmtp', emailSenderAddress: 'sender@example.invalid',
      emailSenderName: 'Synthetic', emailUsername: 'synthetic', emailTestRecipientOverride: 'owner@example.invalid',
    }) },
  });
  expect((await f.approve(app)).status).toBe(200);
  const key = f.current();
  const post = (operation: 'prepare' | 'send', extra = {}) => app.request(`/invoices/${key.invoiceId}/email/smtp-test/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: 'customer@example.invalid', cc: '', subject: 'Synthetic invoice', body: 'Synthetic body', ...extra }),
  });
  const prepared = await post('prepare');
  expect(prepared.status).toBe(200);
  const { preparation } = await prepared.json() as { preparation: { attemptId: string; authorizationToken: string } };
  expect((await post('send', { attemptId: preparation.attemptId, authorizationToken: preparation.authorizationToken })).status).toBe(200);
  const previous = await app.request(`/invoices/${key.invoiceId}/delivery-events`);
  expect(previous.status).toBe(200);
  const { events: invoiceDeliveryEvents } = await previous.json();
  expect((await app.request(`/invoices/${key.invoiceId}/reopen-for-edit`, { method: 'POST' })).status).toBe(200);
  return { ...f, app, key, sendTestEmail, invoiceDeliveryEvents };
}

describe('draft delivery history production composition', () => {
  it('serves ordinary empty history without lookup side effects or draft DTO expansion', async () => {
    const f = await createPdfCompositionFixture();
    const app = f.createApp(f.storage, true, { deliveryPermission: true });
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    const response = await app.request(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ invoiceDeliveryHistory: { invoiceId: null, events: [] } });
    const detail = await app.request('/invoice-drafts/revision-draft');
    const { invoiceDraft } = await detail.json();
    expect(invoiceDraft).not.toHaveProperty('invoiceId');
    expect(invoiceDraft).not.toHaveProperty('deliveryHistory');
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('retains self-test history after actual approve/send/reopen, including a fresh editor app', async () => {
    const f = await reopenedFixture();
    expect(f.invoiceDeliveryEvents).toEqual([expect.objectContaining({ sendMode: 'smtpTest', documentSource: 'revision', status: 'succeeded' })]);
    const before = publicationState(f.database);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const authorize = vi.spyOn(InMemoryInvoiceEmailSendAttemptStore.prototype, 'prepare');
    f.database.pragma('query_only = ON');
    for (const app of [f.app, f.createApp(f.storage, true, { deliveryPermission: true })]) {
      const response = await app.request(`${url}?companyId=foreign-company&invoiceId=guessed-invoice`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ invoiceDeliveryHistory: { invoiceId: f.key.invoiceId, events: f.invoiceDeliveryEvents } });
    }
    expect(publicationState(f.database)).toEqual(before);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(f.sendTestEmail).toHaveBeenCalledTimes(1);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('denies missing permission before database lookup even for an invalid identifier', async () => {
    const f = await createPdfCompositionFixture();
    const read = vi.spyOn(SqliteInvoiceDraftDeliveryHistoryReader.prototype, 'findDeliveryHistory');
    const response = await f.createApp().request('/invoice-drafts/%20/delivery-history');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied.' });
    expect(read).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['missing', 'foreign', 'credit', 'locked'] as const)('returns safe 404 for %s and no invoice or event data', async boundary => {
    const f = await reopenedFixture();
    if (boundary === 'credit') f.database.prepare("UPDATE invoice_drafts SET invoice_kind = 'credit', credited_invoice_id = ? WHERE id = 'revision-draft'").run(f.key.invoiceId);
    if (boundary === 'locked') expect((await f.approve(f.app)).status).toBe(200);
    const app = f.createApp(f.storage, true, { deliveryPermission: true,
      ...(boundary === 'foreign' ? { companyId: 'foreign-company' } : {}),
    });
    const before = publicationState(f.database);
    const response = await app.request(boundary === 'missing' ? '/invoice-drafts/missing/delivery-history' : `${url}?companyId=revision-company`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice draft not found.' });
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['%20', 'x'.repeat(201)])('rejects invalid draft identifier %s', async id => {
    const f = await createPdfCompositionFixture();
    const read = vi.spyOn(SqliteInvoiceDraftDeliveryHistoryReader.prototype, 'findDeliveryHistory');
    const response = await f.createApp(f.storage, true, { deliveryPermission: true }).request(`/invoice-drafts/${id}/delivery-history`);
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['integrity', 'unexpected'] as const)('keeps %s failure safe through real logger, Diagnostics, support and incident readers', async failure => {
    const f = await reopenedFixture();
    const raw = 'synthetic-secret private@example.invalid C:\\synthetic\\private\\file';
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'integrity') setInvoiceStatus(f.database, f.key, 'approved');
    else vi.spyOn(SqliteInvoiceDraftDeliveryHistoryReader.prototype, 'findDeliveryHistory').mockRejectedValue(new Error(raw));
    const logsRoot = temporaryDirectory();
    const logger = createBackendOperationalLogger(logsRoot);
    const app = new Hono<BackendEnvironment>();
    app.use('*', createOperationalLoggingMiddleware({
      operationalLogger: logger,
      operationalIdentity: { appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    }));
    app.route('/', f.createApp(f.storage, true, { deliveryPermission: true, operationalLogger: logger }));
    const earliestTimestamp = new Date().toISOString();
    const before = publicationState(f.database);
    f.database.pragma('query_only = ON');
    const response = await app.request(url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: failure === 'integrity'
      ? 'Stored invoice delivery history is inconsistent.' : 'Invoice delivery history could not be read.' });
    const errorCode = failure === 'integrity' ? 'INVOICE_DRAFT_DELIVERY_HISTORY_INTEGRITY_FAILED' : 'INVOICE_DRAFT_DELIVERY_HISTORY_READ_FAILED';
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const events = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: 'http.requestFailed', errorCode,
      operationId: 'invoiceDraft.deliveryHistory', stage: 'read', sideEffectState: 'none', retryable: false,
      correlationId: response.headers.get('x-eky-correlation-id'),
    }), expect.objectContaining({ eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED' })]));
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support.diagnosticEvents).toEqual(events);
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents.incidentSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: 'http.requestFailed', errorCode, count: 1 }),
      expect.objectContaining({ eventName: 'http.requestFailed', errorCode: 'HTTP_REQUEST_FAILED', count: 1 }),
    ]));
    const projected = JSON.stringify({ events, support, incidents });
    for (const forbidden of [raw, f.key.invoiceId, f.key.companyId, 'revision-draft', 'owner@example.invalid', 'invoicePdf.storageFailed']) {
      expect(projected).not.toContain(forbidden);
    }
    expect(stderr).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('does not replace integrity failure with a diagnostic writer failure', async () => {
    const f = await reopenedFixture();
    setInvoiceStatus(f.database, f.key, 'approved');
    f.write.mockImplementation(() => { throw new Error('synthetic-private-log-failure'); });
    const response = await f.app.request(url);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Stored invoice delivery history is inconsistent.' });
    expect(f.noNetwork).not.toHaveBeenCalled();
  });
});
