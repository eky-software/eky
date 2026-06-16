import type { Customer, CustomerType } from '@eky/api-client';

import { centsToEuroInput } from '../../../shared/money/hourlyRateInput.js';
import styles from './SelectedCustomerDetails.module.css';
import { uiText } from '../../../i18n/fi.js';

interface SelectedCustomerDetailsProps {
  customer: Customer;
  propertyManager: Customer | null;
}

export function SelectedCustomerDetails({
  customer,
  propertyManager,
}: SelectedCustomerDetailsProps): React.JSX.Element {
  const address = formatCustomerAddress(customer);

  return (
    <section
      aria-labelledby="selected-customer-details-title"
      className={styles.details}
    >
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">
            {uiText.invoicing.selectedCustomerKicker}
          </p>
          <h4 id="selected-customer-details-title">{customer.name}</h4>
        </div>
        <span
          className={`status-pill ${
            customer.status === 'active'
              ? 'status-pill-active'
              : 'status-pill-inactive'
          }`}
        >
          {customer.status === 'active'
            ? uiText.customers.active
            : uiText.customers.inactive}
        </span>
      </header>

      <dl className={styles.grid}>
        <CustomerDetail
          label={uiText.customers.customerNumber}
          value={customer.customerNumber}
        />
        <CustomerDetail
          label={uiText.customers.customerType}
          value={getCustomerTypeLabel(customer.customerType)}
        />
        <CustomerDetail
          label={uiText.customers.businessId}
          value={customer.businessId}
        />
        <CustomerDetail
          className={styles.wide}
          label={uiText.customers.address}
          value={address}
        />
        <CustomerDetail
          label={uiText.customers.email}
          value={customer.email}
        />
        <CustomerDetail
          label={uiText.customers.phone}
          value={customer.phone}
        />
        <CustomerDetail
          label={uiText.invoicing.customerHourlyRate}
          value={formatHourlyRate(customer.hourlyRateOverrideCents)}
        />
        {propertyManager !== null ? (
          <CustomerDetail
            label={uiText.customers.managedByPropertyManager}
            value={`${propertyManager.customerNumber} – ${propertyManager.name}`}
          />
        ) : null}
        {customer.comment.trim() !== '' ? (
          <CustomerDetail
            className={styles.comment}
            label={uiText.customers.comment}
            value={customer.comment}
          />
        ) : null}
      </dl>
    </section>
  );
}

interface CustomerDetailProps {
  className?: string | undefined;
  label: string;
  value: string;
}

function CustomerDetail({
  className,
  label,
  value,
}: CustomerDetailProps): React.JSX.Element {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value.trim() === '' ? uiText.invoicing.notSet : value}</dd>
    </div>
  );
}

export function formatCustomerAddress(customer: Customer): string {
  const cityLine = [customer.postalCode, customer.city]
    .filter((part) => part.trim() !== '')
    .join(' ');

  return [customer.streetAddress, cityLine]
    .filter((part) => part.trim() !== '')
    .join(', ');
}

function formatHourlyRate(hourlyRateCents: number | null): string {
  if (hourlyRateCents === null) {
    return uiText.invoicing.customerDefaultHourlyRate;
  }

  return `${centsToEuroInput(hourlyRateCents)} €/h`;
}

function getCustomerTypeLabel(customerType: CustomerType): string {
  const labels: Record<CustomerType, string> = {
    company: uiText.customers.organization,
    housingCompany: uiText.customers.housingCompany,
    other: uiText.customers.other,
    privatePerson: uiText.customers.privatePerson,
    propertyManager: uiText.customers.propertyManager,
  };

  return labels[customerType];
}
