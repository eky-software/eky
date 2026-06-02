import type { Customer } from '@eky/api-client';
import { useState } from 'react';

import { groupCustomersForList, type CustomerListFilter } from './customerListGrouping.js';
import {
  getNextCustomerSortState,
  sortCustomers,
  type CustomerSortKey,
  type CustomerSortState,
} from './customerListSorting.js';
import { uiText } from '../i18n/fi.js';

interface CustomerListProps {
  customers: Customer[];
  errorMessage: string | null;
  isLoading: boolean;
  onCreateClick(): void;
  onCustomerSelect(customer: Customer): void;
}

export function CustomerList({
  customers,
  errorMessage,
  isLoading,
  onCreateClick,
  onCustomerSelect,
}: CustomerListProps): React.JSX.Element {
  const [activeFilter, setActiveFilter] = useState<CustomerListFilter>('all');
  const [expandedPropertyManagerIds, setExpandedPropertyManagerIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortState, setSortState] = useState<CustomerSortState>({
    direction: 'asc',
    key: 'name',
  });
  const searchedCustomers = searchCustomers(customers, searchQuery);
  const sortedCustomers = sortCustomers(searchedCustomers, sortState);
  const customerGroups = groupCustomersForList(sortedCustomers, activeFilter);

  function togglePropertyManager(customerId: string): void {
    setExpandedPropertyManagerIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(customerId)) {
        nextIds.delete(customerId);
      } else {
        nextIds.add(customerId);
      }

      return nextIds;
    });
  }

  function updateSort(nextSortKey: CustomerSortKey): void {
    setSortState((currentSort) => getNextCustomerSortState(currentSort, nextSortKey));
  }

  return (
    <section className="panel customer-list-panel" aria-labelledby="customer-list-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.customerRegister}</p>
          <h2 id="customer-list-heading">{uiText.customers.customerList}</h2>
        </div>
        <div className="panel-actions">
          <span className="count-badge">{customers.length}</span>
          <button onClick={onCreateClick} type="button">
            {uiText.customers.newCustomerAction}
          </button>
        </div>
      </div>

      {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}
      {isLoading ? <p className="message">{uiText.customers.loading}</p> : null}
      {!isLoading && customers.length === 0 ? (
        <p className="message">{uiText.customers.empty}</p>
      ) : null}

      {customers.length > 0 ? (
        <div className="customer-list-tools">
          <label className="customer-search-field">
            <span>{uiText.customers.searchCustomer}</span>
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={uiText.customers.searchCustomerPlaceholder}
              type="search"
              value={searchQuery}
            />
          </label>
          <label className="customer-sort-select">
            <span>{uiText.customers.sortCustomers}</span>
            <select
              onChange={(event) => updateSort(event.target.value as CustomerSortKey)}
              value={sortState.key}
            >
              <option value="name">{uiText.customers.sortByName}</option>
              <option value="customerNumber">{uiText.customers.sortByCustomerNumber}</option>
              <option value="customerType">{uiText.customers.sortByCustomerType}</option>
              <option value="city">{uiText.customers.sortByCity}</option>
              <option value="status">{uiText.customers.sortByStatus}</option>
            </select>
          </label>
          <button
            className="ghost-button customer-sort-direction-button"
            onClick={() => updateSort(sortState.key)}
            type="button"
          >
            {getSortDirectionLabel(sortState)}
          </button>
        </div>
      ) : null}

      {customers.length > 0 ? (
        <div className="customer-type-filter" aria-label={uiText.customers.customerTypeFilter}>
          {getCustomerListFilters().map((filter) => (
            <button
              aria-pressed={activeFilter === filter}
              className="customer-type-filter-button"
              key={filter}
              onClick={() => setActiveFilter(filter)}
              type="button"
            >
              <span>{getCustomerListFilterLabel(filter)}</span>
              <strong>{countCustomersByFilter(searchedCustomers, filter)}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {customerGroups.length > 0 ? (
        <div className="customer-table" role="table" aria-label={uiText.customers.customers}>
          <div className="customer-table-row customer-table-head" role="row">
            <span role="columnheader">
              <CustomerSortButton
                isActive={sortState.key === 'name'}
                label={uiText.customers.customer}
                onClick={() => updateSort('name')}
                sortState={sortState}
              />
            </span>
            <span role="columnheader">
              <CustomerSortButton
                isActive={sortState.key === 'customerType'}
                label={uiText.customers.customerType}
                onClick={() => updateSort('customerType')}
                sortState={sortState}
              />
            </span>
            <span role="columnheader">
              <CustomerSortButton
                isActive={sortState.key === 'city'}
                label={uiText.customers.city}
                onClick={() => updateSort('city')}
                sortState={sortState}
              />
            </span>
            <span role="columnheader">{uiText.customers.contact}</span>
            <span role="columnheader">
              <CustomerSortButton
                isActive={sortState.key === 'status'}
                label={uiText.customers.status}
                onClick={() => updateSort('status')}
                sortState={sortState}
              />
            </span>
            <span role="columnheader" aria-label={uiText.customers.actions} />
          </div>
          {customerGroups.map(({ customer, managedHousingCompanies }) => {
            const isPropertyManager = customer.customerType === 'propertyManager';
            const hasManagedHousingCompanies = managedHousingCompanies.length > 0;
            const isExpanded = expandedPropertyManagerIds.has(customer.id);

            return (
              <div className="customer-table-group" key={customer.id}>
                <div className="customer-table-row customer-table-button-row">
                  <button
                    className="customer-row-open-button"
                    onClick={() => onCustomerSelect(customer)}
                    type="button"
                  >
                    <span className="customer-main-cell">
                      <span className="customer-number">{customer.customerNumber}</span>
                      <strong>{customer.name}</strong>
                      {isPropertyManager ? (
                        <span className="customer-secondary">
                          {formatManagedHousingCompanyCount(managedHousingCompanies.length)}
                        </span>
                      ) : customer.customerType === 'housingCompany' ? (
                        <span className="customer-secondary">
                          {getCustomerRelationshipLabel(customer, customers)}
                        </span>
                      ) : null}
                    </span>
                    <span role="cell">{getCustomerTypeLabel(customer.customerType)}</span>
                    <span role="cell">{customer.city || '-'}</span>
                    <span role="cell">{getPrimaryContact(customer)}</span>
                    <span role="cell">
                      <span className={`status-pill status-pill-${customer.status}`}>
                        {getCustomerStatusLabel(customer.status)}
                      </span>
                    </span>
                  </button>
                  {isPropertyManager ? (
                    <button
                      aria-expanded={isExpanded}
                      aria-label={
                        isExpanded
                          ? uiText.customers.collapseManagedHousingCompanies
                          : uiText.customers.expandManagedHousingCompanies
                      }
                      className="customer-expand-button"
                      disabled={!hasManagedHousingCompanies}
                      onClick={() => togglePropertyManager(customer.id)}
                      type="button"
                    >
                      {isExpanded ? '-' : '+'}
                    </button>
                  ) : null}
                </div>
                {isPropertyManager && isExpanded
                  ? managedHousingCompanies.map((housingCompany) => (
                      <button
                        className="customer-table-row customer-table-button customer-table-child-row"
                        key={housingCompany.id}
                        onClick={() => onCustomerSelect(housingCompany)}
                        type="button"
                      >
                        <span className="customer-main-cell">
                          <span className="customer-number">{housingCompany.customerNumber}</span>
                          <strong>{housingCompany.name}</strong>
                          <span className="customer-secondary">
                            {uiText.customers.housingCompany}
                          </span>
                        </span>
                        <span role="cell">{getCustomerTypeLabel(housingCompany.customerType)}</span>
                        <span role="cell">{housingCompany.city || '-'}</span>
                        <span role="cell">{getPrimaryContact(housingCompany)}</span>
                        <span role="cell">
                          <span className={`status-pill status-pill-${housingCompany.status}`}>
                            {getCustomerStatusLabel(housingCompany.status)}
                          </span>
                        </span>
                        <span role="cell" />
                      </button>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {customers.length > 0 && customerGroups.length === 0 ? (
        <p className="message">
          {searchQuery.trim().length > 0
            ? uiText.customers.emptyForSearch
            : uiText.customers.emptyForSelectedType}
        </p>
      ) : null}
    </section>
  );
}

interface CustomerSortButtonProps {
  isActive: boolean;
  label: string;
  onClick(): void;
  sortState: CustomerSortState;
}

function CustomerSortButton({
  isActive,
  label,
  onClick,
  sortState,
}: CustomerSortButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={getSortButtonLabel(label, isActive, sortState)}
      className="customer-sort-header-button"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      {isActive ? <strong aria-hidden="true">{getSortIndicator(sortState)}</strong> : null}
    </button>
  );
}

function getCustomerListFilters(): CustomerListFilter[] {
  return ['all', 'company', 'housingCompany', 'propertyManager', 'privatePerson', 'other'];
}

function getCustomerListFilterLabel(filter: CustomerListFilter): string {
  if (filter === 'all') {
    return uiText.customers.allCustomers;
  }

  return getCustomerTypeLabel(filter);
}

function countCustomersByFilter(customers: Customer[], filter: CustomerListFilter): number {
  if (filter === 'all') {
    return customers.length;
  }

  return customers.filter((customer) => customer.customerType === filter).length;
}

function searchCustomers(customers: Customer[], searchQuery: string): Customer[] {
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

function getSortDirectionLabel(sortState: CustomerSortState): string {
  if (sortState.key === 'status') {
    return sortState.direction === 'asc'
      ? uiText.customers.activeFirst
      : uiText.customers.inactiveFirst;
  }

  return sortState.direction === 'asc'
    ? uiText.customers.sortAscending
    : uiText.customers.sortDescending;
}

function getSortButtonLabel(
  label: string,
  isActive: boolean,
  sortState: CustomerSortState,
): string {
  if (!isActive) {
    return `${uiText.customers.sortByColumn}: ${label}`;
  }

  return `${uiText.customers.sortByColumn}: ${label}, ${getSortDirectionLabel(sortState)}`;
}

function getSortIndicator(sortState: CustomerSortState): string {
  if (sortState.key === 'status') {
    return sortState.direction === 'asc'
      ? uiText.customers.activeFirstShort
      : uiText.customers.inactiveFirstShort;
  }

  return sortState.direction === 'asc' ? 'A-Ö' : 'Ö-A';
}

function formatManagedHousingCompanyCount(count: number): string {
  if (count === 0) {
    return uiText.customers.noManagedHousingCompanies;
  }

  if (count === 1) {
    return uiText.customers.oneManagedHousingCompany;
  }

  return `${count} ${uiText.customers.managedHousingCompanies}`;
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

function getCustomerStatusLabel(status: Customer['status']): string {
  return status === 'active' ? uiText.customers.active : uiText.customers.inactive;
}

function getPrimaryContact(customer: Customer): string {
  return customer.email || customer.phone || '-';
}

function getCustomerRelationshipLabel(customer: Customer, customers: Customer[]): string {
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
