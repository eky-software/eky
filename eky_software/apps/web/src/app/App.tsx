import type { EkyApiClient } from '@eky/api-client';
import { useReducer, useState } from 'react';

import { CompanySettingsPage } from '../features/companySettings/CompanySettingsPage.js';
import { CustomerPage } from '../features/customers/CustomerPage.js';
import { InvoicingPage } from '../features/invoicing/InvoicingPage.js';
import { ActivityPage } from '../features/activity/ActivityPage.js';
import { DiagnosticsPage } from '../features/diagnostics/DiagnosticsPage.js';
import { WorkspaceSelectorPage } from '../features/workspaces/WorkspaceSelectorPage.js';
import { uiText } from '../i18n/fi.js';
import { AppLayout } from '../layout/AppLayout.js';
import {
  activateAppView,
  initialAppNavigationState,
} from './appNavigation.js';
import { DesktopOperationalLogNotice } from './DesktopOperationalLogNotice.js';
import type { WebAppComposition } from './createWebAppComposition.js';
import {
  getDesktopInvoicePdfPreview,
  getDesktopInvoicePdfArchive,
  getDesktopLocalUpdate,
  getDesktopOperationalLogFolder,
  getDesktopProfileProtection,
  getDesktopSupportBundleCreator,
  getDesktopWorkspaceManagement,
} from './desktopBridge.js';

interface AppProps {
  apiClient: EkyApiClient;
}

export function App(composition: WebAppComposition): React.JSX.Element {
  if (composition.mode === 'workspaceSelector') {
    return (
      <>
        <DesktopOperationalLogNotice />
        <WorkspaceSelectorPage
          capability={composition.workspaceManagementCapability}
        />
      </>
    );
  }
  return <BusinessApp apiClient={composition.apiClient} />;
}

function BusinessApp({ apiClient }: AppProps): React.JSX.Element {
  const [navigation, activateView] = useReducer(
    activateAppView,
    initialAppNavigationState,
  );
  const { activeView } = navigation;
  const activeTitle = uiText.modules[activeView];
  const openInvoicePdfPreview = getDesktopInvoicePdfPreview();
  const invoicePdfArchiveCapability = getDesktopInvoicePdfArchive();
  const profileProtectionCapability = getDesktopProfileProtection();
  const localUpdateCapability = getDesktopLocalUpdate();
  const openOperationalLogFolder = getDesktopOperationalLogFolder();
  const createSupportBundle = getDesktopSupportBundleCreator();
  const [workspaceManagementCapability] = useState(() =>
    getDesktopWorkspaceManagement(),
  );

  return (
    <AppLayout
      activeView={activeView}
      onViewChange={activateView}
      title={activeTitle}
      {...(workspaceManagementCapability === undefined
        ? {}
        : { workspaceManagementCapability })}
    >
      <DesktopOperationalLogNotice />
      {activeView === 'customers' ? (
        <CustomerPage
          apiClient={apiClient}
          navigationRequest={{
            revision: navigation.customerNavigationRevision,
          }}
          onCreateInvoice={(customerId) =>
            activateView({
              target: {
                customerId,
                type: 'createInvoiceForCustomer',
              },
              type: 'openInvoicingTarget',
            })
          }
          onOpenInvoice={(target) =>
            activateView({
              target,
              type: 'openInvoicingTarget',
            })
          }
        />
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
          {...(invoicePdfArchiveCapability === undefined
            ? {}
            : { invoicePdfArchiveCapability })}
          {...(profileProtectionCapability === undefined
            ? {}
            : { profileProtectionCapability })}
          {...(localUpdateCapability === undefined
            ? {}
            : { localUpdateCapability })}
          onOpenActivity={() => activateView('activity')}
          onOpenDiagnostics={() => activateView('diagnostics')}
        />
      ) : null}
      {activeView === 'invoicing' ? (
        <InvoicingPage
          apiClient={apiClient}
          navigationRequest={{
            revision: navigation.invoicingNavigationRevision,
            target: navigation.invoicingNavigationTarget,
          }}
          {...(openInvoicePdfPreview === undefined
            ? {}
            : { openInvoicePdfPreview })}
        />
      ) : null}
    </AppLayout>
  );
}
