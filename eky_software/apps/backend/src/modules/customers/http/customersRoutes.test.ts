import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';

import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { GetCustomerInput } from '../application/getCustomer.js';
import type { ListCustomerHistoryInput } from '../application/listCustomerHistory.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';
import type { CustomerHistoryPage } from '../domain/customerHistory.js';
import { CustomerNotFoundError } from '../application/customerReadErrors.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import { createCustomersRoutes as createCustomersRouteHandlers } from './customersRoutes.js';

function createCustomersRoutes(
  dependencies: Omit<
    Parameters<typeof createCustomersRouteHandlers>[0],
    'getCustomer' | 'listCustomerHistory'
  > &
    Partial<
      Pick<
        Parameters<typeof createCustomersRouteHandlers>[0],
        'getCustomer' | 'listCustomerHistory'
      >
    >,
  permissions: readonly 'viewActivity'[] = [],
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions,
      }),
    );
    await next();
  });
  app.route(
    '/',
    createCustomersRouteHandlers({
      async getCustomer(): Promise<Customer> {
        throw new Error('getCustomer should not be called');
      },
      async listCustomerHistory(): Promise<CustomerHistoryPage> {
        throw new Error('listCustomerHistory should not be called');
      },
      ...dependencies,
    }),
  );

  return app;
}

describe('customersRoutes', () => {
  it('lists customers through the route dependencies', async () => {
    const customers: Customer[] = [createTestCustomer()];
    let listInput: ListCustomersInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(input): Promise<Customer[]> {
        listInput = input;

        return customers;
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers');
    const body = (await response.json()) as { customers: Customer[] };

    expect(response.status).toBe(200);
    expect(listInput).toEqual({ companyId: 'dev-company' });
    expect(body).toEqual({ customers });
  });

  it('gets one customer through ActorContext without accepting companyId', async () => {
    const customer = createTestCustomer();
    let getInput: GetCustomerInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async getCustomer(input) {
        getInput = input;
        return customer;
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request(
      '/customers/customer-1',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ customer });
    expect(getInput).toEqual({
      actorContext: expect.objectContaining({ companyId: 'dev-company' }),
      customerId: 'customer-1',
    });
  });

  it('returns the same safe not-found response for scoped customer misses', async () => {
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async getCustomer() {
        throw new CustomerNotFoundError();
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request(
      '/customers/customer-in-another-company',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Customer not found.',
    });
  });

  it('lists only the selected customer activity with safe pagination', async () => {
    let historyInput: ListCustomerHistoryInput | undefined;
    const customerActivityPage: CustomerHistoryPage = {
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
    };
    const app = createCustomersRoutes(
      {
        async createCustomer(): Promise<Customer> {
          throw new Error('createCustomer should not be called');
        },
        async listCustomerHistory(input) {
          historyInput = input;
          return customerActivityPage;
        },
        async listCustomers(): Promise<Customer[]> {
          return [];
        },
        async updateCustomer(): Promise<Customer> {
          throw new Error('updateCustomer should not be called');
        },
      },
      ['viewActivity'],
    );

    const response = await app.request(
      '/customers/customer-1/activity?page=2&pageSize=20',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ customerActivityPage });
    expect(historyInput).toEqual({
      actorContext: expect.objectContaining({
        companyId: 'dev-company',
        permissions: ['viewActivity'],
      }),
      customerId: 'customer-1',
      page: 2,
      pageSize: 20,
    });
  });

  it('rejects unsupported and invalid customer activity queries', async () => {
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    expect(
      (await app.request('/customers/customer-1/activity?companyId=other')).status,
    ).toBe(400);
    expect(
      (await app.request('/customers/customer-1/activity?pageSize=100')).status,
    ).toBe(400);
  });

  it('denies customer activity without the required permission', async () => {
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomerHistory() {
        throw new AuthorizationError();
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers/customer-1/activity');

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden.' });
  });

  it('creates a customer through the route dependencies', async () => {
    const createdCustomer = createTestCustomer();
    let createInput: CreateCustomerInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(input): Promise<Customer> {
        createInput = input;

        return createdCustomer;
      },
      async listCustomers(): Promise<Customer[]> {
        throw new Error('listCustomers should not be called');
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        comment: '  Important local customer  ',
        customerNumber: '  1001  ',
        customerType: 'company',
        email: '  customer@example.fi  ',
        hourlyRateOverrideCents: 6500,
        managedByCustomerId: '',
        name: '  Example Customer Oy  ',
        phone: '  040 123 4567  ',
        postalCode: '  00100  ',
        status: 'active',
        streetAddress: '  Testikatu 1  ',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { customer: Customer };

    expect(response.status).toBe(201);
    expect(createInput).toEqual({
      actorContext: expect.objectContaining({
        actorId: 'local-owner',
        companyId: 'dev-company',
      }),
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      comment: '  Important local customer  ',
      customerNumber: '  1001  ',
      customerNumberMode: 'manual',
      customerType: 'company',
      email: '  customer@example.fi  ',
      hourlyRateOverrideCents: 6500,
      managedByCustomerId: '',
      name: '  Example Customer Oy  ',
      phone: '  040 123 4567  ',
      postalCode: '  00100  ',
      status: 'active',
      streetAddress: '  Testikatu 1  ',
    });
    expect(body).toEqual({ customer: createdCustomer });
  });

  it('defaults to automatic customer numbers when customerNumber is omitted', async () => {
    const createdCustomer = createTestCustomer();
    let createInput: CreateCustomerInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(input): Promise<Customer> {
        createInput = input;

        return createdCustomer;
      },
      async listCustomers(): Promise<Customer[]> {
        throw new Error('listCustomers should not be called');
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({
        name: 'Example Customer Oy',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(createInput).toMatchObject({
      actorContext: expect.objectContaining({
        actorId: 'local-owner',
        companyId: 'dev-company',
      }),
      customerNumberMode: 'auto',
      name: 'Example Customer Oy',
    });
    expect(createInput).not.toHaveProperty('customerNumber');
  });

  it('rejects invalid JSON bodies', async () => {
    let createCalled = false;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        createCalled = true;

        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body.' });
    expect(createCalled).toBe(false);
  });

  it('rejects missing customer names before calling the route dependencies', async () => {
    let createCalled = false;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        createCalled = true;

        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid customer body.' });
    expect(createCalled).toBe(false);
  });

  it('rejects oversized customer bodies before calling the route dependencies', async () => {
    let createCalled = false;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        createCalled = true;

        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({ name: 'x'.repeat(16 * 1024) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'Customer body is too large.',
    });
    expect(createCalled).toBe(false);
  });

  it('rejects unknown create fields before calling the route dependencies', async () => {
    let createCalled = false;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        createCalled = true;

        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({
        name: 'Example Customer Oy',
        unknownField: true,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(createCalled).toBe(false);
  });

  it.each([123, true, [], {}])(
    'rejects wrong optional string type %# without creating a customer',
    async (invalidValue) => {
      const createCustomer = vi.fn();
      const app = createCustomersRoutes({
        createCustomer,
        async listCustomers(): Promise<Customer[]> {
          return [];
        },
        async updateCustomer(): Promise<Customer> {
          throw new Error('updateCustomer should not be called');
        },
      });

      const response = await app.request('/customers', {
        body: JSON.stringify({
          email: invalidValue,
          name: 'Example Customer Oy',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Invalid customer body.',
      });
      expect(createCustomer).not.toHaveBeenCalled();
    },
  );

  it('maps customer validation errors to bad request responses', async () => {
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new CustomerValidationError('Customer name is required.');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({ customerNumber: '1001', name: '   ' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Customer name is required.' });
  });

  it('updates a customer through the route dependencies', async () => {
    const updatedCustomer = createTestCustomer();
    let updateInput: UpdateCustomerInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        throw new Error('listCustomers should not be called');
      },
      async updateCustomer(input): Promise<Customer> {
        updateInput = input;

        return updatedCustomer;
      },
    });

    const response = await app.request('/customers/customer-1', {
      body: JSON.stringify({
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        comment: '  Important local customer  ',
        customerNumber: '  1001  ',
        customerType: 'company',
        email: '  customer@example.fi  ',
        hourlyRateOverrideCents: 6500,
        managedByCustomerId: '',
        name: '  Example Customer Oy  ',
        phone: '  040 123 4567  ',
        postalCode: '  00100  ',
        status: 'active',
        streetAddress: '  Testikatu 1  ',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const body = (await response.json()) as { customer: Customer };

    expect(response.status).toBe(200);
    expect(updateInput).toEqual({
      actorContext: expect.objectContaining({
        actorId: 'local-owner',
        companyId: 'dev-company',
      }),
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      comment: '  Important local customer  ',
      customerNumber: '  1001  ',
      customerType: 'company',
      email: '  customer@example.fi  ',
      hourlyRateOverrideCents: 6500,
      id: 'customer-1',
      managedByCustomerId: '',
      name: '  Example Customer Oy  ',
      phone: '  040 123 4567  ',
      postalCode: '  00100  ',
      status: 'active',
      streetAddress: '  Testikatu 1  ',
    });
    expect(body).toEqual({ customer: updatedCustomer });
  });

  it.each([123, true, [], {}])(
    'rejects wrong optional string type %# without updating a customer',
    async (invalidValue) => {
      const updateCustomer = vi.fn();
      const app = createCustomersRoutes({
        async createCustomer(): Promise<Customer> {
          throw new Error('createCustomer should not be called');
        },
        async listCustomers(): Promise<Customer[]> {
          return [];
        },
        updateCustomer,
      });

      const response = await app.request('/customers/customer-1', {
        body: JSON.stringify({
          customerNumber: '1001',
          email: invalidValue,
          name: 'Example Customer Oy',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Invalid customer body.',
      });
      expect(updateCustomer).not.toHaveBeenCalled();
    },
  );

  it('preserves the required customer number response without updating', async () => {
    const updateCustomer = vi.fn();
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      updateCustomer,
    });

    const response = await app.request('/customers/customer-1', {
      body: JSON.stringify({
        name: 'Example Customer Oy',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Customer number is required.',
    });
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it('rejects unknown update fields before calling the route dependencies', async () => {
    let updateCalled = false;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(): Promise<Customer[]> {
        return [];
      },
      async updateCustomer(): Promise<Customer> {
        updateCalled = true;

        throw new Error('updateCustomer should not be called');
      },
    });

    const response = await app.request('/customers/customer-1', {
      body: JSON.stringify({
        customerNumber: '1001',
        name: 'Example Customer Oy',
        unknownField: true,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(400);
    expect(updateCalled).toBe(false);
  });
});

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
