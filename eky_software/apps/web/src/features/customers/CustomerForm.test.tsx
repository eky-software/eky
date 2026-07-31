import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerForm } from './CustomerForm.js';
import {
  initialCustomerForm,
  toCustomerForm,
} from './customerFormModel.js';

describe('CustomerForm', () => {
  it('uses the same complete controlled field set for a new company', () => {
    const html = renderForm('create');

    expect(html).toContain('Lisää asiakas');
    expect(html).toContain('value="company" selected=""');
    expect(html).toContain('name="customerName"');
    expect(html).toContain('name="businessId"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="streetAddress"');
    expect(html).toContain('name="hourlyRateOverrideEuro"');
    expect(html).toContain('name="comment"');
    expect(html).not.toContain('Täytä testiasiakas');
  });

  it('hydrates the same fields for editing without a parallel form', () => {
    const html = renderToStaticMarkup(
      <CustomerForm
        errorMessage={null}
        form={toCustomerForm(createCustomer())}
        isSaving={false}
        mode="edit"
        onCancel={() => undefined}
        onFieldChange={() => undefined}
        onSubmit={() => undefined}
        propertyManagers={[]}
      />,
    );

    expect(html).toContain('Muokkaa asiakasta');
    expect(html).toContain('value="1001"');
    expect(html).toContain('value="Uusi Yritys Oy"');
    expect(html).toContain('value="75,00"');
    expect(html).toContain('Takaisin asiakaskortille');
  });
});

function renderForm(mode: 'create' | 'edit'): string {
  return renderToStaticMarkup(
    <CustomerForm
      errorMessage={null}
      form={initialCustomerForm}
      isSaving={false}
      mode={mode}
      onCancel={() => undefined}
      onFieldChange={() => undefined}
      onSubmit={() => undefined}
      propertyManagers={[]}
    />,
  );
}

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Turku',
    comment: 'Uusi yritysasiakas',
    companyId: 'company-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'yritys@example.fi',
    hourlyRateOverrideCents: 7500,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Uusi Yritys Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Kotikatu 1',
    updatedAt: '2026-07-31T10:00:00.000Z',
  };
}
