import type { Customer } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { searchCustomers } from './customerListSearch.js';

describe('searchCustomers', () => {
  it('matches customers by street address and postal code', () => {
    const customers = [
      createCustomer(),
      createCustomer({
        id: 'customer-2',
        customerNumber: '2002',
        name: 'Satamapiha Rakennus Oy',
        streetAddress: 'Satamakatu 12',
        postalCode: '20100',
        city: 'Turku',
      }),
    ];

    expect(searchCustomers(customers, 'satamakatu').map((customer) => customer.id)).toEqual([
      'customer-2',
    ]);
    expect(searchCustomers(customers, '20100 turku').map((customer) => customer.id)).toEqual([
      'customer-2',
    ]);
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1001',
    name: 'Esimerkki Asiakas Oy',
    customerType: 'company',
    businessId: '1234567-8',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'testi@example.fi',
    managedByCustomerId: '',
    phone: '040 123 4567',
    comment: '',
    hourlyRateOverrideCents: null,
    status: 'active',
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  };
}
