import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { InvoiceDocumentPublicationConflictError } from '../modules/invoicing/application/invoiceDocumentPublicationConflictError.js';
import { InvoiceDocumentIntegrityError } from '../modules/invoicing/application/invoiceDocumentIntegrityError.js';
import { InMemoryInvoiceEmailSendAttemptStore } from '../modules/invoicing/infrastructure/inMemoryInvoiceEmailSendAttemptStore.js';
import { syntheticPdf } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceLegacyResendReader } from '../modules/invoicing/infrastructure/sqliteInvoiceLegacyResendReader.js';
import type { InvoiceEmailDeliveryProvider } from '../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';
import { createLegacyReviewCompositionFixture, legacyReviewRequest } from './invoicingLegacyReviewComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

async function fixture(withHistory = true) {
  const f = await createLegacyReviewCompositionFixture(withHistory);
  setInvoiceStatus(f.database, f.scope, 'sent');
  const prepareEmail = vi.fn<InvoiceEmailDeliveryProvider['prepareDryRunEmail']>(async email => email);
  const app = f.createApp({ prepareEmail });
  const errors: Error[] = [];
  app.onError((error, context) => {
    errors.push(error);
    return context.json({ error: 'Internal server error.' }, 500);
  });
  const post = () => app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' });
  return { ...f, app, errors, prepareEmail, post };
}

describe('preserved legacy email form preparation in production composition', () => {
  it('returns the exact preserved target without regeneration, delivery, authorization or snapshot changes', async () => {
    const f = await fixture();
    const before = publicationState(f.database);
    const buffers: Uint8Array[] = [];
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async document => {
      const content = await read(document);
      buffers.push(content);
      return content;
    });
    const authorize = vi.spyOn(InMemoryInvoiceEmailSendAttemptStore.prototype, 'prepare');
    const response = await f.post();
    expect(response.status).toBe(200);
    const selected = await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope);
    expect(selected?.preserved).toBeDefined();
    const preserved = selected!.preserved!;
    const { email } = await response.json();
    expect(email.documentTarget).toEqual({ kind: 'preservedLegacy', documentId: preserved.id });
    expect(email.attachment).toEqual({
      documentId: preserved.id, fileName: 'original.pdf', mimeType: 'application/pdf', sizeBytes: syntheticPdf.byteLength,
    });
    expect(email.body).toContain('säilytetty PDF');
    expect(email.body).not.toMatch(/Eräpäivä|Maksun saaja|Viitenumero|Tilinumero|Summa|EUR/);
    expect(email).not.toHaveProperty('authorizationToken');
    expect(email).not.toHaveProperty('attemptId');
    expect(JSON.stringify(email)).not.toMatch(/storagePath|sha256|sourceDocumentId|revisionId|companyId/);
    const after = publicationState(f.database);
    expect(after).toEqual({ ...before, documents: expect.any(Array) });
    expect(after.documents).toHaveLength(before.documents.length + 1);
    expect(after.documents).toEqual(expect.arrayContaining(before.documents));
    expect(readFileSync(join(f.root, preserved.storagePath))).toEqual(syntheticPdf);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
    expect(buffers).toHaveLength(2);
    expect(buffers.every(content => content.every(byte => byte === 0))).toBe(true);
    expect(f.prepareEmail).toHaveBeenCalledTimes(1);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();

    const repeated = await f.post();
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).email).toEqual(email);
    expect(publicationState(f.database)).toEqual(after);
  });

  it.each(['permission', 'company'] as const)('denies %s before reading or preserving files', async denial => {
    const f = await fixture();
    const before = publicationState(f.database);
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const app = f.createApp({ prepareEmail: f.prepareEmail,
      ...(denial === 'company' ? { companyId: 'foreign-company' } : { allowed: false }),
    });
    const response = await app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' });
    expect(response.status).toBe(denial === 'company' ? 404 : 403);
    expect(publicationState(f.database)).toEqual(before);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('rejects a caller-selected target instead of trusting a legacy flag', async () => {
    const f = await fixture();
    const before = publicationState(f.database);
    const response = await f.app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, legacyReviewRequest({
      documentTarget: { kind: 'preservedLegacy', documentId: 'legacy-document' },
    }));
    expect(response.status).toBe(400);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('does not regenerate a sent invoice with no eligible historical reference', async () => {
    const f = await fixture(false);
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    expect((await f.post()).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['source', 'preserved'] as const)('rejects altered %s bytes and preserves the integrity diagnosis', async changed => {
    const f = await fixture();
    let storagePath = 'legacy/original.pdf';
    if (changed === 'preserved') {
      expect((await f.post()).status).toBe(200);
      const selected = await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope);
      storagePath = selected!.preserved!.storagePath;
      f.prepareEmail.mockClear();
    }
    const before = publicationState(f.database);
    writeFileSync(join(f.root, storagePath), Buffer.from(syntheticPdf.toString().replace('Synthetic', 'Different')));
    expect((await f.post()).status).toBe(500);
    expect(f.errors).toEqual([new InvoiceDocumentIntegrityError()]);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_INTEGRITY_FAILED',
      stage: 'read', retryable: false, sideEffectState: 'unknown',
    }));
  });

  it('does not replace an integrity error with a diagnostic write failure', async () => {
    const f = await fixture();
    const before = publicationState(f.database);
    writeFileSync(join(f.root, 'legacy/original.pdf'), Buffer.from('corrupted synthetic PDF'));
    f.write.mockImplementationOnce(() => { throw new Error('Synthetic diagnostic failure.'); });
    expect((await f.post()).status).toBe(500);
    expect(f.errors).toEqual([new InvoiceDocumentIntegrityError()]);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('does not publish a preserved target if cancellation wins while reading the source', async () => {
    const f = await fixture();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async document => {
      const content = await read(document);
      setInvoiceStatus(f.database, f.scope, 'cancelled');
      return content;
    });
    expect((await f.post()).status).toBe(409);
    expect(publicationState(f.database).documents).toHaveLength(1);
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('preserves the catalogued copy and clears read buffers even if preparing the form fails', async () => {
    const f = await fixture();
    const buffers: Uint8Array[] = [];
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async document => {
      const content = await read(document);
      buffers.push(content);
      return content;
    });
    f.prepareEmail.mockRejectedValueOnce(new Error('Synthetic preparation failure.'));
    expect((await f.post()).status).toBe(500);
    expect(publicationState(f.database).documents).toHaveLength(2);
    expect(publicationState(f.database).events).toHaveLength(1);
    expect(buffers).toHaveLength(2);
    expect(buffers.every(content => content.every(byte => byte === 0))).toBe(true);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect((await f.post()).status).toBe(200);
    expect(publicationState(f.database).documents).toHaveLength(2);
  });

  it.each([false, true])('preserves conflict and reports failed candidate cleanup (logger fails: %s)', async loggerFails => {
    const f = await fixture();
    const before = publicationState(f.database);
    const candidatePaths = failCandidateCleanup(f);
    if (loggerFails) f.write.mockImplementation(() => { throw new Error('Synthetic log failure'); });
    const response = await f.post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: new InvoiceDocumentPublicationConflictError(true).message });
    expect(f.errors).toEqual([]);
    expect(publicationState(f.database).documents).toEqual(before.documents);
    expect(publicationState(f.database).events).toEqual(before.events);
    expect(candidatePaths).toHaveLength(1);
    expect(readFileSync(join(f.root, candidatePaths[0]!))).toEqual(syntheticPdf);
    expect(readFileSync(join(f.root, 'legacy/original.pdf'))).toEqual(syntheticPdf);
    expect(f.prepareEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(cleanupEvent));
  });

  it('retains cleanup evidence through Diagnostics, support and incident readers without private data', async () => {
    const f = await fixture();
    const logsRoot = temporaryDirectory();
    const app = f.createApp({ prepareEmail: f.prepareEmail, logger: createBackendOperationalLogger(logsRoot) });
    const candidatePaths = failCandidateCleanup(f);
    const earliestTimestamp = new Date().toISOString();
    expect((await app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' })).status).toBe(409);
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const diagnosticEvents = await new FileSystemDiagnosticEventReader(logsRoot).listRecentDiagnosticEvents(10);
    expect(diagnosticEvents).toEqual([expect.objectContaining(cleanupEvent)]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support).toEqual({ diagnosticEvents, sourceTruncated: false });
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents).toEqual({ sourceTruncated: false, incidentSummaries: [expect.objectContaining({
      eventName: cleanupEvent.eventName, errorCode: cleanupEvent.errorCode, count: 1,
    })] });
    const projected = JSON.stringify({ diagnosticEvents, support, incidents });
    for (const value of [f.scope.companyId, f.scope.invoiceId, f.root, logsRoot, ...candidatePaths,
      'synthetic-private-cleanup', 'companyId', 'entityId', 'storagePath']) expect(projected).not.toContain(value);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });
});

const cleanupEvent = {
  eventName: 'invoicePdf.storageFailed', errorCode: 'INVOICE_PDF_CLEANUP_FAILED',
  stage: 'cleanup', retryable: false, sideEffectState: 'unknown',
};

function failCandidateCleanup(f: Awaited<ReturnType<typeof fixture>>): string[] {
  const candidatePaths: string[] = [];
  const write = f.storage.writeCandidate.bind(f.storage);
  vi.spyOn(f.storage, 'writeCandidate').mockImplementationOnce(async input => {
    const candidate = await write(input);
    candidatePaths.push(candidate.storagePath);
    setInvoiceStatus(f.database, f.scope, 'cancelled');
    return { ...candidate, discard: async () => { throw new Error('synthetic-private-cleanup'); } };
  });
  return candidatePaths;
}
