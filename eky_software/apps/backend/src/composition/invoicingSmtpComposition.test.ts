import { createHash } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { removeDirectories, temporaryDirectory } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { createBackendOperationalLogger } from '../observability/infrastructure/createBackendOperationalLogger.js';
import { FileSystemDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemDiagnosticEventReader.js';
import { FileSystemSupportBundleDiagnosticEventReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleDiagnosticEventReader.js';
import { FileSystemSupportBundleIncidentSummaryReader } from '../modules/diagnostics/infrastructure/fileSystemSupportBundleIncidentSummaryReader.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceCorrectionRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceCorrectionRepository.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { readReservedEvent } from '../modules/invoicing/infrastructure/invoiceEmailReservation.fixture.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import type { InvoiceSmtpDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import type { InvoiceSmtpTestDeliveryProvider } from '../modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import { createPdfCompositionFixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);
type Mode = 'customer' | 'smtpTest';
const message = { body: 'Synthetic body', cc: 'copy@example.invalid', subject: 'Synthetic invoice', to: 'customer@example.invalid' };

async function fixture() {
  const f = await createPdfCompositionFixture();
  const sendEmail = vi.fn<InvoiceSmtpDeliveryProvider['sendEmail']>().mockImplementation(async input => ({
    provider: 'smtp', testMode: false, deliveredTo: input.to, deliveredCc: input.cc, providerMessageId: 'synthetic-message',
  }));
  const sendTestEmail = vi.fn<InvoiceSmtpTestDeliveryProvider['sendTestEmail']>().mockImplementation(async input => ({
    provider: 'smtp', testMode: true, deliveredTo: input.emailTestRecipientOverride, providerMessageId: 'synthetic-test-message',
  }));
  const logsRoot = temporaryDirectory();
  const archive = vi.fn(async () => undefined);
  const createApp = () => f.createApp(f.storage, true, {
    deliveryPermission: true,
    operationalLogger: createBackendOperationalLogger(logsRoot),
    infrastructureAdapters: { invoiceSmtpDeliveryProvider: { sendEmail }, invoiceSmtpTestDeliveryProvider: { sendTestEmail } },
    invoiceEmailSettingsReader: { getEmailSettings: async () => ({
      emailDeliveryProvider: 'dnaSmtp', emailSenderAddress: 'sender@example.invalid', emailSenderName: 'Synthetic',
      emailUsername: 'synthetic', emailTestRecipientOverride: 'owner@example.invalid',
    }) },
    deliveredInvoiceArchiveTaskSink: { queueDeliveredInvoiceArchiveTask: archive },
  });
  const app = createApp();
  expect((await f.approve(app)).status).toBe(200);
  const key = f.current();
  const preview = await app.request(`/invoices/${key.invoiceId}/email/dry-run`, { method: 'POST' });
  expect(preview.status).toBe(200);
  const { email: { documentTarget } } = await preview.json();
  const post = (mode: Mode, operation: 'prepare' | 'send', extra = {}, target = app) =>
    target.request(`/invoices/${key.invoiceId}/email/${mode === 'customer' ? 'smtp' : 'smtp-test'}/${operation}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...message, ...(mode === 'customer' ? { documentTarget } : {}), ...extra }),
    });
  const prepare = async (mode: Mode) => {
    const response = await post(mode, 'prepare');
    expect(response.status).toBe(200);
    const data = await response.json() as { preparation: { attemptId: string; authorizationToken: string } };
    return { attemptId: data.preparation.attemptId, authorizationToken: data.preparation.authorizationToken };
  };
  const reopen = () => f.approval.repository.reopenApprovedInvoiceForEditing({
    companyId: key.companyId, invoiceId: key.invoiceId, actorUserId: 'revision-actor',
    auditEventId: 'synthetic-reopen', reopenedAt: '2026-10-05T12:00:00.000Z',
  });
  const cancel = () => {
    const invoice = f.database.prepare<[], { invoice_number: string }>('SELECT invoice_number FROM invoices').get()!;
    return new SqliteInvoiceCorrectionRepository(f.database).cancelApprovedInvoice({
      ...key, actorUserId: 'revision-actor', auditEventId: 'cancel-audit',
      cancelledAt: '2027-01-16T08:00:00.000Z', cancellationReason: 'Synthetic cancellation',
      confirmationInvoiceNumber: invoice.invoice_number,
    });
  };
  return { ...f, app, key, documentTarget, logsRoot, archive, sendEmail, sendTestEmail, createApp, post, prepare, reopen, cancel };
}

describe('revision-bound SMTP production composition', () => {
  it.each(['prepare', 'send'] as const)('rejects a different customer preview target during %s', async operation => {
    const f = await fixture();
    const prepared = operation === 'send' ? await f.prepare('customer') : {};
    const before = publicationState(f.database);
    for (const documentTarget of [
      { kind: 'revision', documentId: 'another-preview-document' },
      { kind: 'preservedLegacy', documentId: f.documentTarget.documentId },
    ]) expect((await f.post('customer', operation, { ...prepared, documentTarget })).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['customer', 'smtpTest'] as const)('prevents %s provider entry if cancellation wins immediately before reservation', async mode => {
    const f = await fixture();
    const prepared = await f.prepare(mode);
    const reserve = SqliteInvoiceDeliveryEventRepository.prototype.reserveEmailDelivery;
    vi.spyOn(SqliteInvoiceDeliveryEventRepository.prototype, 'reserveEmailDelivery').mockImplementationOnce(async function(this: SqliteInvoiceDeliveryEventRepository, input) {
      await expect(f.cancel()).resolves.toMatchObject({ outcome: 'cancelled' });
      return reserve.call(this, input);
    });
    expect((await f.post(mode, 'send', prepared)).status).toBe(409);
    expect(f.database.prepare('SELECT status FROM invoices').get()).toEqual({ status: 'cancelled' });
    expect(readReservedEvent(f.database, prepared.attemptId)).toBeUndefined();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.sendTestEmail).not.toHaveBeenCalled();
  });

  it.each(['customer', 'smtpTest'] as const)('rejects cancellation after %s enters the provider and retains terminal history', async mode => {
    const f = await fixture();
    const prepared = await f.prepare(mode);
    const duringSend = async () => {
      const before = publicationState(f.database);
      await expect(f.cancel()).resolves.toEqual({ outcome: 'deliveryConflict' });
      expect(publicationState(f.database)).toEqual(before);
    };
    const customer = f.sendEmail.getMockImplementation()!;
    const self = f.sendTestEmail.getMockImplementation()!;
    f.sendEmail.mockImplementation(async input => { await duringSend(); return customer(input); });
    f.sendTestEmail.mockImplementation(async input => { await duringSend(); return self(input); });
    expect((await f.post(mode, 'send', prepared)).status).toBe(200);
    const before = publicationState(f.database);
    await expect(f.cancel()).resolves.toEqual({ outcome: mode === 'customer' ? 'notCancellable' : 'deliveryConflict' });
    expect(publicationState(f.database)).toEqual(before);
  });

  it.each(['customer', 'smtpTest'] as const)('reserves %s before the provider and persists the exact PDF and mode', async mode => {
    const f = await fixture();
    const prepared = await f.prepare(mode);
    const capture = async (content: Uint8Array) => {
      const row = readReservedEvent(f.database, prepared.attemptId)!;
      expect(row).toMatchObject({ status: 'attempted', binding_kind: 'revision', revision_id: f.key.revisionId, send_mode: mode });
      expect(row.document_sha256).toBe(createHash('sha256').update(content).digest('hex'));
      expect(row.document_size_bytes).toBe(content.byteLength);
      await expect(f.reopen()).rejects.toThrow();
    };
    const customer = f.sendEmail.getMockImplementation()!;
    const self = f.sendTestEmail.getMockImplementation()!;
    f.sendEmail.mockImplementation(async input => { await capture(input.pdfContent); return customer(input); });
    f.sendTestEmail.mockImplementation(async input => { await capture(input.pdfContent); return self(input); });
    const response = await f.post(mode, 'send', prepared);
    expect(response.status).toBe(200);
    expect(readReservedEvent(f.database, prepared.attemptId)).toMatchObject({
      status: 'succeeded', revision_id: f.key.revisionId, send_mode: mode,
      recipient_email: mode === 'customer' ? message.to : 'owner@example.invalid',
      cc_email: mode === 'customer' ? message.cc : '',
    });
    const called = mode === 'customer' ? f.sendEmail : f.sendTestEmail;
    expect(called).toHaveBeenCalledTimes(1);
    expect(called.mock.calls[0]![0].pdfContent.every(value => value === 0)).toBe(true);
    expect(f.database.prepare('SELECT status FROM invoices').get()).toEqual({ status: mode === 'customer' ? 'sent' : 'approved' });
    if (mode === 'smtpTest') {
      const before = readReservedEvent(f.database, prepared.attemptId);
      await expect(f.reopen()).resolves.toBeDefined();
      expect(readReservedEvent(f.database, prepared.attemptId)).toEqual(before);
      expect(f.archive).not.toHaveBeenCalled();
    } else {
      expect(f.archive).toHaveBeenCalledTimes(1);
      await expect(response.json()).resolves.toMatchObject({ delivery: { invoice: { status: 'sent' }, resend: false } });
    }
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['customer', 'smtpTest'] as const)('blocks %s if reopen wins after verified bytes but before reservation', async mode => {
    const f = await fixture();
    const prepared = await f.prepare(mode);
    const reserve = SqliteInvoiceDeliveryEventRepository.prototype.reserveEmailDelivery;
    vi.spyOn(SqliteInvoiceDeliveryEventRepository.prototype, 'reserveEmailDelivery').mockImplementationOnce(async function(this: SqliteInvoiceDeliveryEventRepository, input) {
      await f.reopen();
      return reserve.call(this, input);
    });
    const response = await f.post(mode, 'send', prepared);
    expect(response.status).toBe(409);
    expect(readReservedEvent(f.database, prepared.attemptId)).toBeUndefined();
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.sendTestEmail).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each([
    ['customer', 'prepare'], ['customer', 'send'],
    ['smtpTest', 'prepare'], ['smtpTest', 'send'],
  ] as const)('returns a conflict when reopen wins during PDF verification for %s %s', async (mode, operation) => {
    const f = await fixture();
    const prepared = operation === 'send' ? await f.prepare(mode) : {};
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async document => {
      const content = await read(document);
      await f.reopen();
      return content;
    });
    const response = await f.post(mode, operation, prepared);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice changed before the PDF operation completed.' });
    expect(f.database.prepare('SELECT count(*) AS count FROM invoice_delivery_events').get()).toEqual({ count: 0 });
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.sendTestEmail).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    const events = await new FileSystemDiagnosticEventReader(f.logsRoot).listRecentDiagnosticEvents(10);
    expect(events.some(event => event.eventName === 'invoiceDelivery.providerFailed')).toBe(false);
  });

  it.each(['customer', 'smtpTest'] as const)('retains %s uncertainty when completion storage fails, including a fresh app attempt store', async mode => {
    const f = await fixture();
    const prepared = await f.prepare(mode);
    f.database.exec(`CREATE TRIGGER synthetic_completion_failure BEFORE UPDATE ON invoice_delivery_events
      BEGIN SELECT RAISE(ABORT, 'SYNTHETIC'); END`);
    const response = await f.post(mode, 'send', prepared);
    expect(response.status).toBe(502);
    expect(readReservedEvent(f.database, prepared.attemptId)).toMatchObject({ status: 'attempted', send_mode: mode, revision_id: f.key.revisionId });
    const before = publicationState(f.database);
    const fresh = f.createApp();
    for (const next of ['customer', 'smtpTest'] as const) expect((await f.post(next, 'prepare', {}, fresh)).status).toBe(409);
    expect(publicationState(f.database)).toEqual(before);
    expect(f.sendEmail.mock.calls.length + f.sendTestEmail.mock.calls.length).toBe(1);
    await expect(f.reopen()).rejects.toThrow();
  });

  it('keeps committed success distinct from a later read failure through HTTP and diagnostic readers', async () => {
    const f = await fixture();
    const prepared = await f.prepare('customer');
    const provider = f.sendEmail.getMockImplementation()!;
    f.sendEmail.mockImplementation(async input => {
      vi.spyOn(SqliteApprovedInvoiceReader.prototype, 'getApprovedInvoiceById')
        .mockRejectedValue(new Error('synthetic-private-read-failure'));
      return provider(input);
    });
    const earliestTimestamp = new Date().toISOString();
    const response = await f.post('customer', 'send', prepared);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED' });
    expect(readReservedEvent(f.database, prepared.attemptId)).toMatchObject({ status: 'succeeded' });
    expect(f.database.prepare('SELECT status FROM invoices').get()).toEqual({ status: 'sent' });
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    const period = { earliestTimestamp, latestTimestamp: new Date().toISOString() };
    const diagnosticEvents = await new FileSystemDiagnosticEventReader(f.logsRoot).listRecentDiagnosticEvents(10);
    expect(diagnosticEvents).toEqual([expect.objectContaining({
      eventName: 'invoiceDelivery.finalizationFailed', errorCode: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED',
      stage: 'read', retryable: false, sideEffectState: 'committed',
    })]);
    const support = await new FileSystemSupportBundleDiagnosticEventReader(f.logsRoot).readSupportBundleDiagnosticEvents(period);
    expect(support.diagnosticEvents).toEqual(diagnosticEvents);
    const incidents = await new FileSystemSupportBundleIncidentSummaryReader(f.logsRoot).readSupportBundleIncidentSummaries(period);
    expect(incidents.incidentSummaries).toEqual([expect.objectContaining({ errorCode: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED', count: 1 })]);
    const projected = JSON.stringify({ diagnosticEvents, support, incidents });
    for (const forbidden of [f.key.companyId, f.key.invoiceId, f.key.revisionId, message.to, message.body, 'synthetic-private-read-failure', prepared.authorizationToken]) {
      expect(projected).not.toContain(forbidden);
    }
  });
});
