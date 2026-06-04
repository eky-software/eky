import { useState } from 'react';

import { CompanySettingsPage } from './companySettings/CompanySettingsPage.js';
import { CustomerPage } from './customers/CustomerPage.js';
import { uiText } from './i18n/fi.js';
import { AppLayout } from './layout/AppLayout.js';

export type AppView = 'companySettings' | 'customers';

export function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<AppView>('customers');
  const activeTitle =
    activeView === 'companySettings' ? uiText.modules.companySettings : uiText.modules.customers;

  return (
    <AppLayout activeView={activeView} onViewChange={setActiveView} title={activeTitle}>
      {activeView === 'customers' ? <CustomerPage /> : <CompanySettingsPage />}
    </AppLayout>
  );
}
