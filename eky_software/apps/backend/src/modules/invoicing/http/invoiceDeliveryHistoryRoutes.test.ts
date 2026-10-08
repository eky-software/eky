import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceDocumentNotFoundError } from '../application/approvedInvoiceDocumentNotFoundError.js';
import { createDocumentMetadata } from '../application/generateApprovedInvoicePdfDocument.fixture.js';
import type { getInvoiceDeliveryEventPdf } from '../application/getInvoiceDeliveryEventPdf.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { createInvoiceDeliveryHistoryRoutes } from './invoiceDeliveryHistoryRoutes.js';

function fixture() {
  const actorContext = createActorContext({
    actorId: 'trusted-actor', companyId: 'trusted-company', authenticationMode: 'local', permissions: ['sendInvoices'],
  });
  const read = vi.fn<(input: Parameters<typeof getInvoiceDeliveryEventPdf>[0]) => ReturnType<typeof getInvoiceDeliveryEventPdf>>();
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => { context.set('actorContext', actorContext); await next(); });
  app.route('/', createInvoiceDeliveryHistoryRoutes({ getInvoiceDeliveryEventPdf: read }));
  return { app, read, actorContext };
}

describe('invoice delivery history PDF route', () => {
  const url = '/invoices/invoice-1/delivery-events/event-1/pdf';
  it.each(['', '/metadata'])('does not accept caller identity or document-selection overrides at %s', async suffix => {
    const f = fixture();
    f.read.mockResolvedValue({ kind: 'legacyMissingDocument' });
    const response = await f.app.request(url + suffix + '?companyId=foreign&documentId=other&revisionId=newer');
    expect(f.read).toHaveBeenCalledExactlyOnceWith({ actorContext: f.actorContext, invoiceId: 'invoice-1', eventId: 'event-1' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'The legacy delivery event has no preserved PDF.' });
  });

  it.each([
    [new AuthorizationError(), 403, 'Access denied.'],
    [new ApprovedInvoiceDocumentNotFoundError(), 404, new ApprovedInvoiceDocumentNotFoundError().message],
    [new InvoiceDocumentIntegrityError(), 500, new InvoiceDocumentIntegrityError().message],
    [new InvoiceDraftValidationError('Delivery event id is invalid.'), 400, 'Delivery event id is invalid.'],
  ] as const)('maps safe errors to %s / %s', async (error, status, message) => {
    const f = fixture();
    f.read.mockRejectedValue(error);
    for (const suffix of ['', '/metadata']) {
      const response = await f.app.request(url + suffix);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: message });
    }
  });

  it('projects only exact document metadata and clears the verified temporary bytes', async () => {
    const f = fixture();
    const content = new TextEncoder().encode('%PDF-test');
    const metadata = createDocumentMetadata();
    f.read.mockResolvedValue({ kind: 'document', file: { content, metadata } });
    const response = await f.app.request(url + '/metadata');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ document: {
      id: metadata.id, invoiceId: metadata.invoiceId, mimeType: metadata.mimeType,
      sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
    } });
    expect(content.every(byte => byte === 0)).toBe(true);
  });

  it('serves the exact byte window without disclosing unsafe stored filenames', async () => {
    const f = fixture();
    const buffer = new TextEncoder().encode('private-prefix%PDF-testprivate-suffix');
    const content = buffer.subarray(14, 23);
    f.read.mockResolvedValue({ kind: 'document', file: {
      content, metadata: { ...createDocumentMetadata(), fileName: 'unsafe"\r\nInjected: value.pdf' },
    } });
    const response = await f.app.request(url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content);
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="invoice.pdf"');
    expect(response.headers.get('Injected')).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
