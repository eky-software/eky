import type { Customer } from '@eky/api-client';

import { getCustomerTypeLabel } from './customerDisplay.js';

export function searchCustomers(customers: Customer[], searchQuery: string): Customer[] {
  const normalizedSearchQuery = normalizeSearchText(searchQuery);

  if (normalizedSearchQuery.length === 0) {
    return customers;
  }

  const directlyMatchingCustomerIds = new Set<string>();
  const includedCustomerIds = new Set<string>();

  for (const customer of customers) {
    if (doesCustomerMatchSearch(customer, normalizedSearchQuery)) {
      directlyMatchingCustomerIds.add(customer.id);
      includedCustomerIds.add(customer.id);
    }
  }

  for (const customer of customers) {
    if (
      customer.customerType === 'housingCompany' &&
      directlyMatchingCustomerIds.has(customer.id) &&
      customer.managedByCustomerId.length > 0
    ) {
      includedCustomerIds.add(customer.managedByCustomerId);
    }
  }

  for (const customer of customers) {
    if (
      customer.customerType === 'housingCompany' &&
      directlyMatchingCustomerIds.has(customer.managedByCustomerId)
    ) {
      includedCustomerIds.add(customer.id);
    }
  }

  return customers.filter((customer) => includedCustomerIds.has(customer.id));
}

function doesCustomerMatchSearch(customer: Customer, normalizedSearchQuery: string): boolean {
  const searchableValues = [
    customer.customerNumber,
    customer.name,
    getCustomerTypeLabel(customer.customerType),
    customer.businessId,
    customer.city,
    customer.email,
    customer.phone,
  ];

  return searchableValues.some((value) =>
    normalizeSearchText(value).includes(normalizedSearchQuery),
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('fi');
}
