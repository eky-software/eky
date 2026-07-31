import { describe, expect, it } from 'vitest';

import {
  customerWorkspaceReducer,
  initialCustomerWorkspaceState,
} from './customerWorkspaceState.js';

describe('customerWorkspaceReducer', () => {
  it('moves through list, create, overview and edit modes explicitly', () => {
    const createState = customerWorkspaceReducer(initialCustomerWorkspaceState, {
      type: 'createCustomer',
    });
    const overviewState = customerWorkspaceReducer(createState, {
      customerId: 'customer-1',
      type: 'showCustomerOverview',
    });
    const editState = customerWorkspaceReducer(overviewState, {
      customerId: 'customer-1',
      type: 'editCustomer',
    });

    expect(createState).toEqual({ mode: 'create' });
    expect(overviewState).toEqual({
      customerId: 'customer-1',
      mode: 'overview',
    });
    expect(editState).toEqual({
      customerId: 'customer-1',
      mode: 'edit',
    });
    expect(
      customerWorkspaceReducer(editState, { type: 'showCustomerList' }),
    ).toEqual({ mode: 'list' });
  });
});
