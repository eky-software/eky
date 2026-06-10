import { describe, expect, it } from 'vitest';

import type { Customer } from '@eky/api-client';

import { groupCustomersForList } from './customerListGrouping.js';

describe('groupCustomersForList', () => {
  it('groups managed housing companies under their property manager', () => {
    const propertyManager = createTestCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Koivupuisto Isännöinti Oy',
    });
    const housingCompany = createTestCustomer({
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Sininen Kulma',
    });

    const groups = groupCustomersForList([propertyManager, housingCompany], 'all');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.customer).toEqual(propertyManager);
    expect(groups[0]?.managedHousingCompanies).toEqual([housingCompany]);
  });

  it('keeps housing companies without a property manager as standalone customers', () => {
    const housingCompany = createTestCustomer({
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: '',
      name: 'Asunto Oy Itsenäinen',
    });

    const groups = groupCustomersForList([housingCompany], 'all');

    expect(groups).toEqual([
      {
        customer: housingCompany,
        managedHousingCompanies: [],
      },
    ]);
  });

  it('does not show managed housing companies as detached top-level customers in all view', () => {
    const propertyManager = createTestCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Koivupuisto Isännöinti Oy',
    });
    const housingCompany = createTestCustomer({
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Sininen Kulma',
    });
    const company = createTestCustomer({
      customerType: 'company',
      id: 'company-1',
      name: 'Satamapiha Rakennus Oy',
    });

    const groups = groupCustomersForList([housingCompany, company, propertyManager], 'all');

    expect(groups.map((group) => group.customer.id)).toEqual(['company-1', 'property-manager-1']);
    expect(groups.find((group) => group.customer.id === 'housing-company-1')).toBeUndefined();
    expect(groups.find((group) => group.customer.id === 'property-manager-1')?.managedHousingCompanies).toEqual([
      housingCompany,
    ]);
  });

  it('filters customers by customer type', () => {
    const company = createTestCustomer({
      customerType: 'company',
      id: 'company-1',
      name: 'Satamapiha Rakennus Oy',
    });
    const privatePerson = createTestCustomer({
      customerType: 'privatePerson',
      id: 'private-person-1',
      name: 'Matti Mallikas',
    });

    const groups = groupCustomersForList([privatePerson, company], 'company');

    expect(groups).toEqual([
      {
        customer: company,
        managedHousingCompanies: [],
      },
    ]);
  });

  it('keeps customers grouped after the input list has already been searched and sorted', () => {
    const propertyManager = createTestCustomer({
      customerNumber: '1002',
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Koivupuisto Isännöinti Oy',
    });
    const housingCompany = createTestCustomer({
      customerNumber: '1001',
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Sininen Kulma',
    });

    const groups = groupCustomersForList([housingCompany, propertyManager], 'all');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.customer).toEqual(propertyManager);
    expect(groups[0]?.managedHousingCompanies).toEqual([housingCompany]);
  });
});

function createTestCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1001',
    name: 'Example Customer Oy',
    customerType: 'company',
    businessId: '1234567-8',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'customer@example.fi',
    managedByCustomerId: '',
    phone: '040 123 4567',
    comment: 'Test customer',
    hourlyRateOverrideCents: null,
    status: 'active',
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}
