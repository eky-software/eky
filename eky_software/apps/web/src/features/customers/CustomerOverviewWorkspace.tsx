import type { Customer } from '@eky/api-client';

import { CustomerOverview } from './CustomerOverview.js';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerOverviewWorkspaceProps {
  customer: Customer | null;
  customers: Customer[];
  defaultHourlyRateCents: number | null;
  errorMessage: string | null;
  isLoading: boolean;
  onBack(): void;
  onEdit(): void;
}

export function CustomerOverviewWorkspace({
  customer,
  customers,
  defaultHourlyRateCents,
  errorMessage,
  isLoading,
  onBack,
  onEdit,
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
    <CustomerOverview
      customer={customer}
      customers={customers}
      defaultHourlyRateCents={defaultHourlyRateCents}
      onBack={onBack}
      onEdit={onEdit}
    />
  );
}
