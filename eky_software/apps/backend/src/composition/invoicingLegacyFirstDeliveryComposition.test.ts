import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { removeDirectories, snapshots, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createOperationalLoggingMiddleware } from '../http/operationalLogging.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { syntheticPdf } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceContentRevisionReader } from '../modules/invoicing/infrastructure/sqliteInvoiceContentRevisionReader.js';
import type { ApprovedInvoiceEmailPreview } from '../modules/invoicing/application/approvedInvoiceEmailPreview.js';
import type { InvoiceSmtpTestDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { createLegacyReviewCompositionFixture, legacyReviewRequest } from './invoicingLegacyReviewComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

function consistentHistoricalAmounts(database: DatabaseConnection): void {
  // The generic read fixture intentionally contains inconsistent calculated fields.
  // Establish valid historical amounts before the unmodified 039 migration copies them.
  database.exec(`
    UPDATE invoice_lines SET discount_type = 'none', discount_value = 0 WHERE id = 'line-2';
    UPDATE invoice_lines SET discount_type = 'fixed', discount_value = 2000,
      vat_cents = 4590, gross_cents = 22590 WHERE id = 'line-1';
    UPDATE invoices SET total_vat_cents = 5590, total_gross_cents = 35590 WHERE id = 'invoice-1';
  `);
}

describe('first delivery from a migrated approved invoice', () => {
  it.each(['pdf', 'email/dry-run', 'mark-sent'])('promotes stored content before %s without reapproval', async route => {
    const f = await createLegacyReviewCompositionFixture(false, consistentHistoricalAmounts);
    const revisions = new SqliteInvoiceContentRevisionReader(f.database);
    const before = await revisions.getCurrentRevision(f.scope);
    expect(before?.origin).toBe('legacySnapshot');
    const oldRows = snapshots(f.database);
    const prepareEmail = vi.fn(async (preview: ApprovedInvoiceEmailPreview) => preview);
    const queueArchive = vi.fn(async () => undefined);
    const response = await f.createApp({ prepareEmail, queueArchive }).request(
      `/invoices/${f.scope.invoiceId}/${route}`,
      legacyReviewRequest(route === 'mark-sent' ? { deliveryMethod: 'manual' } : undefined),
    );
    expect(response.status).toBe(200);
    const current = await revisions.getCurrentRevision(f.scope);
    expect(current).toMatchObject({
      origin: 'validatedLegacySnapshot', vatBreakdownState: 'authoritative',
      invoiceId: f.scope.invoiceId, invoiceNumber: before!.invoiceNumber,
      approvedAt: before!.approvedAt, totalNetCents: 30000, totalVatCents: 5590, totalGrossCents: 35590,
    });
    expect(current!.revisionId).not.toBe(before!.revisionId);
    expect(await revisions.getRevision(before!)).toEqual(before);
    expect(snapshots(f.database).invoice_content_revisions).toHaveLength(oldRows.invoice_content_revisions!.length + 1);
    const document = await f.dependencies.invoiceDocumentRepository.findCurrentDocumentForRevision(current!);
    expect(document).toBeDefined();
    const original = f.database.prepare('SELECT * FROM invoice_documents WHERE id = ?').get('legacy-document');
    expect(original).toMatchObject({ binding_kind: 'legacyOriginal', storage_path: 'legacy/original.pdf' });
    // Read the preserved bytes through the existing storage adapter, not the current PDF URL.
    const originalMetadata = await f.dependencies.invoiceDocumentRepository.findDocumentById({
      ...f.scope, documentId: 'legacy-document',
    });
    expect(originalMetadata).toBeDefined();
    expect(new Uint8Array(await f.storage.readVerifiedDocument(originalMetadata!))).toEqual(new Uint8Array(syntheticPdf));
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    const afterFirst = publicationState(f.database);
    const second = await f.createApp({ prepareEmail, queueArchive }).request(
      `/invoices/${f.scope.invoiceId}/${route}`,
      legacyReviewRequest(route === 'mark-sent' ? { deliveryMethod: 'manual' } : undefined),
    );
    expect(second.status).toBe(200);
    expect(publicationState(f.database)).toEqual(afterFirst);
  });

  it.each([
    { options: { allowed: false }, status: 403 },
    { options: { companyId: 'foreign-company' }, status: 404 },
  ])('does not promote outside the authorized scope: $status', async ({ options, status }) => {
    const f = await createLegacyReviewCompositionFixture(false, consistentHistoricalAmounts);
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    for (const route of ['pdf', 'email/dry-run', 'mark-sent']) {
      const response = await f.createApp(options).request(`/invoices/${f.scope.invoiceId}/${route}`,
        legacyReviewRequest(route === 'mark-sent' ? { deliveryMethod: 'manual' } : undefined));
      expect(response.status).toBe(status);
    }
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['pdf', 'email/dry-run', 'mark-sent'])('rejects inconsistent historical amounts safely for %s', async route => {
    const f = await createLegacyReviewCompositionFixture(false);
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const stderr = vi.spyOn(console, 'error');
    const response = await f.createApp().request(`/invoices/${f.scope.invoiceId}/${route}`,
      legacyReviewRequest(route === 'mark-sent' ? { deliveryMethod: 'manual' } : undefined));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Stored invoice content could not be verified.' });
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('rejects corrupt line arithmetic before email preview calculation without raw stderr', async () => {
    const f = await createLegacyReviewCompositionFixture(false, database => {
      consistentHistoricalAmounts(database);
      database.exec("UPDATE invoice_lines SET gross_cents = gross_cents + 1 WHERE id = 'line-1'");
    });
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const stderr = vi.spyOn(console, 'error');
    const response = await f.createApp().request(`/invoices/${f.scope.invoiceId}/email/dry-run`, legacyReviewRequest(undefined));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Stored invoice content could not be verified.' });
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('promotes on direct SMTP-test preparation and preserves editable delivery history', async () => {
    const f = await createLegacyReviewCompositionFixture(false, consistentHistoricalAmounts);
    const reader = new SqliteInvoiceContentRevisionReader(f.database);
    const legacy = await reader.getCurrentRevision(f.scope);
    let deliveredBytes: Uint8Array | undefined;
    const sendTestEmail = vi.fn<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>().mockImplementation(async input => {
      deliveredBytes = new Uint8Array(input.pdfContent);
      return { deliveredTo: input.emailTestRecipientOverride, provider: 'smtp', providerMessageId: null, testMode: true };
    });
    const app = f.createApp({ sendTestEmail, getEmailSettings: async () => ({
      emailDeliveryProvider: 'dnaSmtp', emailSenderAddress: 'sender@example.invalid',
      emailSenderName: 'Synthetic seller', emailTestRecipientOverride: 'self@example.invalid', emailUsername: 'synthetic',
    }) });
    const email = { to: 'customer@example.invalid', cc: '', subject: 'Synthetic invoice', body: 'Synthetic message' };
    const prepared = await app.request(`/invoices/${f.scope.invoiceId}/email/smtp-test/prepare`, legacyReviewRequest(email));
    expect(prepared.status).toBe(200);
    const { preparation } = await prepared.json() as { preparation: { attemptId: string; authorizationToken: string } };
    const current = await reader.getCurrentRevision(f.scope);
    expect(current).toMatchObject({ origin: 'validatedLegacySnapshot' });
    expect(current!.revisionId).not.toBe(legacy!.revisionId);
    const document = await f.dependencies.invoiceDocumentRepository.findCurrentDocumentForRevision(current!);
    const expectedBytes = new Uint8Array(await f.storage.readVerifiedDocument(document!));
    const sent = await app.request(`/invoices/${f.scope.invoiceId}/email/smtp-test/send`, legacyReviewRequest({
      ...email, attemptId: preparation.attemptId, authorizationToken: preparation.authorizationToken,
    }));
    expect(sent.status).toBe(200);
    expect(sendTestEmail).toHaveBeenCalledOnce();
    expect(new Uint8Array(deliveredBytes!)).toEqual(expectedBytes);
    const { delivery } = await sent.json() as { delivery: { deliveryEventId: string } };
    const historical = await app.request(`/invoices/${f.scope.invoiceId}/delivery-events/${delivery.deliveryEventId}/pdf`);
    expect(historical.status).toBe(200);
    expect(new Uint8Array(await historical.arrayBuffer())).toEqual(expectedBytes);
    const reopened = await app.request(`/invoices/${f.scope.invoiceId}/reopen-for-edit`, legacyReviewRequest(undefined));
    expect(reopened.status).toBe(200);
    expect(await reader.getCurrentRevision(f.scope)).toBeUndefined();
    expect(await reader.getRevision(current!)).toEqual(current);
    expect(await reader.getRevision(legacy!)).toEqual(legacy);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('retains a rejected promotion in the current Diagnostics, support and incident read chain', async () => {
    const f = await createLegacyReviewCompositionFixture(false);
    const before = publicationState(f.database);
    const logsRoot = temporaryDirectory();
    const app = new Hono<BackendEnvironment>();
    app.use('*', createOperationalLoggingMiddleware({
      operationalIdentity: {
        appVersion: '0.0.0', buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      operationalLogger: createBackendOperationalLogger(logsRoot),
    }));
    app.route('/', f.createApp());
    const earliestTimestamp = new Date().toISOString();
    expect((await app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' })).status).toBe(500);
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
    for (const value of [f.scope.companyId, f.scope.invoiceId, 'legacy-document', 'storagePath', 'companyId', 'entityId']) {
      expect(projected).not.toContain(value);
    }
    expect(publicationState(f.database)).toEqual(before);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });
});
