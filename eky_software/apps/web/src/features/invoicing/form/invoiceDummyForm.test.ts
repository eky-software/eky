import { describe, expect, it } from 'vitest';

import type { CompanySettings, Customer } from '@eky/api-client';

import { createDummyInvoiceForm } from './invoiceDummyForm.js';

describe('invoiceDummyForm', () => {
  it('creates a test invoice with an active customer and company hourly rate', () => {
    const form = createDummyInvoiceForm(
      [createCustomer({ id: 'customer-1' })],
      createCompanySettings(),
      createPaymentSettings(),
      new Date('2026-07-02T00:00:00.000Z'),
    );

    expect(form).toMatchObject({
      customerId: 'customer-1',
      dueDate: '2026-07-16',
      invoiceDate: '2026-07-02',
      latePaymentInterestPercent: '9,50',
      reminderPeriodDays: '8',
      subject: 'Testilasku',
    });
    expect(form.lines[0]).toMatchObject({
      description: 'työ',
      unit: 'h',
      unitPrice: '65,00',
      vatRateBasisPoints: 2550,
    });
  });

  it('uses the customer hourly rate override when it exists', () => {
    const form = createDummyInvoiceForm(
      [createCustomer({ hourlyRateOverrideCents: 8500 })],
      createCompanySettings(),
    );

    expect(form.lines[0]?.unitPrice).toBe('85,00');
  });

  it('suggests the property manager as billing recipient for a housing company', () => {
    const form = createDummyInvoiceForm(
      [
        createCustomer({
          id: 'housing-1',
          customerType: 'housingCompany',
          managedByCustomerId: 'manager-1',
        }),
        createCustomer({
          id: 'manager-1',
          customerType: 'propertyManager',
        }),
      ],
      createCompanySettings(),
    );

    expect(form.customerId).toBe('housing-1');
    expect(form.billingRecipientCustomerId).toBe('manager-1');
  });

  it('can create a test invoice shell without customers', () => {
    const form = createDummyInvoiceForm([], null);

    expect(form.customerId).toBe('');
    expect(form.lines[0]?.unitPrice).toBe('65,00');
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1001',
    name: 'Testiasiakas Oy',
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

function createCompanySettings(): CompanySettings {
  return {
    id: 'settings-1',
    companyId: 'dev-company',
    companyName: 'Oma yritys Oy',
    businessId: '1234567-8',
    vatNumber: 'FI12345678',
    streetAddress: '',
    postalCode: '',
    city: '',
    email: '',
    website: '',
    phone: '',
    iban: '',
    bic: '',
    bankName: '',
    defaultHourlyRateCents: 6500,
    hourlyRateShortcut: 'työ',
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  };
}

function createPaymentSettings() {
  return {
    defaultLatePaymentInterestBasisPoints: 950,
    defaultReminderPeriodDays: 8,
    isPersisted: true,
  };
}
