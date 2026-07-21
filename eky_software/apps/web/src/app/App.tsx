import type { EkyApiClient } from '@eky/api-client';
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
import { getDesktopInvoicePdfPreview } from './desktopBridge.js';

interface AppProps {
  apiClient: EkyApiClient;
}

export function App({ apiClient }: AppProps): React.JSX.Element {
  const [navigation, activateView] = useReducer(
    activateAppView,
    initialAppNavigationState,
  );
  const { activeView } = navigation;
  const activeTitle = uiText.modules[activeView];
  const openInvoicePdfPreview = getDesktopInvoicePdfPreview();

  return (
    <AppLayout activeView={activeView} onViewChange={activateView} title={activeTitle}>
      {activeView === 'customers' ? (
        <CustomerPage apiClient={apiClient} />
      ) : null}
      {activeView === 'companySettings' ? (
        <CompanySettingsPage apiClient={apiClient} />
      ) : null}
      {activeView === 'invoicing' ? (
        <InvoicingPage
          navigationRevision={navigation.invoicingNavigationRevision}
          {...(openInvoicePdfPreview === undefined
            ? {}
            : { openInvoicePdfPreview })}
        />
      ) : null}
    </AppLayout>
  );
}
