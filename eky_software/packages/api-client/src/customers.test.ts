import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError, type Customer } from './customers.js';

describe('createEkyApiClient', () => {
  it('lists customers through GET /customers', async () => {
    const customers: Customer[] = [
      {
        id: 'customer-1',
        companyId: 'dev-company',
        name: 'Example Customer Oy',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ];
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: 'http://127.0.0.1:3000/',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ customers });
      },
    });

    const result = await client.listCustomers();

    expect(result).toEqual(customers);
    expect(requests).toEqual([
      {
        input: 'http://127.0.0.1:3000/customers',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('creates a customer through POST /customers', async () => {
    const customer: Customer = {
      id: 'customer-1',
      companyId: 'dev-company',
      name: 'Example Customer Oy',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    };
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ customer }, { status: 201 });
      },
    });

    const result = await client.createCustomer({ name: 'Example Customer Oy' });

    expect(result).toEqual(customer);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/customers');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ name: 'Example Customer Oy' }));
  });

  it('throws an API error for backend error responses', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({ error: 'Customer name is required.' }, { status: 400 }),
    });

    await expect(client.createCustomer({ name: '' })).rejects.toMatchObject({
      message: 'Customer name is required.',
      status: 400,
    });
  });

  it('throws an API error for invalid response shapes', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({ customers: [{}] }),
    });

    await expect(client.listCustomers()).rejects.toBeInstanceOf(EkyApiError);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
