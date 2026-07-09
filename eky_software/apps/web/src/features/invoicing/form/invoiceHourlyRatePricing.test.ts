import type { CompanySettings, Customer } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { resolveHourlyRateAutofillConfig } from './invoiceHourlyRatePricing.js';

describe('resolveHourlyRateAutofillConfig', () => {
  it('uses the selected customer hourly rate override before the company default', () => {
    expect(
      resolveHourlyRateAutofillConfig(
        'customer-1',
        [createCustomer(7250)],
        createCompanySettings(6500),
      ),
    ).toEqual({ hourlyRateCents: 7250, shortcut: 'työ' });
  });

  it('uses the company default when the customer override is unset', () => {
    expect(
      resolveHourlyRateAutofillConfig(
        'customer-1',
        [createCustomer(null)],
        createCompanySettings(6500),
      ),
    ).toEqual({ hourlyRateCents: 6500, shortcut: 'työ' });
  });

  it('keeps a zero customer override as a real price', () => {
    expect(
      resolveHourlyRateAutofillConfig(
        'customer-1',
        [createCustomer(0)],
        createCompanySettings(6500),
      ).hourlyRateCents,
    ).toBe(0);
  });

  it('does not suggest the company default before a customer is selected', () => {
    expect(
      resolveHourlyRateAutofillConfig(
        '',
        [createCustomer(null)],
        createCompanySettings(6500),
      ),
    ).toEqual({ hourlyRateCents: null, shortcut: 'työ' });
  });
});

function createCustomer(hourlyRateOverrideCents: number | null): Customer {
  return {
    businessId: '',
    city: '',
    comment: '',
    companyId: 'dev-company',
    createdAt: '2026-06-25T00:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: '',
    hourlyRateOverrideCents,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Example Customer Oy',
    phone: '',
    postalCode: '',
    status: 'active',
    streetAddress: '',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };
}

function createCompanySettings(
  defaultHourlyRateCents: number | null,
): CompanySettings {
  return {
    businessId: '',
    city: '',
    companyId: 'dev-company',
    companyName: 'Example Builder Oy',
    createdAt: '2026-06-25T00:00:00.000Z',
    defaultHourlyRateCents,
    email: '',
    emailDeliveryProvider: 'dryRun',
    emailSenderName: '',
    emailSenderAddress: '',
    emailSmtpHost: '',
    emailSmtpPort: null,
    emailSmtpSecurity: 'starttls',
    emailUsername: '',
    emailTestRecipientOverride: '',
    emailSecretConfigured: false,
    website: '',
    hourlyRateShortcut: 'työ',
    vatNumber: '',
    iban: '',
    bic: '',
    bankName: '',
    id: 'settings-1',
    phone: '',
    postalCode: '',
    streetAddress: '',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };
}
