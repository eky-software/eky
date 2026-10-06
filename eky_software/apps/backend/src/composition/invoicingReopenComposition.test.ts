import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { InvoiceDeliveryConflictError } from '../modules/invoicing/domain/invoiceDeliveryConflictError.js';
import { reservationFields } from '../modules/invoicing/infrastructure/invoiceEmailReservation.fixture.js';
import { SqliteInvoiceDeliveryEventRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.js';
import { closePublicationDatabases, publicationState } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
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
  const delivery = new SqliteInvoiceDeliveryEventRepository(f.database);
  const reservation = { eventId: 'smtp-test-event', mode: 'smtpTest' as const, target: {
    ...key, kind: 'revision' as const, documentId: document.id, sha256: document.sha256, sizeBytes: document.sizeBytes,
  } };
  expect((await delivery.reserveEmailDelivery({ ...reservation, ...reservationFields })).outcome).toBe('reserved');
  return { ...f, app, key, document, delivery, reservation };
}

describe('reopen production composition with historical PDF', () => {
  it.each(['attempted', 'outcomeUnknown'] as const)('returns safe conflict for %s without storage access or mutation', async (status) => {
    const f = await fixture();
    if (status === 'outcomeUnknown') await f.delivery.completeDeliveryEvent({ reservation: f.reservation,
      result: { status, safeErrorMessage: null, technicalErrorCode: null },
    });
    const read = vi.spyOn(f.storage, 'readVerifiedDocument');
    const write = vi.spyOn(f.storage, 'writeCandidate');
    const before = publicationState(f.database);
    const response = await f.app.request(`/invoices/${f.key.invoiceId}/reopen-for-edit`, { method: 'POST' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: new InvoiceDeliveryConflictError().message });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
    expect(publicationState(f.database)).toEqual(before);
  });

  it('keeps exact delivered bytes through real reopen and reapproval while exposing the new current PDF', async () => {
    const f = await fixture();
    await f.delivery.completeDeliveryEvent({ reservation: f.reservation,
      result: { status: 'succeeded', providerMessageId: 'synthetic-message' },
    });
    const expected = await f.storage.readVerifiedDocument(f.document);
    const historyUrl = `/invoices/${f.key.invoiceId}/delivery-events/smtp-test-event/pdf`;
    const reopened = await f.app.request(`/invoices/${f.key.invoiceId}/reopen-for-edit`, { method: 'POST' });
    expect(reopened.status).toBe(200);
    await expect(reopened.json()).resolves.toEqual({ invoiceDraftId: 'revision-draft', invoiceId: f.key.invoiceId });
    const historical = await f.app.request(historyUrl);
    expect(historical.status).toBe(200);
    expect(new Uint8Array(await historical.arrayBuffer())).toEqual(new Uint8Array(expected));
    expect((await f.app.request(`/invoices/${f.key.invoiceId}/pdf`)).status).toBe(404);

    const draft = await f.approval.drafts.getDraftById('revision-company', 'revision-draft');
    if (!draft) throw new Error('Synthetic reopened draft missing.');
    await f.approval.drafts.updateDraft({ ...draft, subject: 'New synthetic content after self-test' });
    const reapproved = await f.approve(f.app);
    expect(reapproved.status).toBe(200);
    expect(f.current().revisionId).not.toBe(f.key.revisionId);
    const current = await f.app.request(`/invoices/${f.key.invoiceId}/pdf`);
    expect(current.status).toBe(200);
    expect(new Uint8Array(await current.arrayBuffer())).not.toEqual(new Uint8Array(expected));
    const preserved = await f.app.request(historyUrl);
    expect(preserved.status).toBe(200);
    expect(new Uint8Array(await preserved.arrayBuffer())).toEqual(new Uint8Array(expected));
    expect(await f.storage.readVerifiedDocument(f.document)).toEqual(expected);
    expect(f.noNetwork).not.toHaveBeenCalled();
  });
});
