import { describe, expect, it } from 'vitest';

import type { Customer } from '../domain/customer.js';
import type { CustomerRepository } from '../ports/customerRepository.js';
import { createCustomer } from './createCustomer.js';

class FakeCustomerRepository implements CustomerRepository {
  createdCustomer: Customer | undefined;
  foundCustomers = new Map<string, Customer>();
  nextCustomerNumber = '2001';

  async create(customer: Customer): Promise<Customer> {
    this.createdCustomer = customer;

    return customer;
  }

  async findById(_companyId: string, id: string): Promise<Customer | undefined> {
    return this.foundCustomers.get(id);
  }

  async listByCompanyId(): Promise<Customer[]> {
    return [];
  }

  async getNextCustomerNumber(): Promise<string> {
    return this.nextCustomerNumber;
  }

  async update(customer: Customer): Promise<Customer> {
    return customer;
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
      },
      repository,
    );

    expect(repository.createdCustomer).toBe(customer);
    expect(customer.id).toEqual(expect.any(String));
    expect(customer.companyId).toBe('dev-company');
    expect(customer.customerNumber).toBe('1001');
    expect(customer.name).toBe('Example Customer Oy');
    expect(customer.customerType).toBe('company');
    expect(customer.managedByCustomerId).toBe('');
    expect(customer.businessId).toBe('1234567-8');
    expect(customer.streetAddress).toBe('Testikatu 1');
    expect(customer.postalCode).toBe('00100');
    expect(customer.city).toBe('Helsinki');
    expect(customer.email).toBe('customer@example.fi');
    expect(customer.phone).toBe('040 123 4567');
    expect(customer.comment).toBe('Important local customer');
    expect(customer.hourlyRateOverrideCents).toBe(6500);
    expect(customer.status).toBe('active');
    expect(customer.createdAt).toEqual(expect.any(String));
    expect(customer.updatedAt).toEqual(expect.any(String));
    expect(customer.createdAt).toBe(customer.updatedAt);
  });

  it('uses the repository port for automatic customer numbers', async () => {
    const repository = new FakeCustomerRepository();

    const customer = await createCustomer(
      {
        businessId: '',
        city: '',
        comment: '',
        companyId: 'dev-company',
        customerNumberMode: 'auto',
        customerType: 'company',
        email: '',
        hourlyRateOverrideCents: null,
        managedByCustomerId: '',
        name: 'Example Customer Oy',
        phone: '',
        postalCode: '',
        status: 'active',
        streetAddress: '',
      },
      repository,
    );

    expect(customer.customerNumber).toBe('2001');
  });

  it('allows a housing company to reference a property manager customer', async () => {
    const repository = new FakeCustomerRepository();
    repository.foundCustomers.set('property-manager-1', {
      id: 'property-manager-1',
      companyId: 'dev-company',
      customerNumber: '1001',
      name: 'Example Isännöinti Oy',
      customerType: 'propertyManager',
      businessId: '',
      streetAddress: '',
      postalCode: '',
      city: '',
      email: '',
      hourlyRateOverrideCents: null,
      managedByCustomerId: '',
      phone: '',
      comment: '',
      status: 'active',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });

    const customer = await createCustomer(
      {
        businessId: '',
        city: '',
        comment: '',
        companyId: 'dev-company',
        customerNumberMode: 'auto',
        customerType: 'housingCompany',
        email: '',
        hourlyRateOverrideCents: null,
        managedByCustomerId: 'property-manager-1',
        name: 'Example Asunto Oy',
        phone: '',
        postalCode: '',
        status: 'active',
        streetAddress: '',
      },
      repository,
    );

    expect(customer.customerType).toBe('housingCompany');
    expect(customer.managedByCustomerId).toBe('property-manager-1');
  });
});
