import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import type { ApprovedInvoiceEmailSmtpPreparation } from '../modules/invoicing/application/prepareApprovedInvoiceEmailSmtp.js';
import { InvoiceDocumentIntegrityError } from '../modules/invoicing/application/invoiceDocumentIntegrityError.js';
import { readReservedEvent } from '../modules/invoicing/infrastructure/invoiceEmailReservation.fixture.js';
import { syntheticPdf } from '../modules/invoicing/infrastructure/invoicePdfRead.fixture.js';
import { closePublicationDatabases, publicationState, setInvoiceStatus } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceLegacyResendReader } from '../modules/invoicing/infrastructure/sqliteInvoiceLegacyResendReader.js';
import { InvoiceSmtpDeliveryError, type InvoiceSmtpDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { createLegacyReviewCompositionFixture, legacyReviewRequest } from './invoicingLegacyReviewComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);
const message = { body: 'Synthetic preserved invoice', cc: 'copy@example.invalid', subject: 'Synthetic invoice', to: 'customer@example.invalid' };

async function fixture(preflight = true) {
  const f = await createLegacyReviewCompositionFixture();
  setInvoiceStatus(f.database, f.scope, 'sent');
  const sendEmail = vi.fn<InvoiceSmtpDeliveryProvider['sendEmail']>(async input => ({
    provider: 'smtp', testMode: false, deliveredTo: input.to, deliveredCc: input.cc, providerMessageId: 'synthetic-message',
  }));
  const logsRoot = temporaryDirectory();
  const logger = createBackendOperationalLogger(logsRoot);
  const archive = vi.fn(async () => undefined);
  const createApp = (options: { allowed?: boolean; companyId?: string } = {}) => f.createApp({
    ...options, logger, sendEmail, queueArchive: archive, prepareEmail: async email => email,
    getEmailSettings: async () => ({ emailDeliveryProvider: 'dnaSmtp', emailSenderName: 'Synthetic',
      emailSenderAddress: 'sender@example.invalid', emailUsername: 'synthetic', emailTestRecipientOverride: 'owner@example.invalid' }),
  });
  const app = createApp();
  if (preflight) expect((await app.request(`/invoices/${f.scope.invoiceId}/email/dry-run`, { method: 'POST' })).status).toBe(200);
  const selected = (await new SqliteInvoiceLegacyResendReader(f.database).findDocuments(f.scope))!;
  const documentTarget = { kind: 'preservedLegacy' as const, documentId: selected.preserved?.id ?? 'not-prepared' };
  const post = (operation: 'prepare' | 'send', extra = {}, target = app) => target.request(
    `/invoices/${f.scope.invoiceId}/email/smtp/${operation}`, legacyReviewRequest({ ...message, documentTarget, ...extra }),
  );
  const prepare = async () => {
    const response = await post('prepare');
    expect(response.status).toBe(200);
    const { preparation } = await response.json() as { preparation: ApprovedInvoiceEmailSmtpPreparation };
    return preparation;
  };
  const sendFields = (preparation: ApprovedInvoiceEmailSmtpPreparation) => ({
    attemptId: preparation.attemptId, authorizationToken: preparation.authorizationToken,
  });
  return { ...f, app, createApp, logger, logsRoot, archive, sendEmail, selected, documentTarget, post, prepare, sendFields };
}

describe('customer SMTP preserved legacy production composition', () => {
  it('confirms and rereads the exact preserved bytes, then reserves and finalizes without rewriting history', async () => {
    const f = await fixture();
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    const buffers: Uint8Array[] = [];
    const readSpy = vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementation(async metadata => {
      const bytes = await read(metadata); buffers.push(bytes); return bytes;
    });
    const preparation = await f.prepare();
    expect(preparation).toMatchObject({ documentTarget: f.documentTarget, resend: true, recipient: message.to,
      attachment: { documentId: f.documentTarget.documentId, fileName: 'original.pdf', sizeBytes: syntheticPdf.byteLength } });
    expect(JSON.stringify(preparation)).not.toMatch(/sourceDocumentId|revisionId|sha256|storagePath|companyId/);
    expect(buffers).toHaveLength(2);
    expect(buffers.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    expect(publicationState(f.database)).toEqual(before);
    const provider = f.sendEmail.getMockImplementation()!;
    f.sendEmail.mockImplementation(async input => {
      expect(input.pdfContent).toEqual(syntheticPdf);
      expect(readReservedEvent(f.database, preparation.attemptId)).toMatchObject({
        status: 'attempted', document_id: f.documentTarget.documentId, binding_kind: 'preservedLegacy', revision_id: null,
        send_mode: 'customer', document_sha256: createHash('sha256').update(input.pdfContent).digest('hex'),
        document_size_bytes: input.pdfContent.byteLength,
      });
      return provider(input);
    });
    const response = await f.post('send', f.sendFields(preparation));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery: { resend: true, testMode: false, invoice: { status: 'sent' } } });
    expect(readSpy.mock.calls.map(([metadata]) => metadata.storagePath)).toEqual([
      f.selected.source.storagePath, f.selected.preserved!.storagePath,
      f.selected.source.storagePath, f.selected.preserved!.storagePath,
    ]);
    expect(buffers.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.archive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ documentId: f.documentTarget.documentId }));
    expect(readReservedEvent(f.database, 'legacy-event')).toEqual(before.events[0]);
    expect(readReservedEvent(f.database, preparation.attemptId)).toMatchObject({ status: 'succeeded', binding_kind: 'preservedLegacy' });
    expect(publicationState(f.database).documents).toEqual(before.documents);
    expect(publicationState(f.database)).toEqual({ ...before, events: expect.any(Array) });
    expect(publicationState(f.database).events).toHaveLength(before.events.length + 1);
    expect(readFileSync(join(f.root, f.selected.preserved!.storagePath))).toEqual(syntheticPdf);
    expect(readFileSync(join(f.root, f.selected.source.storagePath))).toEqual(syntheticPdf);
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('reads archive metadata and bytes from the delivered copy rather than the current legacy original', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    expect((await f.post('send', f.sendFields(preparation))).status).toBe(200);
    const eventPath = `/invoices/${f.scope.invoiceId}/delivery-events/${preparation.attemptId}/pdf`;
    const metadata = await f.app.request(`${eventPath}/metadata`);
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.toEqual({ document: {
      id: f.documentTarget.documentId, invoiceId: f.scope.invoiceId, mimeType: 'application/pdf',
      sha256: f.selected.preserved!.sha256, sizeBytes: syntheticPdf.byteLength,
    } });
    expect(f.documentTarget.documentId).not.toBe(f.selected.source.id);
    const pdf = await f.app.request(eventPath);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer())).toEqual(syntheticPdf);
    for (const suffix of ['', '/metadata']) {
      expect((await f.createApp({ allowed: false }).request(eventPath + suffix)).status).toBe(403);
      expect((await f.createApp({ companyId: 'foreign-company' }).request(eventPath + suffix)).status).toBe(404);
    }
    writeFileSync(join(f.root, f.selected.preserved!.storagePath), '%PDF-synthetic-corruption');
    expect((await f.app.request(`${eventPath}/metadata`)).status).toBe(500);
    expect((await f.app.request(eventPath)).status).toBe(500);
  });

  it.each(['prepare', 'send'] as const)('rejects different or forged targets at %s without replacing documents', async operation => {
    const f = await fixture();
    const extra = operation === 'send' ? f.sendFields(await f.prepare()) : {};
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    for (const documentTarget of [
      { kind: 'revision', documentId: f.documentTarget.documentId },
      { kind: 'preservedLegacy', documentId: f.selected.source.id },
      { kind: 'preservedLegacy', documentId: 'another-invoice-copy' },
    ]) expect((await f.post(operation, { ...extra, documentTarget })).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('requires the copy to have been prepared already and never creates it during SMTP prepare', async () => {
    const f = await fixture(false);
    const before = publicationState(f.database);
    const write = vi.spyOn(f.storage, 'writeCandidate');
    expect((await f.post('prepare')).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each([
    ['prepare', 'source'], ['prepare', 'preserved'], ['prepare', 'missingCopy'],
    ['send', 'source'], ['send', 'preserved'], ['send', 'missingCopy'],
  ] as const)('fails closed at %s if %s changes after preview', async (operation, changed) => {
    const f = await fixture();
    const extra = operation === 'send' ? f.sendFields(await f.prepare()) : {};
    const before = publicationState(f.database);
    const path = join(f.root, changed === 'source' ? f.selected.source.storagePath : f.selected.preserved!.storagePath);
    if (changed === 'missingCopy') unlinkSync(path); else writeFileSync(path, '%PDF-synthetic-corruption');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const response = await f.post(operation, extra);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: new InvoiceDocumentIntegrityError().message });
    expect(publicationState(f.database)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('retains the read failure even when the existing diagnostic writer fails', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    const before = publicationState(f.database);
    writeFileSync(join(f.root, f.selected.preserved!.storagePath), '%PDF-synthetic-corruption');
    vi.spyOn(f.logger, 'write').mockImplementation(() => { throw new Error('synthetic-private-logger-failure'); });
    const response = await f.post('send', f.sendFields(preparation));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: new InvoiceDocumentIntegrityError().message });
    expect(publicationState(f.database)).toEqual(before);
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it('lets the atomic reservation reject an unresolved delivery inserted after the exact reread', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    const original = SqliteInvoiceDeliveryEventRepository.prototype.reserveEmailDelivery;
    vi.spyOn(SqliteInvoiceDeliveryEventRepository.prototype, 'reserveEmailDelivery').mockImplementationOnce(async function(this: SqliteInvoiceDeliveryEventRepository, input) {
      expect(await original.call(this, { ...input, eventId: 'competing-attempt' })).toMatchObject({ outcome: 'reserved' });
      return original.call(this, input);
    });
    expect((await f.post('send', f.sendFields(preparation))).status).toBe(409);
    expect(readReservedEvent(f.database, preparation.attemptId)).toBeUndefined();
    expect(readReservedEvent(f.database, 'competing-attempt')).toMatchObject({ status: 'attempted', binding_kind: 'preservedLegacy' });
    expect((await f.post('prepare', {}, f.createApp())).status).toBe(409);
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('keeps authorization bound to the confirmed message as well as the document', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    const before = publicationState(f.database);
    expect((await f.post('send', { ...f.sendFields(preparation), body: 'Different synthetic message' })).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it('retains an attempted reservation across a fresh app after finalization failure', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    f.database.exec(`CREATE TRIGGER synthetic_completion_failure BEFORE UPDATE ON invoice_delivery_events
      BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END`);
    expect((await f.post('send', f.sendFields(preparation))).status).toBe(502);
    expect(readReservedEvent(f.database, preparation.attemptId)).toMatchObject({
      status: 'attempted', binding_kind: 'preservedLegacy', document_id: f.documentTarget.documentId,
    });
    expect((await f.post('prepare', {}, f.createApp())).status).toBe(409);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['failed', 'outcomeUnknown'] as const)('retains the exact preserved binding and sent invoice after %s', async outcome => {
    const f = await fixture();
    const preparation = await f.prepare();
    const before = publicationState(f.database);
    f.sendEmail.mockRejectedValue(new InvoiceSmtpDeliveryError(outcome, null));
    expect((await f.post('send', f.sendFields(preparation))).status).toBe(502);
    expect(readReservedEvent(f.database, preparation.attemptId)).toMatchObject({ status: outcome, binding_kind: 'preservedLegacy',
      document_id: f.documentTarget.documentId, revision_id: null, send_mode: 'customer' });
    expect(publicationState(f.database)).toEqual({ ...before, events: expect.any(Array) });
    expect(publicationState(f.database).events).toHaveLength(before.events.length + 1);
    expect(readReservedEvent(f.database, 'legacy-event')).toEqual(before.events[0]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it.each(['permission', 'company'] as const)('checks the trusted %s before reading the preserved document', async boundary => {
    const f = await fixture();
    const preparation = await f.prepare();
    const app = f.createApp(boundary === 'permission' ? { allowed: false } : { companyId: 'foreign-company' });
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    for (const operation of ['prepare', 'send'] as const) {
      expect((await f.post(operation, operation === 'send' ? f.sendFields(preparation) : {}, app)).status).toBe(boundary === 'permission' ? 403 : 404);
    }
    expect(read).not.toHaveBeenCalled();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noExternalEffect).not.toHaveBeenCalled();
  });

  it('retains integrity evidence through existing diagnostic readers without raw data', async () => {
    const f = await fixture();
    const preparation = await f.prepare();
    const earliestTimestamp = new Date().toISOString();
    writeFileSync(join(f.root, f.selected.preserved!.storagePath), '%PDF-synthetic-corruption');
    expect((await f.post('send', f.sendFields(preparation))).status).toBe(500);
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const diagnosticEvents = await new FileSystemDiagnosticEventReader(f.logsRoot).listRecentDiagnosticEvents(10);
    expect(diagnosticEvents).toEqual([expect.objectContaining({ eventName: 'invoicePdf.storageFailed',
      errorCode: 'INVOICE_PDF_INTEGRITY_FAILED', stage: 'read', retryable: false, sideEffectState: 'none' })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(f.logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support.diagnosticEvents).toEqual(diagnosticEvents);
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(f.logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents.incidentSummaries).toEqual([expect.objectContaining({ errorCode: 'INVOICE_PDF_INTEGRITY_FAILED', count: 1 })]);
    const projected = JSON.stringify({ diagnosticEvents, support, incidents });
    for (const value of [f.scope.companyId, f.scope.invoiceId, f.documentTarget.documentId, f.root, message.to, message.body,
      preparation.authorizationToken, f.selected.preserved!.sha256, 'storagePath']) expect(projected).not.toContain(value);
  });
});
