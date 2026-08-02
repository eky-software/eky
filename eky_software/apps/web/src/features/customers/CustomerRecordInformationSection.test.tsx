import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerRecordInformationSection } from './CustomerRecordInformationSection.js';

describe('CustomerRecordInformationSection', () => {
  it('renders the customer record timestamps as read-only information', () => {
    const html = renderToStaticMarkup(
      <CustomerRecordInformationSection customer={createCustomer()} />,
    );

    expect(html).toContain('Tietueen tiedot');
    expect(html).toContain('Luotu');
    expect(html).toContain('Päivitetty');
    expect(html).toContain('30.7.2026');
    expect(html).toContain('31.7.2026');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });
});

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'customer@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Kotikatu 1',
    updatedAt: '2026-07-31T10:00:00.000Z',
  };
}
