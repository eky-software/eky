import type { Customer } from '@eky/api-client';

import { CustomerActivitySection } from './CustomerActivitySection.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import { CustomerInvoicesSection } from './CustomerInvoicesSection.js';
import { CustomerOverview } from './CustomerOverview.js';
import type { CustomerActivityState } from './hooks/useCustomerActivity.js';
import type { CustomerInvoiceOverviewState } from './hooks/useCustomerInvoices.js';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerOverviewWorkspaceProps {
  activityState: CustomerActivityState;
  customer: Customer | null;
  customers: Customer[];
  defaultHourlyRateCents: number | null;
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
  defaultHourlyRateCents,
  errorMessage,
  invoiceState,
  isLoading,
  onBack,
  onEdit,
  onOpenInvoice,
}: CustomerOverviewWorkspaceProps): React.JSX.Element {
  if (isLoading) {
    return (
      <section className="panel">
        <p className="message">{uiText.customers.customerLoading}</p>
      </section>
    );
  }

  if (errorMessage !== null) {
    return (
      <section className="panel">
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.customers.backToCustomerList}
        </button>
      </section>
    );
  }

  if (customer === null) {
    return (
      <section className="panel">
        <p className="message">{uiText.customers.customerNotFound}</p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.customers.backToCustomerList}
        </button>
      </section>
    );
  }

  return (
    <>
      <CustomerOverview
        customer={customer}
        customers={customers}
        defaultHourlyRateCents={defaultHourlyRateCents}
        onBack={onBack}
        onEdit={onEdit}
      />
      <CustomerInvoicesSection
        invoiceState={invoiceState}
        onOpenInvoice={onOpenInvoice}
      />
      <CustomerActivitySection activityState={activityState} />
    </>
  );
}
