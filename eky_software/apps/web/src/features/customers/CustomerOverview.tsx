import type { Customer } from '@eky/api-client';

import {
  formatCustomerTimestamp,
  getCustomerStatusLabel,
  getCustomerTypeLabel,
} from './customerDisplay.js';
import type { CustomerDefaultHourlyRateState } from './customerDefaultHourlyRateState.js';
import { ManagedHousingCompaniesSection } from './ManagedHousingCompaniesSection.js';
import styles from './CustomerOverview.module.css';
import { centsToEuroInput } from '../../shared/money/hourlyRateInput.js';
import { uiText } from '../../i18n/fi.js';

interface CustomerOverviewProps {
  customer: Customer;
  customers: Customer[];
  defaultHourlyRateState: CustomerDefaultHourlyRateState;
  onCreateInvoice(customerId: string): void;
  onEdit(): void;
  onOpenRelatedCustomer(customerId: string): void;
}

export function CustomerOverview({
  customer,
  customers,
  defaultHourlyRateState,
  onCreateInvoice,
  onEdit,
  onOpenRelatedCustomer,
}: CustomerOverviewProps): React.JSX.Element {
  const propertyManager = customers.find(
    (candidate) =>
      candidate.companyId === customer.companyId &&
      candidate.id === customer.managedByCustomerId &&
      candidate.customerType === 'propertyManager',
  );
  const managedHousingCompanies = customers.filter(
    (candidate) =>
      candidate.companyId === customer.companyId &&
      candidate.customerType === 'housingCompany' &&
      candidate.managedByCustomerId === customer.id,
  );
  const pricing = getCustomerPricing(customer, defaultHourlyRateState);

  return (
    <article className={styles.overview} aria-labelledby="customer-overview-heading">
      <header className={styles.header}>
        <div className={styles.heading}>
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
          {customer.status === 'active' ? (
            <button
              className="ghost-button"
              onClick={() => onCreateInvoice(customer.id)}
              type="button"
            >
              {uiText.customers.createInvoice}
            </button>
          ) : null}
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
            <CustomerRelationshipFact
              customer={propertyManager}
              onOpenRelatedCustomer={onOpenRelatedCustomer}
            />
          ) : null}
        </CustomerOverviewSection>

        {customer.customerType === 'propertyManager' ? (
          <ManagedHousingCompaniesSection
            housingCompanies={managedHousingCompanies}
            onOpenCustomer={onOpenRelatedCustomer}
          />
        ) : null}

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
            value={pricing.value}
          />
          {pricing.source === null ? null : (
            <CustomerFact
              label={uiText.customers.pricingSource}
              value={pricing.source}
            />
          )}
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

interface CustomerRelationshipFactProps {
  customer: Customer | undefined;
  onOpenRelatedCustomer(customerId: string): void;
}

function CustomerRelationshipFact({
  customer,
  onOpenRelatedCustomer,
}: CustomerRelationshipFactProps): React.JSX.Element {
  return (
    <div className={styles.fact}>
      <dt>{uiText.customers.managedByPropertyManager}</dt>
      <dd>
        {customer === undefined ? (
          uiText.customers.noPropertyManager
        ) : (
          <button
            aria-label={uiText.customers.openCustomerCardWithName(
              customer.name,
            )}
            className={styles.relationshipLink}
            onClick={() => onOpenRelatedCustomer(customer.id)}
            type="button"
          >
            {customer.customerNumber} · {customer.name}
          </button>
        )}
      </dd>
    </div>
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

interface CustomerPricing {
  source: string | null;
  value: string;
}

function getCustomerPricing(
  customer: Customer,
  defaultHourlyRateState: CustomerDefaultHourlyRateState,
): CustomerPricing {
  if (customer.hourlyRateOverrideCents !== null) {
    return {
      source: uiText.customers.customerSpecificPricing,
      value: formatHourlyRate(customer.hourlyRateOverrideCents),
    };
  }

  if (defaultHourlyRateState.status === 'loading') {
    return {
      source: null,
      value: uiText.customers.defaultHourlyRateLoading,
    };
  }

  if (defaultHourlyRateState.status === 'failed') {
    return {
      source: null,
      value: uiText.customers.defaultHourlyRateLoadError,
    };
  }

  if (defaultHourlyRateState.valueCents === null) {
    return {
      source: uiText.customers.defaultHourlyRateNotConfigured,
      value: uiText.customers.noValue,
    };
  }

  return {
    source: uiText.customers.companyDefaultPricing,
    value: formatHourlyRate(defaultHourlyRateState.valueCents),
  };
}
