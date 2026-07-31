import type { Customer } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { resolveActiveInvoiceCustomerId } from './invoicingNavigation.js';

describe('resolveActiveInvoiceCustomerId', () => {
  it.each([
    'company',
    'housingCompany',
    'privatePerson',
    'propertyManager',
  ] as const)('accepts an active %s customer', (customerType) => {
    const customer = createCustomer({ customerType });

    expect(resolveActiveInvoiceCustomerId([customer], customer.id)).toBe(
      customer.id,
    );
  });

  it('rejects an inactive customer', () => {
    const customer = createCustomer({ status: 'inactive' });

    expect(resolveActiveInvoiceCustomerId([customer], customer.id)).toBeNull();
  });

  it('rejects a stale or tenant-excluded customer id', () => {
    expect(
      resolveActiveInvoiceCustomerId(
        [createCustomer({ id: 'current-company-customer' })],
        'foreign-or-stale-customer',
      ),
    ).toBeNull();
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: '',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: '',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Oy',
    phone: '',
    postalCode: '00100',
    status: 'active',
    streetAddress: '',
    updatedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}
