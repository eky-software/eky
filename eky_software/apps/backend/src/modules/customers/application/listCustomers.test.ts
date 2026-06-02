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

  async findById(): Promise<Customer | undefined> {
    return undefined;
  }

  async getNextCustomerNumber(): Promise<string> {
    throw new Error('getNextCustomerNumber should not be called');
  }

  async listByCompanyId(companyId: string): Promise<Customer[]> {
    this.requestedCompanyId = companyId;

    return this.customers;
  }

  async update(customer: Customer): Promise<Customer> {
    return customer;
  }
}

describe('listCustomers', () => {
  it('lists customers through the CustomerRepository port by company id', async () => {
    const customers: Customer[] = [
      {
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
        status: 'active',
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
