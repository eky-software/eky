import type { Customer } from '@eky/api-client';

import {
  getCustomerListFilterLabel,
  getCustomerListFilters,
} from './customerDisplay.js';
import type { CustomerListFilter } from './customerListGrouping.js';
import { uiText } from '../i18n/fi.js';

interface CustomerTypeFilterProps {
  activeFilter: CustomerListFilter;
  customers: Customer[];
  onFilterChange(filter: CustomerListFilter): void;
}

export function CustomerTypeFilter({
  activeFilter,
  customers,
  onFilterChange,
}: CustomerTypeFilterProps): React.JSX.Element {
  return (
    <div className="customer-type-filter" aria-label={uiText.customers.customerTypeFilter}>
      {getCustomerListFilters().map((filter) => (
        <button
          aria-pressed={activeFilter === filter}
          className="customer-type-filter-button"
          key={filter}
          onClick={() => onFilterChange(filter)}
          type="button"
        >
          <span>{getCustomerListFilterLabel(filter)}</span>
          <strong>{countCustomersByFilter(customers, filter)}</strong>
        </button>
      ))}
    </div>
  );
}

function countCustomersByFilter(customers: Customer[], filter: CustomerListFilter): number {
  if (filter === 'all') {
    return customers.length;
  }

  return customers.filter((customer) => customer.customerType === filter).length;
}
