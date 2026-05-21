import { describe, expect, it } from 'vitest';

import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';
import { createCustomer } from './createCustomer.js';

class FakeCustomerRepository implements CustomerRepository {
  createdCustomer: Customer | undefined;

  async create(customer: Customer): Promise<Customer> {
    this.createdCustomer = customer;

    return customer;
  }

  async listByCompanyId(): Promise<Customer[]> {
    return [];
  }
}

describe('createCustomer', () => {
  it('creates a customer through the CustomerRepository port', async () => {
    const repository = new FakeCustomerRepository();

    const customer = await createCustomer(
      {
        companyId: 'dev-company',
        name: '  Example Customer Oy  ',
      },
      repository,
    );

    expect(repository.createdCustomer).toBe(customer);
    expect(customer.id).toEqual(expect.any(String));
    expect(customer.companyId).toBe('dev-company');
    expect(customer.name).toBe('Example Customer Oy');
    expect(customer.createdAt).toEqual(expect.any(String));
    expect(customer.updatedAt).toEqual(expect.any(String));
    expect(customer.createdAt).toBe(customer.updatedAt);
  });
});
