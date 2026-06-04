import type { Customer } from '@eky/api-client';
import { useState } from 'react';

import { groupCustomersForList, type CustomerListFilter } from './customerListGrouping.js';
import {
  getNextCustomerSortState,
  sortCustomers,
  type CustomerSortKey,
  type CustomerSortState,
} from './customerListSorting.js';
import { searchCustomers } from './customerListSearch.js';
import { CustomerListToolbar } from './CustomerListToolbar.js';
import { CustomerTable } from './CustomerTable.js';
import { CustomerTypeFilter } from './CustomerTypeFilter.js';
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
        <CustomerListToolbar
          onSearchQueryChange={setSearchQuery}
          onSortChange={updateSort}
          searchQuery={searchQuery}
          sortState={sortState}
        />
      ) : null}

      {customers.length > 0 ? (
        <CustomerTypeFilter
          activeFilter={activeFilter}
          customers={searchedCustomers}
          onFilterChange={setActiveFilter}
        />
      ) : null}

      {customerGroups.length > 0 ? (
        <CustomerTable
          customerGroups={customerGroups}
          customers={customers}
          expandedPropertyManagerIds={expandedPropertyManagerIds}
          onCustomerSelect={onCustomerSelect}
          onPropertyManagerToggle={togglePropertyManager}
          onSortChange={updateSort}
          sortState={sortState}
        />
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
