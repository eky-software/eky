import type { Customer } from '@eky/api-client';

import { uiText } from '../../i18n/fi.js';

export type CustomerSortDirection = 'asc' | 'desc';

export type CustomerSortKey = 'city' | 'customerNumber' | 'customerType' | 'name' | 'status';

export interface CustomerSortState {
  direction: CustomerSortDirection;
  key: CustomerSortKey;
}

const collator = new Intl.Collator('fi', {
  numeric: true,
  sensitivity: 'base',
});

export function getNextCustomerSortState(
  currentSort: CustomerSortState,
  nextKey: CustomerSortKey,
): CustomerSortState {
  if (currentSort.key !== nextKey) {
    return {
      direction: 'asc',
      key: nextKey,
    };
  }

  return {
    direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
    key: nextKey,
  };
}

export function sortCustomers(
  customers: Customer[],
  sortState: CustomerSortState,
): Customer[] {
  return [...customers].sort((firstCustomer, secondCustomer) => {
    const comparison = compareCustomers(firstCustomer, secondCustomer, sortState.key);

    return sortState.direction === 'asc' ? comparison : -comparison;
  });
}

function compareCustomers(
  firstCustomer: Customer,
  secondCustomer: Customer,
  sortKey: CustomerSortKey,
): number {
  if (sortKey === 'status') {
    const statusComparison = compareCustomerStatuses(firstCustomer.status, secondCustomer.status);

    if (statusComparison !== 0) {
      return statusComparison;
    }

    return compareStrings(firstCustomer.name, secondCustomer.name);
  }

  const valueComparison = compareStrings(
    getCustomerSortValue(firstCustomer, sortKey),
    getCustomerSortValue(secondCustomer, sortKey),
  );

  if (valueComparison !== 0) {
    return valueComparison;
  }

  return compareStrings(firstCustomer.name, secondCustomer.name);
}

function compareCustomerStatuses(
  firstStatus: Customer['status'],
  secondStatus: Customer['status'],
): number {
  if (firstStatus === secondStatus) {
    return 0;
  }

  return firstStatus === 'active' ? -1 : 1;
}

function compareStrings(firstValue: string, secondValue: string): number {
  return collator.compare(firstValue.trim(), secondValue.trim());
}

function getCustomerSortValue(customer: Customer, sortKey: CustomerSortKey): string {
  if (sortKey === 'city') {
    return customer.city;
  }

  if (sortKey === 'customerNumber') {
    return customer.customerNumber;
  }

  if (sortKey === 'customerType') {
    return getCustomerTypeLabel(customer.customerType);
  }

  if (sortKey === 'status') {
    return customer.status;
  }

  return customer.name;
}

function getCustomerTypeLabel(customerType: Customer['customerType']): string {
  if (customerType === 'company') {
    return uiText.customers.organization;
  }

  if (customerType === 'housingCompany') {
    return uiText.customers.housingCompany;
  }

  if (customerType === 'propertyManager') {
    return uiText.customers.propertyManager;
  }

  if (customerType === 'privatePerson') {
    return uiText.customers.privatePerson;
  }

  return uiText.customers.other;
}
