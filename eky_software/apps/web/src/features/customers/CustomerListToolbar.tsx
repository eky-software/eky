import {
  type CustomerSortKey,
  type CustomerSortState,
} from './customerListSorting.js';
import { uiText } from '../../i18n/fi.js';

interface CustomerListToolbarProps {
  searchQuery: string;
  sortState: CustomerSortState;
  onSearchQueryChange(searchQuery: string): void;
  onSortChange(sortKey: CustomerSortKey): void;
}

export function CustomerListToolbar({
  searchQuery,
  sortState,
  onSearchQueryChange,
  onSortChange,
}: CustomerListToolbarProps): React.JSX.Element {
  return (
    <div className="customer-list-tools">
      <label className="customer-search-field">
        <span>{uiText.customers.searchCustomer}</span>
        <input
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={uiText.customers.searchCustomerPlaceholder}
          type="search"
          value={searchQuery}
        />
      </label>
      <label className="customer-sort-select">
        <span>{uiText.customers.sortCustomers}</span>
        <select
          onChange={(event) => onSortChange(event.target.value as CustomerSortKey)}
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
        onClick={() => onSortChange(sortState.key)}
        type="button"
      >
        {getSortDirectionLabel(sortState)}
      </button>
    </div>
  );
}

export function getSortDirectionLabel(sortState: CustomerSortState): string {
  if (sortState.key === 'status') {
    return sortState.direction === 'asc'
      ? uiText.customers.activeFirst
      : uiText.customers.inactiveFirst;
  }

  return sortState.direction === 'asc'
    ? uiText.customers.sortAscending
    : uiText.customers.sortDescending;
}
