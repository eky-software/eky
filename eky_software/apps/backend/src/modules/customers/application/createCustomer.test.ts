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
        businessId: '  1234567-8  ',
        city: '  Helsinki  ',
        comment: '  Important local customer  ',
        companyId: 'dev-company',
        customerNumber: '  1001  ',
        customerType: 'company',
        email: '  customer@example.fi  ',
        name: '  Example Customer Oy  ',
        phone: '  040 123 4567  ',
        postalCode: '  00100  ',
        status: 'active',
        streetAddress: '  Testikatu 1  ',
      },
      repository,
    );

    expect(repository.createdCustomer).toBe(customer);
    expect(customer.id).toEqual(expect.any(String));
    expect(customer.companyId).toBe('dev-company');
    expect(customer.customerNumber).toBe('1001');
    expect(customer.name).toBe('Example Customer Oy');
    expect(customer.customerType).toBe('company');
    expect(customer.businessId).toBe('1234567-8');
    expect(customer.streetAddress).toBe('Testikatu 1');
    expect(customer.postalCode).toBe('00100');
    expect(customer.city).toBe('Helsinki');
    expect(customer.email).toBe('customer@example.fi');
    expect(customer.phone).toBe('040 123 4567');
    expect(customer.comment).toBe('Important local customer');
    expect(customer.status).toBe('active');
    expect(customer.createdAt).toEqual(expect.any(String));
    expect(customer.updatedAt).toEqual(expect.any(String));
    expect(customer.createdAt).toBe(customer.updatedAt);
  });
});
