export type AppView = 'companySettings' | 'customers' | 'invoicing';

export interface AppNavigationState {
  activeView: AppView;
  invoicingNavigationRevision: number;
}

export const initialAppNavigationState: AppNavigationState = {
  activeView: 'customers',
  invoicingNavigationRevision: 0,
};

export function activateAppView(
  state: AppNavigationState,
  view: AppView,
): AppNavigationState {
  if (view === 'invoicing' && state.activeView === 'invoicing') {
    return {
      ...state,
      invoicingNavigationRevision: state.invoicingNavigationRevision + 1,
    };
  }

  return {
    ...state,
    activeView: view,
  };
}
