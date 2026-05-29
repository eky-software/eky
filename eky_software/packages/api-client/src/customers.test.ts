import { describe, expect, it } from 'vitest';

import { createEkyApiClient, EkyApiError, type Customer } from './customers.js';

describe('createEkyApiClient', () => {
  it('lists customers through GET /customers', async () => {
    const customers: Customer[] = [createTestCustomer()];
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
    const customer = createTestCustomer();
    const input = {
      businessId: '1234567-8',
      city: 'Helsinki',
      comment: 'Important local customer',
      customerNumber: '1001',
      customerType: 'company',
      email: 'customer@example.fi',
      name: 'Example Customer Oy',
      phone: '040 123 4567',
      postalCode: '00100',
      status: 'active',
      streetAddress: 'Testikatu 1',
    } as const;
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input, init) => {
        requests.push({ input: input.toString(), init });

        return jsonResponse({ customer }, { status: 201 });
      },
    });

    const result = await client.createCustomer(input);

    expect(result).toEqual(customer);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/customers');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
  });

  it('throws an API error for backend error responses', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse({ error: 'Customer name is required.' }, { status: 400 }),
    });

    await expect(
      client.createCustomer({
        businessId: '',
        city: '',
        comment: '',
        customerNumber: '',
        customerType: 'company',
        email: '',
        name: '',
        phone: '',
        postalCode: '',
        status: 'active',
        streetAddress: '',
      }),
    ).rejects.toMatchObject({
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

function createTestCustomer(): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1001',
    name: 'Example Customer Oy',
    customerType: 'company',
    businessId: '1234567-8',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'customer@example.fi',
    phone: '040 123 4567',
    comment: 'Important local customer',
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
