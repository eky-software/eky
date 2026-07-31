import { describe, expect, it } from 'vitest';

import {
  customerListViewReducer,
  initialCustomerListViewState,
} from './customerListViewState.js';

describe('customerListViewReducer', () => {
  it('preserves independent list controls while changing one value', () => {
    const searchedState = customerListViewReducer(
      initialCustomerListViewState,
      {
        searchQuery: 'Kotikatu',
        type: 'changeSearchQuery',
      },
    );
    const filteredState = customerListViewReducer(searchedState, {
      activeFilter: 'company',
      type: 'changeFilter',
    });
    const expandedState = customerListViewReducer(filteredState, {
      customerId: 'property-manager-1',
      type: 'togglePropertyManager',
    });
    const sortedState = customerListViewReducer(expandedState, {
      sortKey: 'city',
      type: 'updateSort',
    });

    expect(sortedState).toMatchObject({
      activeFilter: 'company',
      searchQuery: 'Kotikatu',
      sortState: {
        direction: 'asc',
        key: 'city',
      },
    });
    expect(
      sortedState.expandedPropertyManagerIds.has('property-manager-1'),
    ).toBe(true);
  });

  it('does not mutate the previous expanded id set', () => {
    const nextState = customerListViewReducer(initialCustomerListViewState, {
      customerId: 'property-manager-1',
      type: 'togglePropertyManager',
    });

    expect(
      initialCustomerListViewState.expandedPropertyManagerIds.size,
    ).toBe(0);
    expect(nextState.expandedPropertyManagerIds.size).toBe(1);
  });
});
