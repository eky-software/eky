import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';

import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { UpdateCustomerInput } from '../application/updateCustomer.js';
import type { Customer } from '../domain/customer.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import { createCustomersRoutes as createCustomersRouteHandlers } from './customersRoutes.js';

function createCustomersRoutes(
  dependencies: Parameters<typeof createCustomersRouteHandlers>[0],
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: [],
      }),
    );
    await next();
  });
  app.route('/', createCustomersRouteHandlers(dependencies));

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
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      comment: '  Important local customer  ',
      companyId: 'dev-company',
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
      companyId: 'dev-company',
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
    expect(body).toEqual({ error: 'Customer name is required.' });
    expect(createCalled).toBe(false);
  });

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
      businessId: '  1234567-8  ',
      city: '  Helsinki  ',
      comment: '  Important local customer  ',
      companyId: 'dev-company',
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
