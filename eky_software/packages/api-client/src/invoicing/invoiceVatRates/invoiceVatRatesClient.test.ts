import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type InvoiceVatRatesView,
  type UpdateInvoiceVatRatesRequest,
} from '../../index.js';

describe('invoice VAT rates api client', () => {
  it('gets and updates the Invoicing-owned VAT rate collection', async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const invoiceVatRates = createView();
    const client = createClient(requests, { invoiceVatRates });

    await expect(client.getInvoiceVatRates()).resolves.toEqual(invoiceVatRates);
    await expect(
      client.updateInvoiceVatRates({ vatRates: invoiceVatRates.vatRates }),
    ).resolves.toEqual(invoiceVatRates);

    expect(requests.map((request) => [request.input, request.init?.method])).toEqual([
      ['/invoice-vat-rates', undefined],
      ['/invoice-vat-rates', 'PUT'],
    ]);
  });

  it('strips server-owned fields from update requests', async () => {
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const invoiceVatRates = createView();
    const client = createClient(requests, { invoiceVatRates });
    const unsafeInput = {
      vatRates: [
        {
          ...invoiceVatRates.vatRates[0],
          companyId: 'other-company',
          createdAt: '2020-01-01T00:00:00.000Z',
        },
      ],
      companyId: 'other-company',
    } as unknown as UpdateInvoiceVatRatesRequest;

    await client.updateInvoiceVatRates(unsafeInput);

    const body = JSON.parse(requests[0]?.init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      vatRates: [invoiceVatRates.vatRates[0]],
    });
  });

  it('rejects an invalid response shape', async () => {
    const client = createClient([], {
      invoiceVatRates: {
        ...createView(),
        vatRates: [{ ...createView().vatRates[0], rateBasisPoints: 25.5 }],
      },
    });

    await expect(client.getInvoiceVatRates()).rejects.toBeInstanceOf(
      EkyApiError,
    );
  });
});

function createClient(
  requests: Array<{ input: string; init: RequestInit | undefined }>,
  responseBody: unknown,
) {
  return createEkyApiClient({
    baseUrl: '',
    fetch: async (input, init) => {
      requests.push({ input: input.toString(), init });
      return new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function createView(): InvoiceVatRatesView {
  return {
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
}
