import { afterEach, describe, expect, it, vi } from 'vitest';

import { localRuntimeSessionHeaderName } from '../main/protocolPolicy.js';
import { createInvoicePdfPreviewSmokeFixture } from './invoicePdfPreviewSmoke.js';

describe('packaged multi-revision invoice fixture', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains the first PDF through dry-run, edit and same-number reapproval', async () => {
    const calls = installBackend();
    await expect(createInvoicePdfPreviewSmokeFixture(input)).resolves.toBe('invoice-1');
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      'PUT /company-settings', 'PUT /invoice-numbering-settings',
      'POST /customers', 'POST /invoice-drafts', 'POST /invoice-drafts/draft-1/approve',
      'POST /invoices/invoice-1/pdf', 'GET /invoices/invoice-1/pdf',
      'POST /invoices/invoice-1/email/dry-run/send',
      'POST /invoices/invoice-1/reopen-for-edit', 'PUT /invoice-drafts/draft-1',
      'POST /invoice-drafts/draft-1/approve', 'POST /invoices/invoice-1/pdf',
      'GET /invoices/invoice-1/pdf',
      'GET /invoices/invoice-1/delivery-events/event-1/pdf',
    ]);
    const original = calls.find(call => call.path === '/invoice-drafts')!.body;
    const edited = calls.find(call => call.path === '/invoice-drafts/draft-1')!.body;
    expect(edited).toEqual({ ...original, subject: 'Desktop PDF smoke second revision' });
  });

  it.each(['draft', 'invoice', 'number'] as const)(
    'rejects changed %s identity', async identity => {
      installBackend({ identity });
      await expect(createInvoicePdfPreviewSmokeFixture(input))
        .rejects.toThrow('DESKTOP_SMOKE_INVOICE_REVISION_IDENTITY_FAILED');
    },
  );

  it.each(['document', 'currentPdf', 'historicalPdf', 'missingHistoricalPdf'] as const)(
    'rejects the %s regression', async content => {
      installBackend({ content });
      await expect(createInvoicePdfPreviewSmokeFixture(input))
        .rejects.toThrow('DESKTOP_SMOKE_INVOICE_REVISION_CONTENT_FAILED');
    },
  );

  it('stops before editing when the dry-run fails', async () => {
    const calls = installBackend({ dryRunFails: true });
    await expect(createInvoicePdfPreviewSmokeFixture(input))
      .rejects.toThrow('DESKTOP_SMOKE_PDF_PREVIEW_FIXTURE_FAILED');
    expect(calls.some(call => call.path.endsWith('/reopen-for-edit'))).toBe(false);
  });
});

const input = { backendPort: 43123, runtimeSessionSecret: 'synthetic-smoke-session' };
interface Call { path: string; method: string; body?: Record<string, unknown> }
interface Fault {
  identity?: 'draft' | 'invoice' | 'number';
  content?: 'document' | 'currentPdf' | 'historicalPdf' | 'missingHistoricalPdf';
  dryRunFails?: boolean;
}

function installBackend(fault: Fault = {}): Call[] {
  const calls: Call[] = [];
  let approvalCount = 0;
  let documentCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    expect(parsed.origin).toBe(`http://127.0.0.1:${input.backendPort}`);
    expect(new Headers(init?.headers).get(localRuntimeSessionHeaderName))
      .toBe(input.runtimeSessionSecret);
    const method = init?.method ?? 'GET';
    const path = parsed.pathname;
    calls.push({ path, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (path === '/company-settings' || path === '/invoice-numbering-settings') return Response.json({});
    if (path === '/customers') return Response.json({ customer: { id: 'customer-1' } });
    if (path === '/invoice-drafts' || path === '/invoice-drafts/draft-1') {
      return Response.json({ invoiceDraft: { id: 'draft-1' } });
    }
    if (path.endsWith('/approve')) {
      approvalCount++;
      return Response.json({ approvedInvoice: {
        invoiceId: approvalCount === 2 && fault.identity === 'invoice' ? 'invoice-2' : 'invoice-1',
        invoiceNumber: approvalCount === 2 && fault.identity === 'number' ? '20260002' : '20260001',
      } });
    }
    if (path.endsWith('/email/dry-run/send')) {
      return Response.json({ delivery: { deliveryEventId: 'event-1' } },
        { status: fault.dryRunFails ? 500 : 200 });
    }
    if (path.endsWith('/reopen-for-edit')) {
      return Response.json({ invoiceDraftId: fault.identity === 'draft' ? 'draft-2' : 'draft-1' });
    }
    if (method === 'POST' && path.endsWith('/pdf')) {
      documentCount++;
      return Response.json({ document: { id: `document-${fault.content === 'document' ? 1 : documentCount}` } });
    }
    if (method === 'GET' && path.endsWith('/pdf')) {
      const historical = path.includes('/delivery-events/');
      const original = historical ? fault.content !== 'historicalPdf'
        : documentCount === 1 || fault.content === 'currentPdf';
      return new Response(original ? '%PDF original revision' : '%PDF edited revision', {
        status: historical && fault.content === 'missingHistoricalPdf' ? 404 : 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    throw new Error('Unexpected synthetic smoke request');
  }));
  return calls;
}
