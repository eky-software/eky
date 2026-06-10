import { describe, expect, it } from 'vitest';

import type { Customer } from '@eky/api-client';

import {
  initialCustomerForm,
  toCreateCustomerRequest,
  toCustomerForm,
  toUpdateCustomerRequest,
} from './customerFormModel.js';

describe('customerFormModel', () => {
  it('maps customer hourly rate override cents to euro input', () => {
    expect(toCustomerForm(createTestCustomer({ hourlyRateOverrideCents: 6550 }))).toMatchObject({
      hourlyRateOverrideEuro: '65,50',
    });
  });

  it('maps missing customer hourly rate override to empty euro input', () => {
    expect(toCustomerForm(createTestCustomer({ hourlyRateOverrideCents: null }))).toMatchObject({
      hourlyRateOverrideEuro: '',
    });
  });

  it('maps create form euro input to hourly rate override cents', () => {
    expect(
      toCreateCustomerRequest({
        ...initialCustomerForm,
        hourlyRateOverrideEuro: '72,50',
        name: 'Example Customer Oy',
      }),
    ).toMatchObject({
      hourlyRateOverrideCents: 7250,
    });
  });

  it('maps empty update form hourly rate override to null cents', () => {
    expect(
      toUpdateCustomerRequest({
        ...initialCustomerForm,
        customerNumber: '1001',
        hourlyRateOverrideEuro: '',
        name: 'Example Customer Oy',
      }),
    ).toMatchObject({
      hourlyRateOverrideCents: null,
    });
  });

  it('rejects invalid hourly rate input', () => {
    expect(() =>
      toCreateCustomerRequest({
        ...initialCustomerForm,
        hourlyRateOverrideEuro: '72,555',
        name: 'Example Customer Oy',
      }),
    ).toThrow('Invalid hourly rate.');
  });
});

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
