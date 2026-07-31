import type { InvoicingNavigationTarget } from '../features/invoicing/InvoicingPage.js';

export type AppView =
  | 'activity'
  | 'companySettings'
  | 'customers'
  | 'diagnostics'
  | 'invoicing';

export interface AppNavigationState {
  activeView: AppView;
  customerNavigationRevision: number;
  invoicingNavigationRevision: number;
  invoicingNavigationTarget: InvoicingNavigationTarget | null;
}

export const initialAppNavigationState: AppNavigationState = {
  activeView: 'customers',
  customerNavigationRevision: 0,
  invoicingNavigationRevision: 0,
  invoicingNavigationTarget: null,
};

export type AppNavigationAction =
  | AppView
  | {
      target: InvoicingNavigationTarget;
      type: 'openInvoicingTarget';
    };

export function activateAppView(
  state: AppNavigationState,
  action: AppNavigationAction,
): AppNavigationState {
  if (typeof action !== 'string') {
    return {
      ...state,
      activeView: 'invoicing',
      invoicingNavigationRevision: state.invoicingNavigationRevision + 1,
      invoicingNavigationTarget: action.target,
    };
  }

  const view = action;

  if (view === 'invoicing' && state.activeView === 'invoicing') {
    return {
      ...state,
      invoicingNavigationRevision: state.invoicingNavigationRevision + 1,
      invoicingNavigationTarget: null,
    };
  }

  if (view === 'customers' && state.activeView === 'customers') {
    return {
      ...state,
      customerNavigationRevision: state.customerNavigationRevision + 1,
    };
  }

  return {
    ...state,
    activeView: view,
    ...(view === 'invoicing' ? { invoicingNavigationTarget: null } : {}),
  };
}
