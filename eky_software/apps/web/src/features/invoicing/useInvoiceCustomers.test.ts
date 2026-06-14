import { EkyApiError, type Customer } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getInvoiceCustomerErrorMessage,
  loadInvoiceCustomers,
} from './useInvoiceCustomers.js';
import { uiText } from '../../i18n/fi.js';

describe('loadInvoiceCustomers', () => {
  it('loads customers through the API client contract', async () => {
    const customers = [createCustomer()];
    const listCustomers = vi.fn().mockResolvedValue(customers);

    await expect(loadInvoiceCustomers({ listCustomers })).resolves.toEqual(
      customers,
    );
    expect(listCustomers).toHaveBeenCalledOnce();
  });
});

describe('getInvoiceCustomerErrorMessage', () => {
  it('translates a known safe API error into Finnish', () => {
    const error = new EkyApiError('Invalid customers response.', {
      responseBody: { internal: 'not rendered' },
      status: 200,
    });

    expect(getInvoiceCustomerErrorMessage(error)).toBe(
      uiText.apiErrors['Invalid customers response.'],
    );
  });

  it('uses a generic Finnish message for unknown API errors', () => {
    const error = new EkyApiError('Unexpected internal service detail.', {
      responseBody: { internal: 'not rendered' },
      status: 500,
    });

    expect(getInvoiceCustomerErrorMessage(error)).toBe(
      uiText.invoicing.customerLoadError,
    );
  });

  it('uses a generic Finnish message for unexpected errors', () => {
    expect(
      getInvoiceCustomerErrorMessage(new Error('Technical stack detail.')),
    ).toBe(uiText.invoicing.customerLoadError);
  });
});

function createCustomer(): Customer {
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
  };
}
