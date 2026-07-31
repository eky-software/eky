import type { Customer } from '@eky/api-client';

import { CustomerActivitySection } from './CustomerActivitySection.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import type { CustomerDefaultHourlyRateState } from './customerDefaultHourlyRateState.js';
import { CustomerInvoicesSection } from './CustomerInvoicesSection.js';
import { CustomerOverview } from './CustomerOverview.js';
import type { CustomerActivityState } from './hooks/useCustomerActivity.js';
import type { CustomerInvoiceOverviewState } from './hooks/useCustomerInvoices.js';
import styles from './CustomerOverviewWorkspace.module.css';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerOverviewWorkspaceProps {
  activityState: CustomerActivityState;
  customer: Customer | null;
  customers: Customer[];
  defaultHourlyRateState: CustomerDefaultHourlyRateState;
  errorMessage: string | null;
  invoiceState: CustomerInvoiceOverviewState;
  isLoading: boolean;
  onBack(): void;
  onEdit(): void;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
}

export function CustomerOverviewWorkspace({
  activityState,
  customer,
  customers,
  defaultHourlyRateState,
  errorMessage,
  invoiceState,
  isLoading,
  onBack,
  onEdit,
  onOpenInvoice,
}: CustomerOverviewWorkspaceProps): React.JSX.Element {
  const navigation = (
    <nav
      aria-label={uiText.customers.customerCardNavigation}
      className={styles.navigation}
    >
      <button className="ghost-button" onClick={onBack} type="button">
        {uiText.customers.customerListNavigation}
      </button>
    </nav>
  );

  if (isLoading) {
    return (
      <div className={styles.workspace}>
        {navigation}
        <section className="panel">
          <p className="message">{uiText.customers.customerLoading}</p>
        </section>
      </div>
    );
  }

  if (errorMessage !== null) {
    return (
      <div className={styles.workspace}>
        {navigation}
        <section className="panel">
          <MessageBanner variant="error">{errorMessage}</MessageBanner>
        </section>
      </div>
    );
  }

  if (customer === null) {
    return (
      <div className={styles.workspace}>
        {navigation}
        <section className="panel">
          <p className="message">{uiText.customers.customerNotFound}</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.workspace}>
      {navigation}
      <CustomerOverview
        customer={customer}
        customers={customers}
        defaultHourlyRateState={defaultHourlyRateState}
        onEdit={onEdit}
      />
      <CustomerInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={onOpenInvoice}
      />
      <CustomerActivitySection activityState={activityState} />
    </div>
  );
}
