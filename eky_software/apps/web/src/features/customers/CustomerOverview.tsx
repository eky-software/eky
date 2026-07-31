import type { Customer } from '@eky/api-client';

import {
  formatCustomerTimestamp,
  getCustomerStatusLabel,
  getCustomerTypeLabel,
} from './customerDisplay.js';
import styles from './CustomerOverview.module.css';
import { centsToEuroInput } from '../../shared/money/hourlyRateInput.js';
import { uiText } from '../../i18n/fi.js';

interface CustomerOverviewProps {
  customer: Customer;
  customers: Customer[];
  defaultHourlyRateCents: number | null;
  onBack(): void;
  onEdit(): void;
}

export function CustomerOverview({
  customer,
  customers,
  defaultHourlyRateCents,
  onBack,
  onEdit,
}: CustomerOverviewProps): React.JSX.Element {
  const propertyManager = customers.find(
    (candidate) => candidate.id === customer.managedByCustomerId,
  );
  const effectiveHourlyRateCents =
    customer.hourlyRateOverrideCents ?? defaultHourlyRateCents;

  return (
    <article className={styles.overview} aria-labelledby="customer-overview-heading">
      <header className={styles.header}>
        <div className={styles.heading}>
          <button className="ghost-button" onClick={onBack} type="button">
            {uiText.customers.backToCustomerList}
          </button>
          <div>
            <p className="eyebrow">{uiText.customers.customerCard}</p>
            <h2 id="customer-overview-heading">{customer.name}</h2>
            <p className={styles.identity}>
              {customer.customerNumber} · {getCustomerTypeLabel(customer.customerType)}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`status-pill status-pill-${customer.status}`}>
            {getCustomerStatusLabel(customer.status)}
          </span>
          <button onClick={onEdit} type="button">
            {uiText.customers.edit}
          </button>
        </div>
      </header>

      <div className={styles.sectionGrid}>
        <CustomerOverviewSection heading={uiText.customers.basicInformation}>
          <CustomerFact
            label={uiText.customers.customerNumber}
            value={customer.customerNumber}
          />
          <CustomerFact
            label={uiText.customers.customerType}
            value={getCustomerTypeLabel(customer.customerType)}
          />
          <CustomerFact
            label={uiText.customers.businessId}
            value={customer.businessId}
          />
          <CustomerFact
            label={uiText.customers.status}
            value={getCustomerStatusLabel(customer.status)}
          />
          {customer.customerType === 'housingCompany' ? (
            <CustomerFact
              label={uiText.customers.managedByPropertyManager}
              value={
                propertyManager === undefined
                  ? ''
                  : `${propertyManager.customerNumber} · ${propertyManager.name}`
              }
            />
          ) : null}
        </CustomerOverviewSection>

        <CustomerOverviewSection heading={uiText.customers.contactInformation}>
          <CustomerFact label={uiText.customers.email} value={customer.email} />
          <CustomerFact label={uiText.customers.phone} value={customer.phone} />
        </CustomerOverviewSection>

        <CustomerOverviewSection heading={uiText.customers.address}>
          <CustomerFact
            label={uiText.customers.streetAddress}
            value={customer.streetAddress}
          />
          <CustomerFact
            label={uiText.customers.postalCode}
            value={customer.postalCode}
          />
          <CustomerFact label={uiText.customers.city} value={customer.city} />
        </CustomerOverviewSection>

        <CustomerOverviewSection heading={uiText.customers.pricing}>
          <CustomerFact
            label={uiText.customers.hourlyRate}
            value={formatHourlyRate(effectiveHourlyRateCents)}
          />
          <CustomerFact
            label={uiText.customers.pricingSource}
            value={
              customer.hourlyRateOverrideCents === null
                ? uiText.customers.companyDefaultPricing
                : uiText.customers.customerSpecificPricing
            }
          />
        </CustomerOverviewSection>

        <CustomerOverviewSection
          className={styles.wideSection}
          heading={uiText.customers.additionalInformation}
        >
          <CustomerFact
            className={styles.wideFact}
            label={uiText.customers.comment}
            value={customer.comment}
          />
        </CustomerOverviewSection>

        <CustomerOverviewSection
          className={styles.wideSection}
          heading={uiText.customers.recordInformation}
        >
          <CustomerFact
            label={uiText.customers.created}
            value={formatCustomerTimestamp(customer.createdAt)}
          />
          <CustomerFact
            label={uiText.customers.updated}
            value={formatCustomerTimestamp(customer.updatedAt)}
          />
        </CustomerOverviewSection>
      </div>
    </article>
  );
}

interface CustomerOverviewSectionProps {
  children: React.ReactNode;
  className?: string | undefined;
  heading: string;
}

function CustomerOverviewSection({
  children,
  className,
  heading,
}: CustomerOverviewSectionProps): React.JSX.Element {
  return (
    <section className={`${styles.section} ${className ?? ''}`}>
      <h3>{heading}</h3>
      <dl>{children}</dl>
    </section>
  );
}

interface CustomerFactProps {
  className?: string | undefined;
  label: string;
  value: string;
}

function CustomerFact({
  className,
  label,
  value,
}: CustomerFactProps): React.JSX.Element {
  return (
    <div className={`${styles.fact} ${className ?? ''}`}>
      <dt>{label}</dt>
      <dd>{value.trim().length === 0 ? uiText.customers.noValue : value}</dd>
    </div>
  );
}

function formatHourlyRate(value: number | null): string {
  if (value === null) {
    return uiText.customers.noValue;
  }

  return `${centsToEuroInput(value)} €/h`;
}
