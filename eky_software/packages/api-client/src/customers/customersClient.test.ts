import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type Customer,
} from '../index.js';

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

  it('gets one customer through GET /customers/:id', async () => {
    const customer = createTestCustomer();
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({ customer });
      },
    });

    await expect(client.getCustomer('customer-1')).resolves.toEqual(customer);
    expect(requests).toEqual(['/customers/customer-1']);
  });

  it('lists a strict customer activity page with safe query controls', async () => {
    const customerActivityPage = {
      activityEntries: [
        {
          action: 'customer.updated',
          changeCategories: ['contact'],
          id: 'event-1',
          occurredAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      hasNextPage: false,
      hasPreviousPage: true,
      page: 2,
      pageSize: 20,
    } as const;
    const requests: string[] = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (input) => {
        requests.push(input.toString());
        return jsonResponse({ customerActivityPage });
      },
    });

    await expect(
      client.listCustomerActivity('customer-1', {
        page: 2,
        pageSize: 20,
      }),
    ).resolves.toEqual(customerActivityPage);
    expect(requests).toEqual([
      '/customers/customer-1/activity?page=2&pageSize=20',
    ]);
  });

  it('rejects invalid customer activity queries before making a request', async () => {
    let requested = false;
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => {
        requested = true;
        return jsonResponse({});
      },
    });

    await expect(
      client.listCustomerActivity('customer-1', {
        page: 0,
      }),
    ).rejects.toBeInstanceOf(EkyApiError);
    expect(requested).toBe(false);
  });

  it('rejects customer activity responses containing non-allowlisted data', async () => {
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () =>
        jsonResponse({
          customerActivityPage: {
            activityEntries: [
              {
                action: 'customer.updated',
                changeCategories: ['contact'],
                email: 'must-not-be-exposed@example.invalid',
                id: 'event-1',
                occurredAt: '2026-07-01T00:00:00.000Z',
              },
            ],
            hasNextPage: false,
            hasPreviousPage: false,
            page: 1,
            pageSize: 20,
          },
        }),
    });

    await expect(
      client.listCustomerActivity('customer-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('creates a customer through POST /customers', async () => {
    const customer = createTestCustomer();
    const input = {
      businessId: '1234567-8',
      city: 'Helsinki',
      comment: 'Important local customer',
      customerNumber: '1001',
      customerNumberMode: 'manual',
      customerType: 'company',
      email: 'customer@example.fi',
      hourlyRateOverrideCents: 6500,
      managedByCustomerId: '',
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

  it('updates a customer through PUT /customers/:id', async () => {
    const customer = createTestCustomer();
    const input = {
      businessId: '1234567-8',
      city: 'Helsinki',
      comment: 'Important local customer',
      customerNumber: '1001',
      customerType: 'company',
      email: 'customer@example.fi',
      hourlyRateOverrideCents: 6500,
      managedByCustomerId: '',
      name: 'Example Customer Oy',
      phone: '040 123 4567',
      postalCode: '00100',
      status: 'active',
      streetAddress: 'Testikatu 1',
    } as const;
    const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async (requestInput, init) => {
        requests.push({ input: requestInput.toString(), init });

        return jsonResponse({ customer });
      },
    });

    const result = await client.updateCustomer('customer-1', input);

    expect(result).toEqual(customer);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/customers/customer-1');
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(requests[0]?.init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
  });

  it('throws an API error for backend error responses', async () => {
    const responseBody = { error: 'Customer name is required.' };
    const client = createEkyApiClient({
      baseUrl: '',
      fetch: async () => jsonResponse(responseBody, { status: 400 }),
    });

    await expect(
      client.createCustomer({
        businessId: '',
        city: '',
        comment: '',
        customerNumber: '',
        customerNumberMode: 'manual',
        customerType: 'company',
        email: '',
        hourlyRateOverrideCents: null,
        managedByCustomerId: '',
        name: '',
        phone: '',
        postalCode: '',
        status: 'active',
        streetAddress: '',
      }),
    ).rejects.toMatchObject({
      message: 'Customer name is required.',
      name: 'EkyApiError',
      responseBody,
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
    managedByCustomerId: '',
    phone: '040 123 4567',
    comment: 'Important local customer',
    hourlyRateOverrideCents: 6500,
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
