import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CustomerTable } from './CustomerTable.js';

describe('CustomerTable', () => {
  it('renders a separate accessible disclosure for managed housing companies', () => {
    const propertyManager = createCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Koivupuisto Isännöinti Oy',
    });
    const housingCompany = createCustomer({
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Sininen Kulma',
    });
    const html = renderTable(propertyManager, [housingCompany], true);

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(
      'aria-controls="managed-housing-companies-property-manager-1"',
    );
    expect(html).toContain(
      'aria-label="Sulje taloyhtiöt: 1 hallinnoitu taloyhtiö"',
    );
    expect(html).toContain('1 hallinnoitu taloyhtiö');
    expect(html).toContain('Asunto Oy Sininen Kulma');
    expect(html).toContain('status-pill-active');
    expect(html).not.toMatch(
      /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/,
    );
  });

  it('does not render an active disclosure for an empty relationship', () => {
    const propertyManager = createCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
    });
    const html = renderTable(propertyManager, [], false);

    expect(html).toContain('Ei taloyhtiöitä');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('aria-controls');
  });

  it('keeps the customer name and disclosure as separate controls', () => {
    const propertyManager = createCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
    });
    const housingCompany = createCustomer({
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
    });
    const html = renderTable(propertyManager, [housingCompany], false);

    expect((html.match(/<button/g) ?? [])).toHaveLength(6);
    expect(html.indexOf(propertyManager.name)).toBeLessThan(
      html.indexOf('1 hallinnoitu taloyhtiö'),
    );
  });
});

function renderTable(
  propertyManager: Customer,
  managedHousingCompanies: Customer[],
  isExpanded: boolean,
): string {
  return renderToStaticMarkup(
    <CustomerTable
      customerGroups={[
        {
          customer: propertyManager,
          managedHousingCompanies,
        },
      ]}
      customers={[propertyManager, ...managedHousingCompanies]}
      expandedPropertyManagerIds={
        isExpanded ? new Set([propertyManager.id]) : new Set()
      }
      onCustomerSelect={vi.fn()}
      onPropertyManagerToggle={vi.fn()}
      onSortChange={vi.fn()}
      sortState={{ direction: 'asc', key: 'name' }}
    />,
  );
}

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: '1234567-8',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-01T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'asiakas@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Oy',
    phone: '040 123 4567',
    postalCode: '20100',
    status: 'active',
    streetAddress: 'Kotikatu 1',
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}
