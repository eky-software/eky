import type { Customer } from '@eky/api-client';

export interface CustomerListGroup {
  customer: Customer;
  managedHousingCompanies: Customer[];
}

export type CustomerListFilter = 'all' | Customer['customerType'];

export function groupCustomersForList(
  customers: Customer[],
  filter: CustomerListFilter,
): CustomerListGroup[] {
  const propertyManagerIds = new Set(
    customers
      .filter((customer) => customer.customerType === 'propertyManager')
      .map((customer) => customer.id),
  );
  const managedHousingCompaniesByPropertyManager = new Map<string, Customer[]>();

  for (const customer of customers) {
    if (
      customer.customerType !== 'housingCompany' ||
      !propertyManagerIds.has(customer.managedByCustomerId)
    ) {
      continue;
    }

    const currentHousingCompanies =
      managedHousingCompaniesByPropertyManager.get(customer.managedByCustomerId) ?? [];

    currentHousingCompanies.push(customer);
    managedHousingCompaniesByPropertyManager.set(
      customer.managedByCustomerId,
      currentHousingCompanies,
    );
  }

  if (filter !== 'all' && filter !== 'propertyManager') {
    return customers
      .filter((customer) => customer.customerType === filter)
      .map((customer) => ({
        customer,
        managedHousingCompanies: [],
      }));
  }

  if (filter === 'propertyManager') {
    return customers
      .filter((customer) => customer.customerType === 'propertyManager')
      .map((customer) => ({
        customer,
        managedHousingCompanies: managedHousingCompaniesByPropertyManager.get(customer.id) ?? [],
      }));
  }

  return customers
    .filter((customer) => !isManagedHousingCompany(customer, propertyManagerIds))
    .map((customer) => ({
      customer,
      managedHousingCompanies: managedHousingCompaniesByPropertyManager.get(customer.id) ?? [],
    }));
}

function isManagedHousingCompany(customer: Customer, propertyManagerIds: Set<string>): boolean {
  return (
    customer.customerType === 'housingCompany' &&
    propertyManagerIds.has(customer.managedByCustomerId)
  );
}
