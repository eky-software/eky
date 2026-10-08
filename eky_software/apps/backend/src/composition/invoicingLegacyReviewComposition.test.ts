import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../modules/invoicing/domain/invoiceLegacyDeliveryReviewRequiredError.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { syntheticPdf } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createLegacyReviewCompositionFixture, legacyReviewCommands, legacyReviewRequest } from './invoicingLegacyReviewComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

const blocked = new InvoiceLegacyDeliveryReviewRequiredError();
const blockedEvent = {
  eventName: 'invoiceDelivery.prepareBlocked', errorCode: blocked.code,
  retryable: false, sideEffectState: 'none', stage: 'prepare',
};

describe('legacy approved invoice review hold in production composition', () => {
  it.each(legacyReviewCommands)('blocks $route before mutation, files, authorization or provider access', async ({ route, body }) => {
    const f = await createLegacyReviewCompositionFixture();
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const authorize = vi.spyOn(InMemoryInvoiceEmailSendAttemptStore.prototype, 'prepare');
    const before = publicationState(f.database);
    const response = await f.createApp().request(`/invoices/${f.scope.invoiceId}/${route}`, legacyReviewRequest(body));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: blocked.message, code: blocked.code });
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(blockedEvent));
  });

  it('preserves invoice, delivery history and exact original PDF read access', async () => {
    const f = await createLegacyReviewCompositionFixture();
    const app = f.createApp();
    const before = publicationState(f.database);
    for (const suffix of ['', '/delivery-events']) {
      expect((await app.request(`/invoices/${f.scope.invoiceId}${suffix}`)).status).toBe(200);
    }
    for (const suffix of ['/pdf', '/delivery-events/legacy-event/pdf']) {
      const response = await app.request(`/invoices/${f.scope.invoiceId}${suffix}`);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(syntheticPdf));
    }
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each(legacyReviewCommands)('keeps the company boundary before the review response for $route', async ({ route, body }) => {
    const f = await createLegacyReviewCompositionFixture();
    const before = publicationState(f.database);
    const response = await f.createApp({ companyId: 'other-company' })
      .request(`/invoices/${f.scope.invoiceId}/${route}`, legacyReviewRequest(body));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(blocked.code);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(f.write.mock.calls.every(([event]) => event.errorCode !== blocked.code)).toBe(true);
  });

  // Reopen currently uses the trusted local-owner session, not the sendInvoices port.
  it.each(legacyReviewCommands.filter(command => command.route !== 'reopen-for-edit'))(
    'requires sendInvoices before disclosing the review hold for $route', async ({ route, body }) => {
      const f = await createLegacyReviewCompositionFixture();
      const before = publicationState(f.database);
      const response = await f.createApp({ allowed: false })
        .request(`/invoices/${f.scope.invoiceId}/${route}`, legacyReviewRequest(body));
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(blocked.code);
      expect(publicationState(f.database)).toEqual(before);
      expect(f.noExternalEffect).not.toHaveBeenCalled();
      expect(f.write.mock.calls.every(([event]) => event.errorCode !== blocked.code)).toBe(true);
    },
  );

  it('does not hold a migrated approved invoice without legacy SMTP history', async () => {
    const f = await createLegacyReviewCompositionFixture(false);
    const result = await f.createApp().request(`/invoices/${f.scope.invoiceId}/reopen-for-edit`, { method: 'POST' });
    expect(result.status).toBe(200);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(legacyReviewCommands)('keeps the review response when diagnostic delivery fails for $route', async ({ route, body }) => {
    const f = await createLegacyReviewCompositionFixture();
    f.write.mockImplementation(() => { throw new Error('Synthetic diagnostic failure'); });
    const result = await f.createApp().request(`/invoices/${f.scope.invoiceId}/${route}`, legacyReviewRequest(body));
    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({ error: blocked.message, code: blocked.code });
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('carries the exact reason through Diagnostics and support without long-term incident indexing', async () => {
    const f = await createLegacyReviewCompositionFixture();
    const logsRoot = temporaryDirectory();
    const app = f.createApp({ logger: createBackendOperationalLogger(logsRoot) });
    const earliestTimestamp = new Date().toISOString();
    for (const { route, body } of legacyReviewCommands) {
      expect((await app.request(`/invoices/${f.scope.invoiceId}/${route}`, legacyReviewRequest(body))).status).toBe(409);
    }
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const events = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(20);
    expect(events).toHaveLength(legacyReviewCommands.length);
    for (const event of events) expect(event).toMatchObject(blockedEvent);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents: events, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    // A business review warning is not an error/security incident under the existing retention policy.
    expect(incidents).toEqual({ sourceTruncated: false, incidentSummaries: [] });
    const projection = JSON.stringify({ events, support, incidents });
    for (const value of [f.scope.companyId, f.scope.invoiceId, 'legacy-event', 'synthetic-attempt', 'synthetic-token',
      'synthetic@example.invalid', logsRoot, 'companyId', 'entityId', 'storagePath']) expect(projection).not.toContain(value);
  });
});
