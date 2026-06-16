import { useState } from 'react';

import { CompanySettingsPage } from '../features/companySettings/CompanySettingsPage.js';
import { CustomerPage } from '../features/customers/CustomerPage.js';
import { InvoicingPage } from '../features/invoicing/components/InvoicingPage.js';
import { uiText } from '../i18n/fi.js';
import { AppLayout } from '../layout/AppLayout.js';

export type AppView = 'companySettings' | 'customers' | 'invoicing';

export function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<AppView>('customers');
  const activeTitle = uiText.modules[activeView];

  return (
    <AppLayout activeView={activeView} onViewChange={setActiveView} title={activeTitle}>
      {activeView === 'customers' ? <CustomerPage /> : null}
      {activeView === 'companySettings' ? <CompanySettingsPage /> : null}
      {activeView === 'invoicing' ? <InvoicingPage /> : null}
    </AppLayout>
  );
}
