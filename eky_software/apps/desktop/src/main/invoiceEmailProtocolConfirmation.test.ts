import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronBoundary = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  handle: vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>(),
}));
vi.mock('electron', () => ({
  net: { fetch: electronBoundary.fetch },
  protocol: { handle: electronBoundary.handle },
}));

import { registerApplicationProtocol } from './applicationProtocol.js';
import type { InvoiceEmailPreparationConfirmation } from './invoiceEmailConfirmation.js';

function preparation(kind: 'revision' | 'preservedLegacy' = 'preservedLegacy') {
  return {
    attachment: { documentId: 'document-1', fileName: 'invoice.pdf', sizeBytes: 2048 },
    documentTarget: { kind, documentId: 'document-1' },
    attemptId: 'synthetic-attempt', authorizationToken: 'synthetic-token',
    invoiceId: 'invoice-1', invoiceNumber: '20260001', resend: true,
    body: 'Synthetic message', subject: 'Invoice', cc: '',
    recipient: 'recipient@example.test', sender: 'sender@example.test',
  };
}

function handler(confirm?: (value: InvoiceEmailPreparationConfirmation) => Promise<boolean>) {
  registerApplicationProtocol({
    backendOrigin: 'http://127.0.0.1:3100', runtimeSessionSecret: 'synthetic-session',
    webRoot: 'unused',
    ...(confirm === undefined ? {} : { confirmInvoiceEmailPreparation: confirm }),
  });
  return electronBoundary.handle.mock.calls.at(-1)![1];
}

function request(documentTarget: unknown = preparation().documentTarget) {
  return new Request('eky://app/invoices/invoice-1/email/smtp/prepare', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentTarget, to: 'recipient@example.test', subject: 'Invoice', body: 'Synthetic message' }),
  });
}

beforeEach(() => {
  electronBoundary.handle.mockReset();
  electronBoundary.fetch.mockReset();
});

describe('customer SMTP native confirmation transport', () => {
  it.each(['revision', 'preservedLegacy'] as const)('denies %s preparation without a confirmation owner before minting a token', async (kind) => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: preparation(kind) }));
    const response = await handler()(request(preparation(kind).documentTarget));
    expect(response.status).toBe(502);
    expect(electronBoundary.fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toMatch(/synthetic-token|synthetic-attempt/);
  });

  it('withholds the exact token until the native confirmation completes', async () => {
    let release!: (value: boolean) => void;
    let entered!: () => void;
    const confirming = new Promise<void>((resolve) => { entered = resolve; });
    const confirm = vi.fn(async (_value: InvoiceEmailPreparationConfirmation) => {
      entered();
      return new Promise<boolean>((resolve) => { release = resolve; });
    });
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: preparation() }));
    let delivered = false;
    const pending = handler(confirm)(request()).then((response) => {
      delivered = true;
      return response;
    });
    await confirming;
    expect(delivered).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      invoiceId: 'invoice-1', documentTarget: preparation().documentTarget,
    });
    expect(JSON.stringify(confirm.mock.calls[0]![0])).not.toMatch(/synthetic-token|synthetic-attempt/);
    release(true);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preparation: preparation() });
    expect(electronBoundary.fetch).toHaveBeenCalledOnce();
  });

  it('retains the ordinary revision preparation path with the same explicit confirmation', async () => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: preparation('revision') }));
    const confirm = vi.fn(async () => true);
    const response = await handler(confirm)(request(preparation('revision').documentTarget));
    expect(response.status).toBe(200);
    expect(confirm).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ preparation: preparation('revision') });
  });

  it.each([
    null,
    { kind: 'unknown', documentId: 'document-1' },
    { kind: 'preservedLegacy', documentId: 'document-2' },
    { kind: 'preservedLegacy', documentId: 'document-1', companyId: 'other' },
  ])('does not confirm a substituted request target: %o', async (target) => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: preparation() }));
    const confirm = vi.fn(async () => true);
    const response = await handler(confirm)(request(target));
    expect(response.status).toBe(502);
    expect(confirm).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('synthetic-token');
  });

  it.each(['cancel', 'throw'] as const)('does not deliver credentials on native %s', async (outcome) => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: preparation() }));
    const response = await handler(async () => {
      if (outcome === 'throw') throw new Error('private-native-error');
      return false;
    })(request());
    expect(response.status).toBe(outcome === 'cancel' ? 409 : 502);
    expect(await response.json()).toEqual({
      error: outcome === 'cancel'
        ? 'Sähköpostilähetys peruutettiin.'
        : 'Paikallinen palvelu ei vastaa.',
    });
    expect(electronBoundary.fetch).toHaveBeenCalledOnce();
  });

  it('returns the shared error envelope on SMTP test cancellation without delivering credentials', async () => {
    electronBoundary.fetch.mockResolvedValue(Response.json({
      preparation: { ...preparation(), testRecipient: 'self@example.test' },
    }));
    const confirm = vi.fn(async () => false);
    registerApplicationProtocol({
      backendOrigin: 'http://127.0.0.1:3100', runtimeSessionSecret: 'synthetic-session',
      webRoot: 'unused', confirmSmtpTestPreparation: confirm,
    });
    const response = await electronBoundary.handle.mock.calls.at(-1)![1](new Request(
      'eky://app/invoices/invoice-1/email/smtp-test/prepare', { method: 'POST' },
    ));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'SMTP-testilähetys peruutettiin.' });
    expect(confirm).toHaveBeenCalledOnce();
    expect(electronBoundary.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { documentTarget: undefined },
    { documentTarget: { kind: 'unknown', documentId: 'document-1' } },
    { documentTarget: { kind: 'revision', documentId: 'document-1' } },
    { documentTarget: { kind: 'preservedLegacy', documentId: 'document-2' } },
    { documentTarget: { kind: 'preservedLegacy', documentId: ' document-1 ' } },
    { documentTarget: { kind: 'preservedLegacy', documentId: 'document-1', extra: true } },
    { attachment: { documentId: 'document-2', fileName: 'invoice.pdf', sizeBytes: 2048 } },
    { invoiceId: 'invoice-2' },
    { resend: false },
  ])('rejects missing, inconsistent or substituted response target: %o', async (override) => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ preparation: { ...preparation(), ...override } }));
    const confirm = vi.fn(async () => true);
    const response = await handler(confirm)(request());
    expect(response.status).toBe(502);
    expect(confirm).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('synthetic-token');
  });

  it('preserves a denied backend result without showing a confirmation', async () => {
    electronBoundary.fetch.mockResolvedValue(Response.json({ message: 'Blocked' }, { status: 409 }));
    const confirm = vi.fn(async () => true);
    const response = await handler(confirm)(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: 'Blocked' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('forwards the committed delivery read error without another confirmation or send', async () => {
    const body = {
      code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED',
      error: 'Invoice delivery completed, but the updated invoice could not be read.',
    };
    electronBoundary.fetch.mockResolvedValue(Response.json(body, { status: 409 }));
    const confirm = vi.fn(async () => true);
    const response = await handler(confirm)(new Request('eky://app/invoices/invoice-1/email/smtp/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentTarget: preparation().documentTarget, to: 'recipient@example.test',
        subject: 'Invoice', body: 'Synthetic message',
        attemptId: 'synthetic-attempt', authorizationToken: 'synthetic-token',
      }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(body);
    expect(electronBoundary.fetch).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
});
