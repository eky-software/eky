import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceBasicInfoSection } from './InvoiceBasicInfoSection.js';
import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceBasicInfoSection', () => {
  it('shows the matching customer details after customer selection', () => {
    const customers = [
      createCustomer(),
      createCustomer({
        id: 'customer-2',
        customerNumber: '1002',
        name: 'Toinen Asiakas Oy',
      }),
    ];
    const form = updateNewInvoiceFormField(
      createInitialNewInvoiceForm(new Date(2026, 5, 15)),
      'customerId',
      'customer-2',
    );
    const html = renderToStaticMarkup(
      <InvoiceBasicInfoSection
        customerListState={{
          customers,
          errorMessage: null,
          isLoading: false,
        }}
        errors={undefined}
        form={form}
        onFieldChange={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.selectedCustomerKicker);
    expect(html).toContain('1002');
    expect(html).toContain('Toinen Asiakas Oy');
    expect(html).not.toContain('Esimerkki Asiakas Oy</h4>');
  });

  it('does not show customer details before a customer is selected', () => {
    const html = renderToStaticMarkup(
      <InvoiceBasicInfoSection
        customerListState={{
          customers: [createCustomer()],
          errorMessage: null,
          isLoading: false,
        }}
        errors={undefined}
        form={createInitialNewInvoiceForm(new Date(2026, 5, 15))}
        onFieldChange={vi.fn()}
      />,
    );

    expect(html).not.toContain(uiText.invoicing.selectedCustomerKicker);
  });

  it('shows safe validation errors for basic invoice fields', () => {
    const html = renderToStaticMarkup(
      <InvoiceBasicInfoSection
        customerListState={{
          customers: [createCustomer()],
          errorMessage: null,
          isLoading: false,
        }}
        errors={{
          customerId: uiText.invoicing.validationCustomerRequired,
          dueDate: uiText.invoicing.validationDueDateRequired,
          invoiceDate: uiText.invoicing.validationInvoiceDateRequired,
          lines: {},
          paymentTermDays: uiText.invoicing.validationPaymentTerm,
        }}
        form={createInitialNewInvoiceForm(new Date(2026, 5, 15))}
        onFieldChange={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.validationCustomerRequired);
    expect(html).toContain(uiText.invoicing.validationInvoiceDateRequired);
    expect(html).toContain(uiText.invoicing.validationDueDateRequired);
    expect(html).toContain(uiText.invoicing.validationPaymentTerm);
    expect(html).not.toContain('stack');
    expect(html).not.toContain('responseBody');
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
