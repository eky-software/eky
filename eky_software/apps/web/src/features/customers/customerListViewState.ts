import type { CustomerListFilter } from './customerListGrouping.js';
import {
  getNextCustomerSortState,
  type CustomerSortKey,
  type CustomerSortState,
} from './customerListSorting.js';

export interface CustomerListViewState {
  activeFilter: CustomerListFilter;
  expandedPropertyManagerIds: ReadonlySet<string>;
  searchQuery: string;
  sortState: CustomerSortState;
}

export type CustomerListViewAction =
  | { activeFilter: CustomerListFilter; type: 'changeFilter' }
  | { searchQuery: string; type: 'changeSearchQuery' }
  | { customerId: string; type: 'togglePropertyManager' }
  | { sortKey: CustomerSortKey; type: 'updateSort' };

export const initialCustomerListViewState: CustomerListViewState = {
  activeFilter: 'all',
  expandedPropertyManagerIds: new Set(),
  searchQuery: '',
  sortState: {
    direction: 'asc',
    key: 'name',
  },
};

export function customerListViewReducer(
  state: CustomerListViewState,
  action: CustomerListViewAction,
): CustomerListViewState {
  if (action.type === 'changeFilter') {
    return {
      ...state,
      activeFilter: action.activeFilter,
    };
  }

  if (action.type === 'changeSearchQuery') {
    return {
      ...state,
      searchQuery: action.searchQuery,
    };
  }

  if (action.type === 'updateSort') {
    return {
      ...state,
      sortState: getNextCustomerSortState(state.sortState, action.sortKey),
    };
  }

  const expandedPropertyManagerIds = new Set(
    state.expandedPropertyManagerIds,
  );

  if (expandedPropertyManagerIds.has(action.customerId)) {
    expandedPropertyManagerIds.delete(action.customerId);
  } else {
    expandedPropertyManagerIds.add(action.customerId);
  }

  return {
    ...state,
    expandedPropertyManagerIds,
  };
}
