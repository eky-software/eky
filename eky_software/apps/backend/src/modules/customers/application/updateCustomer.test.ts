import { describe, expect, it } from 'vitest';

import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';
import { updateCustomer } from './updateCustomer.js';

class FakeCustomerRepository implements CustomerRepository {
  updatedCustomer: Customer | undefined;

  constructor(private readonly existingCustomer: Customer | undefined) {}

  async create(customer: Customer): Promise<Customer> {
    return customer;
  }

  async findById(): Promise<Customer | undefined> {
    return this.existingCustomer;
  }

  async getNextCustomerNumber(): Promise<string> {
    throw new Error('getNextCustomerNumber should not be called');
  }

  async listByCompanyId(): Promise<Customer[]> {
    return [];
  }

  async update(customer: Customer): Promise<Customer> {
    this.updatedCustomer = customer;

    return customer;
  }
}

describe('updateCustomer', () => {
  it('updates a customer through the CustomerRepository port', async () => {
    const repository = new FakeCustomerRepository(createTestCustomer());

    const customer = await updateCustomer(
      {
        businessId: '  7654321-0  ',
        city: '  Espoo  ',
        comment: '  Updated customer  ',
        companyId: 'dev-company',
        customerNumber: '  2001  ',
        customerType: 'housingCompany',
        email: '  updated@example.fi  ',
        hourlyRateOverrideCents: 7200,
        id: 'customer-1',
        managedByCustomerId: '',
        name: '  Updated Customer Oy  ',
        phone: '  050 123 4567  ',
        postalCode: '  02100  ',
        status: 'inactive',
        streetAddress: '  Updated street 1  ',
      },
      repository,
    );

    expect(repository.updatedCustomer).toBe(customer);
    expect(customer.id).toBe('customer-1');
    expect(customer.companyId).toBe('dev-company');
    expect(customer.customerNumber).toBe('2001');
    expect(customer.name).toBe('Updated Customer Oy');
    expect(customer.customerType).toBe('housingCompany');
    expect(customer.managedByCustomerId).toBe('');
    expect(customer.businessId).toBe('7654321-0');
    expect(customer.streetAddress).toBe('Updated street 1');
    expect(customer.postalCode).toBe('02100');
    expect(customer.city).toBe('Espoo');
    expect(customer.email).toBe('updated@example.fi');
    expect(customer.phone).toBe('050 123 4567');
    expect(customer.comment).toBe('Updated customer');
    expect(customer.hourlyRateOverrideCents).toBe(7200);
    expect(customer.status).toBe('inactive');
    expect(customer.createdAt).toBe('2026-05-21T00:00:00.000Z');
    expect(customer.updatedAt).toEqual(expect.any(String));
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
    hourlyRateOverrideCents: null,
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}
