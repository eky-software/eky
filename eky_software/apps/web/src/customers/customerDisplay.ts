import type { Customer } from '@eky/api-client';

import { uiText } from '../i18n/fi.js';
import type { CustomerListFilter } from './customerListGrouping.js';

export function getCustomerListFilters(): CustomerListFilter[] {
  return ['all', 'company', 'housingCompany', 'propertyManager', 'privatePerson', 'other'];
}

export function getCustomerListFilterLabel(filter: CustomerListFilter): string {
  if (filter === 'all') {
    return uiText.customers.allCustomers;
  }

  return getCustomerTypeLabel(filter);
}

export function getCustomerTypeLabel(customerType: Customer['customerType']): string {
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

export function getCustomerStatusLabel(status: Customer['status']): string {
  return status === 'active' ? uiText.customers.active : uiText.customers.inactive;
}

export function getPrimaryContact(customer: Customer): string {
  return customer.email || customer.phone || '-';
}

export function getCustomerRelationshipLabel(customer: Customer, customers: Customer[]): string {
  if (customer.customerType !== 'housingCompany' || customer.managedByCustomerId.length === 0) {
    return uiText.customers.noPropertyManager;
  }

  const propertyManager = customers.find(
    (candidate) => candidate.id === customer.managedByCustomerId,
  );

  if (propertyManager === undefined) {
    return uiText.customers.noPropertyManager;
  }

  return `${uiText.customers.managedByPropertyManager}: ${propertyManager.name}`;
}

export function formatManagedHousingCompanyCount(count: number): string {
  if (count === 0) {
    return uiText.customers.noManagedHousingCompanies;
  }

  if (count === 1) {
    return uiText.customers.oneManagedHousingCompany;
  }

  return `${count} ${uiText.customers.managedHousingCompanies}`;
}
