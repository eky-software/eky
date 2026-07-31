import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import { InvoicePaymentConflictError } from '../application/invoicePaymentConflictError.js';
import { InvoicePaymentDateError } from '../application/invoicePaymentDateError.js';
import type { InvoicePaymentSummary } from '../domain/invoicePayment.js';
import { createApprovedInvoicePaymentRoutes } from './approvedInvoicePaymentRoutes.js';

describe('approved invoice payment routes', () => {
  it('marks an invoice paid using only the trusted actor context and paidOn', async () => {
    const { app, markInvoicePaid } = createTestApp();

    const response = await app.request('/invoices/invoice-1/payment', {
      body: JSON.stringify({ paidOn: '2026-07-31' }),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      method: 'PUT',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ payment: paidPayment() });
    expect(markInvoicePaid).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({
        actorId: 'local-owner',
        companyId: 'company-1',
      }),
      invoiceId: 'invoice-1',
      paidOn: '2026-07-31',
    });
  });

  it.each([
    [{}, 400],
    [{ companyId: 'other-company', paidOn: '2026-07-31' }, 400],
    [{ paidAmountCents: 1, paidOn: '2026-07-31' }, 400],
    [{ paidOn: 20260731 }, 400],
  ] as const)('rejects an invalid mark-paid body', async (body, status) => {
    const { app, markInvoicePaid } = createTestApp();

    const response = await app.request('/invoices/invoice-1/payment', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(status);
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 415],
    ['text/plain', 415],
  ] as const)('requires JSON media type for a non-empty body', async (contentType, status) => {
    const { app } = createTestApp();
    const headers = contentType === undefined
      ? undefined
      : { 'Content-Type': contentType };

    const init: RequestInit = {
      body: JSON.stringify({ paidOn: '2026-07-31' }),
      method: 'PUT',
      ...(headers === undefined ? {} : { headers }),
    };
    const response = await app.request('/invoices/invoice-1/payment', init);

    expect(response.status).toBe(status);
  });

  it('maps malformed JSON and an oversized body safely', async () => {
    const { app } = createTestApp();

    const malformedResponse = await app.request('/invoices/invoice-1/payment', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const oversizedResponse = await app.request('/invoices/invoice-1/payment', {
      body: JSON.stringify({ paidOn: 'x'.repeat(3_000) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(malformedResponse.status).toBe(400);
    expect(oversizedResponse.status).toBe(413);
  });

  it('reverts a payment mark without accepting a request body', async () => {
    const { app, revertInvoicePaidMark } = createTestApp();

    const response = await app.request('/invoices/invoice-1/payment', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ payment: unpaidPayment() });
    expect(revertInvoicePaidMark).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({
        actorId: 'local-owner',
        companyId: 'company-1',
      }),
      invoiceId: 'invoice-1',
    });

    const bodyResponse = await app.request('/invoices/invoice-1/payment', {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
    });
    expect(bodyResponse.status).toBe(400);
  });

  it.each([
    [new AuthorizationError(), 403],
    [new ApprovedInvoiceNotFoundError(), 404],
    [new InvoicePaymentDateError(), 400],
    [new InvoicePaymentConflictError(), 409],
  ] as const)('maps known errors to a safe response', async (error, status) => {
    const { app, markInvoicePaid } = createTestApp();
    markInvoicePaid.mockRejectedValueOnce(error);

    const response = await app.request('/invoices/invoice-1/payment', {
      body: JSON.stringify({ paidOn: '2026-07-31' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(status);
    const body = await response.json() as { error: string };
    expect(body.error).not.toContain('company-1');
    expect(body.error).not.toContain('SQL');
    expect(body.error).not.toContain('stack');
  });
});

function createTestApp() {
  const markInvoicePaid = vi.fn().mockResolvedValue(paidPayment());
  const revertInvoicePaidMark = vi.fn().mockResolvedValue(unpaidPayment());
  const routes = createApprovedInvoicePaymentRoutes({
    markInvoicePaid,
    revertInvoicePaidMark,
  });
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'company-1',
        permissions: ['manageInvoicePayments'],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return { app, markInvoicePaid, revertInvoicePaidMark };
}

function paidPayment(): InvoicePaymentSummary {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    paidAmountCents: 12_550,
    paidOn: '2026-07-31',
    paymentSource: 'manual',
    paymentState: 'paid',
  };
}

function unpaidPayment(): InvoicePaymentSummary {
  return {
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    paidAmountCents: null,
    paidOn: null,
    paymentSource: null,
    paymentState: 'unpaid',
  };
}
