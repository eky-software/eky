import type { Customer } from '@eky/api-client';

import { groupCustomersForList, type CustomerListFilter } from './customerListGrouping.js';
import {
  sortCustomers,
  type CustomerSortKey,
  type CustomerSortState,
} from './customerListSorting.js';
import { searchCustomers } from './customerListSearch.js';
import { CustomerListToolbar } from './CustomerListToolbar.js';
import styles from './CustomerList.module.css';
import { CustomerTable } from './CustomerTable.js';
import { CustomerTypeFilter } from './CustomerTypeFilter.js';
import { uiText } from '../../i18n/fi.js';

interface CustomerListProps {
  activeFilter: CustomerListFilter;
  customers: Customer[];
  errorMessage: string | null;
  expandedPropertyManagerIds: ReadonlySet<string>;
  isLoading: boolean;
  onActiveFilterChange(activeFilter: CustomerListFilter): void;
  onCreateClick(): void;
  onCustomerSelect(customer: Customer): void;
  onPropertyManagerToggle(customerId: string): void;
  onSearchQueryChange(searchQuery: string): void;
  onSortChange(sortKey: CustomerSortKey): void;
  searchQuery: string;
  sortState: CustomerSortState;
}

export function CustomerList({
  activeFilter,
  customers,
  errorMessage,
  expandedPropertyManagerIds,
  isLoading,
  onActiveFilterChange,
  onCreateClick,
  onCustomerSelect,
  onPropertyManagerToggle,
  onSearchQueryChange,
  onSortChange,
  searchQuery,
  sortState,
}: CustomerListProps): React.JSX.Element {
  const searchedCustomers = searchCustomers(customers, searchQuery);
  const sortedCustomers = sortCustomers(searchedCustomers, sortState);
  const customerGroups = groupCustomersForList(sortedCustomers, activeFilter);

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="customer-list-heading">
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
          onSearchQueryChange={onSearchQueryChange}
          onSortChange={onSortChange}
          searchQuery={searchQuery}
          sortState={sortState}
        />
      ) : null}

      {customers.length > 0 ? (
        <CustomerTypeFilter
          activeFilter={activeFilter}
          customers={searchedCustomers}
          onFilterChange={onActiveFilterChange}
        />
      ) : null}

      {customerGroups.length > 0 ? (
        <CustomerTable
          customerGroups={customerGroups}
          customers={customers}
          expandedPropertyManagerIds={expandedPropertyManagerIds}
          onCustomerSelect={onCustomerSelect}
          onPropertyManagerToggle={onPropertyManagerToggle}
          onSortChange={onSortChange}
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
