import { useReducer } from 'react';

import { CompanySettingsPage } from '../features/companySettings/CompanySettingsPage.js';
import { CustomerPage } from '../features/customers/CustomerPage.js';
import { InvoicingPage } from '../features/invoicing/InvoicingPage.js';
import { uiText } from '../i18n/fi.js';
import { AppLayout } from '../layout/AppLayout.js';
import {
  activateAppView,
  initialAppNavigationState,
} from './appNavigation.js';

export function App(): React.JSX.Element {
  const [navigation, activateView] = useReducer(
    activateAppView,
    initialAppNavigationState,
  );
  const { activeView } = navigation;
  const activeTitle = uiText.modules[activeView];

  return (
    <AppLayout activeView={activeView} onViewChange={activateView} title={activeTitle}>
      {activeView === 'customers' ? <CustomerPage /> : null}
      {activeView === 'companySettings' ? <CompanySettingsPage /> : null}
      {activeView === 'invoicing' ? (
        <InvoicingPage
          navigationRevision={navigation.invoicingNavigationRevision}
        />
      ) : null}
    </AppLayout>
  );
}
