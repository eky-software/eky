import { describe, expect, it } from 'vitest';

import type { Customer } from '@eky/api-client';

import {
  applyCustomerBillingRecipientDefault,
  getSuggestedBillingRecipientCustomerId,
} from './invoiceBillingRecipientDefaults.js';
import { createInitialNewInvoiceForm } from './newInvoiceFormState.js';

describe('invoiceBillingRecipientDefaults', () => {
  it('suggests the property manager for a managed housing company', () => {
    expect(
      getSuggestedBillingRecipientCustomerId('housing-1', createCustomers()),
    ).toBe('manager-1');
  });

  it('does not suggest a billing recipient for other customer types', () => {
    expect(
      getSuggestedBillingRecipientCustomerId('company-1', createCustomers()),
    ).toBe('');
  });

  it('does not suggest a missing property manager', () => {
    expect(
      getSuggestedBillingRecipientCustomerId('housing-2', createCustomers()),
    ).toBe('');
  });

  it('updates the selected customer and billing recipient together', () => {
    const form = {
      ...createInitialNewInvoiceForm(new Date('2026-07-02T00:00:00.000Z')),
      billingRecipientCustomerId: 'manual-recipient',
      customerId: 'company-1',
    };

    expect(
      applyCustomerBillingRecipientDefault(
        form,
        createCustomers(),
        'housing-1',
      ),
    ).toMatchObject({
      billingRecipientCustomerId: 'manager-1',
      customerId: 'housing-1',
    });
  });
});

function createCustomers(): Customer[] {
  return [
    createCustomer({
      id: 'manager-1',
      customerNumber: '2001',
      customerType: 'propertyManager',
      name: 'Isännöinti Oy',
    }),
    createCustomer({
      id: 'housing-1',
      customerNumber: '3001',
      customerType: 'housingCompany',
      managedByCustomerId: 'manager-1',
      name: 'Asunto Oy Testitalo',
    }),
    createCustomer({
      id: 'housing-2',
      customerNumber: '3002',
      customerType: 'housingCompany',
      managedByCustomerId: 'missing-manager',
      name: 'Asunto Oy Ilman Isännöitsijää',
    }),
    createCustomer({
      id: 'company-1',
      customerNumber: '1001',
      customerType: 'company',
      name: 'Rakennus Oy',
    }),
  ];
}

function createCustomer(overrides: Partial<Customer>): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1000',
    name: 'Asiakas Oy',
    customerType: 'company',
    businessId: '',
    streetAddress: '',
    postalCode: '',
    city: '',
    email: '',
    managedByCustomerId: '',
    phone: '',
    comment: '',
    hourlyRateOverrideCents: null,
    status: 'active',
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}
