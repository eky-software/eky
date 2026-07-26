import type { EkyApiClient } from '@eky/api-client';
import { useReducer } from 'react';

import { CompanySettingsPage } from '../features/companySettings/CompanySettingsPage.js';
import { CustomerPage } from '../features/customers/CustomerPage.js';
import { InvoicingPage } from '../features/invoicing/InvoicingPage.js';
import { ActivityPage } from '../features/activity/ActivityPage.js';
import { DiagnosticsPage } from '../features/diagnostics/DiagnosticsPage.js';
import { uiText } from '../i18n/fi.js';
import { AppLayout } from '../layout/AppLayout.js';
import {
  activateAppView,
  initialAppNavigationState,
} from './appNavigation.js';
import {
  getDesktopInvoicePdfPreview,
  getDesktopOperationalLogFolder,
  getDesktopSupportBundleCreator,
} from './desktopBridge.js';

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
  const openOperationalLogFolder = getDesktopOperationalLogFolder();
  const createSupportBundle = getDesktopSupportBundleCreator();

  return (
    <AppLayout activeView={activeView} onViewChange={activateView} title={activeTitle}>
      {activeView === 'customers' ? (
        <CustomerPage apiClient={apiClient} />
      ) : null}
      {activeView === 'activity' ? <ActivityPage apiClient={apiClient} /> : null}
      {activeView === 'diagnostics' ? (
        <DiagnosticsPage
          apiClient={apiClient}
          {...(openOperationalLogFolder === undefined
            ? {}
            : { openOperationalLogFolder })}
          {...(createSupportBundle === undefined
            ? {}
            : { createSupportBundle })}
        />
      ) : null}
      {activeView === 'companySettings' ? (
        <CompanySettingsPage
          apiClient={apiClient}
          isEmailSecretManagementAvailable={
            openInvoicePdfPreview !== undefined
          }
        />
      ) : null}
      {activeView === 'invoicing' ? (
        <InvoicingPage
          apiClient={apiClient}
          navigationRevision={navigation.invoicingNavigationRevision}
          {...(openInvoicePdfPreview === undefined
            ? {}
            : { openInvoicePdfPreview })}
        />
      ) : null}
    </AppLayout>
  );
}
