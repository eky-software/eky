import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ManagedHousingCompaniesSection } from './ManagedHousingCompaniesSection.js';

describe('ManagedHousingCompaniesSection', () => {
  it('renders relationship identity, city, status and an accessible open action', () => {
    const html = renderToStaticMarkup(
      <ManagedHousingCompaniesSection
        housingCompanies={[
          createCustomer({
            city: 'Turku',
            customerNumber: '1004',
            name: 'Asunto Oy Sininen Kulma',
          }),
        ]}
        onOpenCustomer={vi.fn()}
      />,
    );

    expect(html).toContain('Hallinnoidut taloyhtiöt');
    expect(html).toContain('1004');
    expect(html).toContain('Asunto Oy Sininen Kulma');
    expect(html).toContain('Turku');
    expect(html).toContain('Aktiivinen');
    expect(html).toContain(
      'aria-label="Avaa asiakaskortti Asunto Oy Sininen Kulma"',
    );
  });

  it('renders a bounded empty state', () => {
    const html = renderToStaticMarkup(
      <ManagedHousingCompaniesSection
        housingCompanies={[]}
        onOpenCustomer={vi.fn()}
      />,
    );

    expect(html).toContain('Ei taloyhtiöitä');
    expect(html).not.toContain('>Avaa</button>');
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: '1234567-8',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-01T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'housingCompany',
    email: 'asiakas@example.fi',
    hourlyRateOverrideCents: null,
    id: 'housing-company-1',
    managedByCustomerId: 'property-manager-1',
    name: 'Asunto Oy Esimerkki',
    phone: '040 123 4567',
    postalCode: '20100',
    status: 'active',
    streetAddress: 'Kotikatu 1',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}
