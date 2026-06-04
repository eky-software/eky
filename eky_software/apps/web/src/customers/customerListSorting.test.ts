import { describe, expect, it } from 'vitest';

import type { Customer } from '@eky/api-client';

import { sortCustomers, type CustomerSortState } from './customerListSorting.js';

describe('sortCustomers', () => {
  it('sorts customers by name from A to Ö', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ id: 'customer-3', name: 'Öljymäki Oy' }),
        createTestCustomer({ id: 'customer-1', name: 'Aalto Oy' }),
        createTestCustomer({ id: 'customer-2', name: 'Koivupuisto Oy' }),
      ],
      createSortState('name', 'asc'),
    );

    expect(sortedCustomers.map((customer) => customer.name)).toEqual([
      'Aalto Oy',
      'Koivupuisto Oy',
      'Öljymäki Oy',
    ]);
  });

  it('sorts customers by name from Ö to A', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ id: 'customer-1', name: 'Aalto Oy' }),
        createTestCustomer({ id: 'customer-2', name: 'Koivupuisto Oy' }),
        createTestCustomer({ id: 'customer-3', name: 'Öljymäki Oy' }),
      ],
      createSortState('name', 'desc'),
    );

    expect(sortedCustomers.map((customer) => customer.name)).toEqual([
      'Öljymäki Oy',
      'Koivupuisto Oy',
      'Aalto Oy',
    ]);
  });

  it('sorts customer numbers using numeric collation', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ customerNumber: '10010', id: 'customer-3', name: 'C Oy' }),
        createTestCustomer({ customerNumber: '1002', id: 'customer-2', name: 'B Oy' }),
        createTestCustomer({ customerNumber: '1001', id: 'customer-1', name: 'A Oy' }),
      ],
      createSortState('customerNumber', 'asc'),
    );

    expect(sortedCustomers.map((customer) => customer.customerNumber)).toEqual([
      '1001',
      '1002',
      '10010',
    ]);
  });

  it('sorts active customers before inactive customers with status ascending', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ id: 'customer-1', name: 'Inactive Oy', status: 'inactive' }),
        createTestCustomer({ id: 'customer-2', name: 'Active Oy', status: 'active' }),
      ],
      createSortState('status', 'asc'),
    );

    expect(sortedCustomers.map((customer) => customer.status)).toEqual(['active', 'inactive']);
  });

  it('sorts inactive customers before active customers with status descending', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ id: 'customer-1', name: 'Active Oy', status: 'active' }),
        createTestCustomer({ id: 'customer-2', name: 'Inactive Oy', status: 'inactive' }),
      ],
      createSortState('status', 'desc'),
    );

    expect(sortedCustomers.map((customer) => customer.status)).toEqual(['inactive', 'active']);
  });

  it('uses name as the tie breaker when sort values are equal', () => {
    const sortedCustomers = sortCustomers(
      [
        createTestCustomer({ city: 'Lahti', id: 'customer-2', name: 'Bulevardi Oy' }),
        createTestCustomer({ city: 'Lahti', id: 'customer-1', name: 'Asemakatu Oy' }),
      ],
      createSortState('city', 'asc'),
    );

    expect(sortedCustomers.map((customer) => customer.name)).toEqual([
      'Asemakatu Oy',
      'Bulevardi Oy',
    ]);
  });
});

function createSortState(
  key: CustomerSortState['key'],
  direction: CustomerSortState['direction'],
): CustomerSortState {
  return { direction, key };
}

function createTestCustomer(overrides: Partial<Customer> = {}): Customer {
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
    comment: 'Test customer',
    hourlyRateOverrideCents: null,
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}
