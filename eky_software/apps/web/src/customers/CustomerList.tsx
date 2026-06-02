import type { Customer } from '@eky/api-client';
import { useState } from 'react';

import { groupCustomersForList, type CustomerListFilter } from './customerListGrouping.js';
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
  const customerGroups = groupCustomersForList(customers, activeFilter);

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
              <strong>{countCustomersByFilter(customers, filter)}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {customerGroups.length > 0 ? (
        <div className="customer-table" role="table" aria-label={uiText.customers.customers}>
          <div className="customer-table-row customer-table-head" role="row">
            <span role="columnheader">{uiText.customers.customer}</span>
            <span role="columnheader">{uiText.customers.customerType}</span>
            <span role="columnheader">{uiText.customers.city}</span>
            <span role="columnheader">{uiText.customers.contact}</span>
            <span role="columnheader">{uiText.customers.status}</span>
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
        <p className="message">{uiText.customers.emptyForSelectedType}</p>
      ) : null}
    </section>
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
