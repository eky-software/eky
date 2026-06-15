import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomerPicker,
  formatCustomerOption,
} from './CustomerPicker.js';
import { uiText } from '../../../i18n/fi.js';

describe('CustomerPicker', () => {
  it('renders customers returned by the API client layer', () => {
    const html = renderPicker({
      customers: [
        createCustomer(),
        createCustomer({
          id: 'customer-2',
          customerNumber: '1002',
          name: 'Passiivinen Asiakas Oy',
          status: 'inactive',
        }),
      ],
      errorMessage: null,
      isLoading: false,
    });

    expect(html).toContain('1001');
    expect(html).toContain('Esimerkki Asiakas Oy');
    expect(html).toContain('Passiivinen Asiakas Oy');
    expect(html).toContain(uiText.invoicing.customerInactive);
    expect(html).not.toContain('disabled=""');
  });

  it('renders a disabled empty state when there are no customers', () => {
    const html = renderPicker({
      customers: [],
      errorMessage: null,
      isLoading: false,
    });

    expect(html).toContain(uiText.invoicing.customerEmpty);
    expect(html).toContain(uiText.invoicing.customerEmptyHelp);
    expect(html).toContain('disabled=""');
  });

  it('renders a disabled loading state', () => {
    const html = renderPicker({
      customers: [],
      errorMessage: null,
      isLoading: true,
    });

    expect(html).toContain(uiText.invoicing.customerLoading);
    expect(html).toContain('disabled=""');
  });

  it('renders a safe error without technical response data', () => {
    const html = renderPicker({
      customers: [],
      errorMessage: uiText.invoicing.customerLoadError,
      isLoading: false,
    });

    expect(html).toContain(uiText.invoicing.customerLoadError);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

describe('formatCustomerOption', () => {
  it('uses the customer number and name in the option label', () => {
    expect(formatCustomerOption(createCustomer())).toBe(
      '1001 – Esimerkki Asiakas Oy',
    );
  });
});

function renderPicker(
  props: Partial<React.ComponentProps<typeof CustomerPicker>>,
): string {
  return renderToStaticMarkup(
    <CustomerPicker
      customers={[]}
      errorMessage={null}
      isLoading={false}
      onChange={vi.fn()}
      validationErrorMessage={undefined}
      value=""
      {...props}
    />,
  );
}

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
