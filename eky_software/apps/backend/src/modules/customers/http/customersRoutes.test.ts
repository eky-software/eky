import { describe, expect, it } from 'vitest';

import type { CreateCustomerInput } from '../application/createCustomer.js';
import type { ListCustomersInput } from '../application/listCustomers.js';
import type { Customer } from '../domain/customer.js';
import { CustomerValidationError } from '../domain/customerRules.js';
import { createCustomersRoutes } from './customersRoutes.js';

describe('customersRoutes', () => {
  it('lists customers through the route dependencies', async () => {
    const customers: Customer[] = [
      {
        id: 'customer-1',
        companyId: 'dev-company',
        name: 'Example Customer Oy',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ];
    let listInput: ListCustomersInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(): Promise<Customer> {
        throw new Error('createCustomer should not be called');
      },
      async listCustomers(input): Promise<Customer[]> {
        listInput = input;

        return customers;
      },
    });

    const response = await app.request('/customers');
    const body = (await response.json()) as { customers: Customer[] };

    expect(response.status).toBe(200);
    expect(listInput).toEqual({ companyId: 'dev-company' });
    expect(body).toEqual({ customers });
  });

  it('creates a customer through the route dependencies', async () => {
    const createdCustomer: Customer = {
      id: 'customer-1',
      companyId: 'dev-company',
      name: 'Example Customer Oy',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    };
    let createInput: CreateCustomerInput | undefined;
    const app = createCustomersRoutes({
      async createCustomer(input): Promise<Customer> {
        createInput = input;

        return createdCustomer;
      },
      async listCustomers(): Promise<Customer[]> {
        throw new Error('listCustomers should not be called');
      },
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({ name: '  Example Customer Oy  ' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { customer: Customer };

    expect(response.status).toBe(201);
    expect(createInput).toEqual({
      companyId: 'dev-company',
      name: '  Example Customer Oy  ',
    });
    expect(body).toEqual({ customer: createdCustomer });
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
    });

    const response = await app.request('/customers', {
      body: JSON.stringify({ name: '   ' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Customer name is required.' });
  });
});
