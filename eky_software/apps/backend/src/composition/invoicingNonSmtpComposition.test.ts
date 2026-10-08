import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { removeDirectories } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { SqliteApprovedInvoiceReader } from '../modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { SqliteInvoiceActivityReader } from '../modules/invoicing/infrastructure/sqliteInvoiceActivityReader.js';
import type { InvoiceEmailDeliveryProvider } from '../modules/invoicing/ports/invoiceEmailDeliveryProvider.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { createPdfCompositionFixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

const message = { body: 'Synthetic body', cc: '', subject: 'Synthetic invoice', to: 'recipient@example.invalid' };
type Operation = 'manual' | 'prepare' | 'dryRun';

async function fixture(deliveryPermission = true, foreign = false) {
  const f = await createPdfCompositionFixture();
  const archive = vi.fn(async () => undefined);
  const provider = {
    prepareDryRunEmail: vi.fn<InvoiceEmailDeliveryProvider['prepareDryRunEmail']>(async (email) => email),
    sendDryRunEmail: vi.fn(async () => ({ provider: 'dryRun' as const, providerMessageId: null })),
  };
  const createApp = (allowed = true, otherCompany = false) => f.createApp(f.storage, true, {
    deliveryPermission: allowed, ...(otherCompany ? { companyId: 'foreign-company' } : {}),
    infrastructureAdapters: { invoiceEmailDeliveryProvider: provider },
    deliveredInvoiceArchiveTaskSink: { queueDeliveredInvoiceArchiveTask: archive },
  });
  const ownerApp = createApp();
  expect((await f.approve(ownerApp)).status).toBe(200);
  const key = f.current();
  const app = createApp(deliveryPermission, foreign);
  const post = (operation: Operation, deliveryMethod = 'manual') => app.request(
    `/invoices/${key.invoiceId}/${operation === 'manual' ? 'mark-sent' : operation === 'prepare' ? 'email/dry-run' : 'email/dry-run/send'}`,
    { method: 'POST', ...(operation === 'prepare' ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation === 'manual' ? { deliveryMethod } : message),
    }) },
  );
  const reopen = () => f.approval.repository.reopenApprovedInvoiceForEditing({
    ...key, actorUserId: 'synthetic-actor', auditEventId: 'reopen-audit', reopenedAt: '2027-01-16T08:00:00.000Z',
  });
  const cancel = () => {
    const invoice = f.database.prepare<[], { invoice_number: string }>(
      'SELECT invoice_number FROM invoices',
    ).get();
    if (!invoice) throw new Error('Synthetic invoice missing.');
    return ownerApp.request(`/invoices/${key.invoiceId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationInvoiceNumber: invoice.invoice_number, cancellationReason: 'Synthetic cancellation' }),
    });
  };
  return { ...f, app, ownerApp, key, archive, provider, post, reopen, cancel };
}

describe('revision-bound non-SMTP production composition', () => {
  it.each(['manual', 'print'])('completes %s only once and archives the persisted exact event', async method => {
    const f = await fixture();
    const response = await f.post('manual', method);
    expect(response.status).toBe(200);
    const state = publicationState(f.database);
    expect(state.events).toEqual([expect.objectContaining({ send_mode: 'manual', status: 'succeeded', revision_id: f.key.revisionId })]);
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.archive.mock.calls[0]).toEqual([expect.objectContaining({
      deliveryEventId: (state.events[0] as { id: string }).id,
      documentId: (state.events[0] as { document_id: string }).document_id,
    })]);
    expect((await f.post('manual', method)).status).toBe(200);
    expect(publicationState(f.database)).toEqual(state);
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.provider.sendDryRunEmail).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    const activity = await new SqliteInvoiceActivityReader(f.database).listInvoiceActivity({
      companyId: f.key.companyId, limit: 100,
      occurredAtFrom: '2000-01-01T00:00:00.000Z', occurredAtTo: '2100-01-01T00:00:00.000Z',
      outcomes: ['success', 'failure', 'unknown'],
    });
    expect(activity.filter(entry => entry.action === 'invoice.delivered')).toEqual([{
      id: (state.events[0] as { id: string }).id,
      action: 'invoice.delivered', outcome: 'success',
      invoiceNumber: expect.any(String), occurredAt: expect.any(String),
    }]);
  });

  it('records a dry-run without marking sent, archiving or preventing reopen', async () => {
    const f = await fixture();
    const prepared = await f.post('prepare');
    expect(prepared.status).toBe(200);
    expect(publicationState(f.database).events).toEqual([]);
    expect((await f.post('dryRun')).status).toBe(200);
    const state = publicationState(f.database);
    expect(state.events).toEqual([expect.objectContaining({ send_mode: 'dryRun', status: 'succeeded', revision_id: f.key.revisionId })]);
    expect(f.database.prepare('SELECT status FROM invoices').get()).toEqual({ status: 'approved' });
    expect(f.archive).not.toHaveBeenCalled();
    const activity = await new SqliteInvoiceActivityReader(f.database).listInvoiceActivity({
      companyId: f.key.companyId, limit: 100,
      occurredAtFrom: '2000-01-01T00:00:00.000Z', occurredAtTo: '2100-01-01T00:00:00.000Z',
      outcomes: ['success', 'failure', 'unknown'],
    });
    expect(activity.some(entry => entry.action === 'invoice.delivered')).toBe(false);
    expect((await f.cancel()).status).toBe(409);
    expect(publicationState(f.database)).toEqual(state);
    await expect(f.reopen()).resolves.toBeDefined();
    expect(publicationState(f.database).events).toEqual(state.events);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'reopen', 'reapprove'] as const)('rejects dry-run persistence when %s wins during the provider await', async change => {
    const f = await fixture();
    f.provider.sendDryRunEmail.mockImplementationOnce(async () => {
      if (change === 'cancel') {
        expect((await f.cancel()).status).toBe(200);
      } else {
        await expect(f.reopen()).resolves.toBeDefined();
        if (change === 'reapprove') expect((await f.approve(f.ownerApp)).status).toBe(200);
      }
      return { provider: 'dryRun', providerMessageId: null };
    });
    const response = await f.post('dryRun');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice has an unresolved delivery attempt.' });
    expect(f.provider.sendDryRunEmail).toHaveBeenCalledTimes(1);
    expect(publicationState(f.database).events).toEqual([]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('archives only the winning event when both manual requests read approved before either finalizes', async () => {
    const f = await fixture();
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const read = SqliteApprovedInvoiceReader.prototype.getApprovedInvoiceById;
    vi.spyOn(SqliteApprovedInvoiceReader.prototype, 'getApprovedInvoiceById').mockImplementation(async function(this: SqliteApprovedInvoiceReader, companyId, invoiceId) {
      const invoice = await read.call(this, companyId, invoiceId);
      expect(invoice?.status).toBe('approved');
      if (++reads === 2) release();
      await bothRead;
      return invoice;
    });
    const complete = vi.spyOn(SqliteInvoiceDeliveryEventRepository.prototype, 'completeManualDelivery');
    const responses = await Promise.all([f.post('manual', 'manual'), f.post('manual', 'print')]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(complete).toHaveBeenCalledTimes(2);
    const outcomes = await Promise.all(complete.mock.results.map(result => result.value));
    expect(outcomes.map(result => result?.outcome).sort()).toEqual(['alreadySent', 'completed']);
    const state = publicationState(f.database);
    expect(state.events).toHaveLength(1);
    expect(f.archive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      deliveryEventId: (state.events[0] as { id: string }).id,
      documentId: (state.events[0] as { document_id: string }).document_id,
    }));
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each(['manual', 'prepare', 'dryRun'] as const)('rejects a revision change between invoice read and PDF ensuring in %s', async operation => {
    const f = await fixture();
    const read = SqliteApprovedInvoiceReader.prototype.getApprovedInvoiceById;
    vi.spyOn(SqliteApprovedInvoiceReader.prototype, 'getApprovedInvoiceById').mockImplementationOnce(async function(this: SqliteApprovedInvoiceReader, companyId, invoiceId) {
      const invoice = await read.call(this, companyId, invoiceId);
      await f.reopen();
      expect((await f.approve(f.ownerApp)).status).toBe(200);
      return invoice;
    });
    const response = await f.post(operation);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice changed before the PDF operation completed.' });
    expect(publicationState(f.database).events).toEqual([]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.provider.prepareDryRunEmail).not.toHaveBeenCalled();
    expect(f.provider.sendDryRunEmail).not.toHaveBeenCalled();
  });

  it.each(['manual', 'prepare', 'dryRun'] as const)('returns safe409 when reopen wins during %s PDF verification', async operation => {
    const f = await fixture();
    const read = f.storage.readVerifiedDocument.bind(f.storage);
    vi.spyOn(f.storage, 'readVerifiedDocument').mockImplementationOnce(async document => {
      const content = await read(document);
      await f.reopen();
      return content;
    });
    const response = await f.post(operation);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Invoice changed before the PDF operation completed.' });
    expect(publicationState(f.database).events).toEqual([]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.provider.sendDryRunEmail).not.toHaveBeenCalled();
  });

  it.each(['manual', 'prepare', 'dryRun'] as const)('preserves permission and company denial in %s', async operation => {
    for (const foreign of [false, true]) {
      const f = await fixture(foreign, foreign);
      const before = publicationState(f.database);
      expect((await f.post(operation)).status).toBe(foreign ? 404 : 403);
      expect(publicationState(f.database)).toEqual(before);
      expect(f.archive).not.toHaveBeenCalled();
      expect(f.provider.prepareDryRunEmail).not.toHaveBeenCalled();
      expect(f.provider.sendDryRunEmail).not.toHaveBeenCalled();
    }
  });
});
