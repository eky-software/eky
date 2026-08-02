import type { Customer } from '@eky/api-client';

import styles from './ManagedHousingCompaniesSection.module.css';
import { getCustomerStatusLabel } from './customerDisplay.js';
import { uiText } from '../../i18n/fi.js';

interface ManagedHousingCompaniesSectionProps {
  housingCompanies: readonly Customer[];
  onOpenCustomer(customerId: string): void;
}

export function ManagedHousingCompaniesSection({
  housingCompanies,
  onOpenCustomer,
}: ManagedHousingCompaniesSectionProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="managed-housing-companies-heading"
      className={styles.section}
    >
      <header className={styles.header}>
        <h3 id="managed-housing-companies-heading">
          {uiText.customers.managedHousingCompaniesHeading}
        </h3>
        <span className="count-badge">{housingCompanies.length}</span>
      </header>
      {housingCompanies.length === 0 ? (
        <p className={styles.empty}>
          {uiText.customers.noManagedHousingCompanies}
        </p>
      ) : (
        <div className={styles.list}>
          {housingCompanies.map((housingCompany) => (
            <article className={styles.item} key={housingCompany.id}>
              <div className={styles.identity}>
                <span>{housingCompany.customerNumber}</span>
                <strong>{housingCompany.name}</strong>
              </div>
              <span>{housingCompany.city || uiText.customers.noValue}</span>
              <span
                className={`status-pill status-pill-${housingCompany.status}`}
              >
                {getCustomerStatusLabel(housingCompany.status)}
              </span>
              <button
                aria-label={uiText.customers.openCustomerCardWithName(
                  housingCompany.name,
                )}
                className="ghost-button"
                onClick={() => onOpenCustomer(housingCompany.id)}
                type="button"
              >
                {uiText.customers.openCustomerCard}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
