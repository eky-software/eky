import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { createDocumentMetadata } from '../application/generateApprovedInvoicePdfDocument.fixture.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { readPreservedLegacyInvoiceDocument } from '../application/readPreservedLegacyInvoiceDocument.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { createPreservedLegacyInvoiceDocumentRoutes } from './preservedLegacyInvoiceDocumentRoutes.js';

const url = '/invoices/invoice-1/preserved-documents/document-1/pdf';
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const actorContext = createActorContext({
    actorId: 'synthetic-actor', companyId: 'trusted-company', authenticationMode: 'local', permissions: ['sendInvoices'],
  });
  const read = vi.fn<(input: Parameters<typeof readPreservedLegacyInvoiceDocument>[0]) => ReturnType<typeof readPreservedLegacyInvoiceDocument>>();
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => { context.set('actorContext', actorContext); await next(); });
  app.route('/', createPreservedLegacyInvoiceDocumentRoutes({ readPreservedLegacyInvoiceDocument: read }));
  return { app, read, actorContext };
}

describe('preserved legacy document preview route', () => {
  it('passes the trusted actor and exact IDs and returns only the owned PDF byte window', async () => {
    const f = fixture();
    const backing = new TextEncoder().encode('secret-prefix%PDF-testsecret-suffix');
    const content = backing.subarray(13, 22);
    const expected = content.slice();
    const metadata = { ...createDocumentMetadata(),
      binding: { kind: 'preservedLegacy' as const, sourceDocumentId: 'source' },
      fileName: 'unsafe"\r\nInjected: value.pdf',
    };
    f.read.mockResolvedValue({ content, metadata, target: {
      kind: 'preservedLegacy', companyId: metadata.companyId, invoiceId: metadata.invoiceId,
      documentId: metadata.id, sourceDocumentId: 'source', sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
    } });
    const response = await f.app.request(url);
    expect(f.read).toHaveBeenCalledExactlyOnceWith({
      actorContext: f.actorContext, invoiceId: 'invoice-1', documentId: 'document-1',
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
    expect(content.every(byte => byte === 0)).toBe(true);
    expect(new TextDecoder().decode(backing.subarray(0, 13))).toBe('secret-prefix');
    expect(response.headers.get('Content-Length')).toBe(String(expected.byteLength));
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="invoice.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Injected')).toBeNull();
  });

  it.each(['companyId=foreign', 'documentId=other', 'kind=revision', 'revisionId=current'])('rejects query overrides: %s', async query => {
    const f = fixture();
    expect((await f.app.request(`${url}?${query}`)).status).toBe(400);
    expect(f.read).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not expose %s mutation', async method => {
    const f = fixture();
    expect((await f.app.request(url, { method })).status).toBe(404);
    expect(f.read).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthorizationError(), 403, 'Access denied.'],
    [new InvoiceDraftValidationError('Invoice document id is invalid.'), 400, 'Invoice document id is invalid.'],
    [new InvoiceDeliveryConflictError(), 409, new InvoiceDeliveryConflictError().message],
    [new InvoiceDocumentIntegrityError(), 500, new InvoiceDocumentIntegrityError().message],
  ] as const)('maps a known failure without a fallback document: %s', async (error, status, message) => {
    const f = fixture();
    f.read.mockRejectedValue(error);
    const response = await f.app.request(url);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it('contains an unexpected error without forwarding it to the framework stderr handler', async () => {
    const f = fixture();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('private synthetic infrastructure detail');
    f.read.mockRejectedValue(error);
    const response = await f.app.request(url);
    expect(response.status).toBe(500);
    expect(stderr).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error.' });
  });
});
