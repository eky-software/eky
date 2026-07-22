import type { CompanySettings, Customer } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import { applyInvoiceCustomerSelection } from './invoiceCustomerDefaults.js';
import { createInitialNewInvoiceForm } from './newInvoiceFormState.js';

describe('applyInvoiceCustomerSelection', () => {
  it('defaults private persons to gross and companies to net prices', () => {
    const customers = [
      createCustomer('private', 'privatePerson', 7200),
      createCustomer('company', 'company', 6800),
    ];
    const form = createInitialNewInvoiceForm();

    const privateForm = applyInvoiceCustomerSelection(
      form,
      customers,
      createCompanySettings(),
      'private',
      true,
    );
    const companyForm = applyInvoiceCustomerSelection(
      privateForm,
      customers,
      createCompanySettings(),
      'company',
      true,
    );

    expect(privateForm.priceInputMode).toBe('gross');
    expect(companyForm.priceInputMode).toBe('net');
  });

  it('preserves a manually selected price mode', () => {
    const form = { ...createInitialNewInvoiceForm(), priceInputMode: 'gross' as const };

    expect(
      applyInvoiceCustomerSelection(
        form,
        [createCustomer('company', 'company', 6800)],
        createCompanySettings(),
        'company',
        false,
      ).priceInputMode,
    ).toBe('gross');
  });

  it('updates only an automatically applied hourly rate when customer changes', () => {
    const customers = [
      createCustomer('customer-1', 'company', 6500),
      createCustomer('customer-2', 'company', 7900),
    ];
    const form = {
      ...createInitialNewInvoiceForm(),
      lines: [
        {
          ...createInitialNewInvoiceForm().lines[0]!,
          description: 'työ',
          hourlyRateAutofillState: 'applied' as const,
          quantity: '1',
          unitPrice: '65,00',
        },
        {
          ...createInitialNewInvoiceForm().lines[0]!,
          id: 'manual-row',
          description: 'työ',
          hourlyRateAutofillState: 'blocked' as const,
          unitPrice: '99,00',
        },
      ],
    };

    const updated = applyInvoiceCustomerSelection(
      form,
      customers,
      createCompanySettings(),
      'customer-2',
      true,
    );

    expect(updated.lines.map((line) => line.unitPrice)).toEqual(['79,00', '99,00']);
    expect(updated.lines[0]?.quantity).toBe('1');
  });
});

function createCustomer(
  id: string,
  customerType: Customer['customerType'],
  hourlyRateOverrideCents: number | null,
): Customer {
  return {
    id,
    companyId: 'company-1',
    customerNumber: id,
    name: id,
    customerType,
    businessId: '',
    streetAddress: '',
    postalCode: '',
    city: '',
    email: '',
    managedByCustomerId: '',
    phone: '',
    comment: '',
    hourlyRateOverrideCents,
    status: 'active',
    createdAt: '2026-07-22T18:00:00.000Z',
    updatedAt: '2026-07-22T18:00:00.000Z',
  };
}

function createCompanySettings(): CompanySettings {
  return {
    id: 'settings-1', companyId: 'company-1', companyName: '', businessId: '',
    vatNumber: '', streetAddress: '', postalCode: '', city: '', email: '', phone: '',
    website: '', emailDeliveryProvider: 'dryRun', emailSenderName: '',
    emailSenderAddress: '', emailSmtpHost: '', emailSmtpPort: null,
    emailSmtpSecurity: 'tls', emailUsername: '', emailTestRecipientOverride: '',
    emailSecretConfigured: false, iban: '', bic: '', bankName: '',
    defaultHourlyRateCents: 6000, hourlyRateShortcut: 'työ',
    createdAt: '2026-07-22T18:00:00.000Z', updatedAt: '2026-07-22T18:00:00.000Z',
  };
}
