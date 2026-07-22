import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { InvoiceVatRatesView } from '../application/invoiceVatRatesView.js';
import { createInvoiceVatRatesRoutes } from './invoiceVatRatesRoutes.js';

const settings: InvoiceVatRatesView = {
  vatRates: [
    {
      rateBasisPoints: 2550,
      label: '25,50 %',
      isActive: true,
      isDefault: true,
      sortOrder: 0,
    },
  ],
  isPersisted: true,
};

describe('invoiceVatRatesRoutes', () => {
  it('uses the backend actor context and rejects server-owned request fields', async () => {
    const getInvoiceVatRates = vi.fn(async () => settings);
    const updateInvoiceVatRates = vi.fn(async () => settings);
    const app = createTestApp({ getInvoiceVatRates, updateInvoiceVatRates });

    const getResponse = await app.request(
      '/invoice-vat-rates?companyId=other-company',
    );
    const invalidPutResponse = await app.request('/invoice-vat-rates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId: 'other-company',
        vatRates: settings.vatRates,
      }),
    });

    expect(getResponse.status).toBe(200);
    expect(getInvoiceVatRates).toHaveBeenCalledWith(
      expect.objectContaining({
        actorContext: expect.objectContaining({ companyId: 'company-1' }),
      }),
    );
    expect(invalidPutResponse.status).toBe(400);
    expect(updateInvoiceVatRates).not.toHaveBeenCalled();
  });

  it('passes only validated rate fields to the update service', async () => {
    const updateInvoiceVatRates = vi.fn(async () => settings);
    const app = createTestApp({
      getInvoiceVatRates: vi.fn(async () => settings),
      updateInvoiceVatRates,
    });

    const response = await app.request('/invoice-vat-rates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vatRates: settings.vatRates }),
    });

    expect(response.status).toBe(200);
    expect(updateInvoiceVatRates).toHaveBeenCalledWith(
      expect.objectContaining({
        actorContext: expect.objectContaining({ companyId: 'company-1' }),
        vatRates: settings.vatRates,
      }),
    );
  });

  it('returns a safe forbidden response without the settings permission', async () => {
    const updateInvoiceVatRates = vi.fn(async () => {
      throw new AuthorizationError();
    });
    const app = createTestApp({
      getInvoiceVatRates: vi.fn(async () => settings),
      updateInvoiceVatRates,
    });

    const response = await app.request('/invoice-vat-rates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vatRates: settings.vatRates }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden.' });
  });
});

function createTestApp(
  dependencies: Parameters<typeof createInvoiceVatRatesRoutes>[0],
) {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'company-1',
        permissions: ['manageInvoiceSettings'],
      }),
    );
    await next();
  });
  app.route('/', createInvoiceVatRatesRoutes(dependencies));
  return app;
}
