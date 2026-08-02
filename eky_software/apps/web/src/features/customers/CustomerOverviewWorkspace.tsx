import type { Customer } from '@eky/api-client';

import { BillingRecipientInvoicesSection } from './BillingRecipientInvoicesSection.js';
import { CustomerActivitySection } from './CustomerActivitySection.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import type { CustomerDefaultHourlyRateState } from './customerDefaultHourlyRateState.js';
import { CustomerInvoicesSection } from './CustomerInvoicesSection.js';
import { CustomerOverview } from './CustomerOverview.js';
import { CustomerRecordInformationSection } from './CustomerRecordInformationSection.js';
import type { CustomerActivityState } from './hooks/useCustomerActivity.js';
import type { BillingRecipientInvoiceOverviewState } from './hooks/useBillingRecipientInvoices.js';
import type { CustomerInvoiceOverviewState } from './hooks/useCustomerInvoices.js';
import styles from './CustomerOverviewWorkspace.module.css';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerOverviewWorkspaceProps {
  activityState: CustomerActivityState;
  billingRecipientInvoiceState: BillingRecipientInvoiceOverviewState;
  customer: Customer | null;
  customers: Customer[];
  defaultHourlyRateState: CustomerDefaultHourlyRateState;
  errorMessage: string | null;
  invoiceState: CustomerInvoiceOverviewState;
  isLoading: boolean;
  onBack(): void;
  onCreateInvoice(customerId: string): void;
  onEdit(): void;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
  onOpenRelatedCustomer(customerId: string): void;
}

export function CustomerOverviewWorkspace({
  activityState,
  billingRecipientInvoiceState,
  customer,
  customers,
  defaultHourlyRateState,
  errorMessage,
  invoiceState,
  isLoading,
  onBack,
  onCreateInvoice,
  onEdit,
  onOpenInvoice,
  onOpenRelatedCustomer,
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
        onCreateInvoice={onCreateInvoice}
        onEdit={onEdit}
        onOpenRelatedCustomer={onOpenRelatedCustomer}
      />
      <CustomerInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={onOpenInvoice}
      />
      {customer.customerType === 'propertyManager' ? (
        <BillingRecipientInvoicesSection
          invoiceState={billingRecipientInvoiceState}
          onOpenInvoice={onOpenInvoice}
        />
      ) : null}
      <CustomerRecordInformationSection customer={customer} />
      <CustomerActivitySection activityState={activityState} />
    </div>
  );
}
