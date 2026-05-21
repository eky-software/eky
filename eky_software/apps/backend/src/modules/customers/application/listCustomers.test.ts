import { describe, expect, it } from 'vitest';

import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';
import { listCustomers } from './listCustomers.js';

class FakeCustomerRepository implements CustomerRepository {
  requestedCompanyId: string | undefined;

  constructor(private readonly customers: Customer[]) {}

  async create(customer: Customer): Promise<Customer> {
    return customer;
  }

  async listByCompanyId(companyId: string): Promise<Customer[]> {
    this.requestedCompanyId = companyId;

    return this.customers;
  }
}

describe('listCustomers', () => {
  it('lists customers through the CustomerRepository port by company id', async () => {
    const customers: Customer[] = [
      {
        id: 'customer-1',
        companyId: 'dev-company',
        name: 'Example Customer Oy',
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ];
    const repository = new FakeCustomerRepository(customers);

    const result = await listCustomers({ companyId: 'dev-company' }, repository);

    expect(repository.requestedCompanyId).toBe('dev-company');
    expect(result).toBe(customers);
  });
});
