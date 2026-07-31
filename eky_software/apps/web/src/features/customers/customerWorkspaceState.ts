export type CustomerWorkspaceState =
  | { mode: 'create' }
  | { customerId: string; mode: 'edit' }
  | { mode: 'list' }
  | { customerId: string; mode: 'overview' };

export type CustomerWorkspaceAction =
  | { type: 'createCustomer' }
  | { customerId: string; type: 'editCustomer' }
  | { type: 'showCustomerList' }
  | { customerId: string; type: 'showCustomerOverview' };

export const initialCustomerWorkspaceState: CustomerWorkspaceState = {
  mode: 'list',
};

export function customerWorkspaceReducer(
  _state: CustomerWorkspaceState,
  action: CustomerWorkspaceAction,
): CustomerWorkspaceState {
  if (action.type === 'createCustomer') {
    return { mode: 'create' };
  }

  if (action.type === 'editCustomer') {
    return {
      customerId: action.customerId,
      mode: 'edit',
    };
  }

  if (action.type === 'showCustomerOverview') {
    return {
      customerId: action.customerId,
      mode: 'overview',
    };
  }

  return initialCustomerWorkspaceState;
}
