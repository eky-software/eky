import type { Customer } from '@eky/api-client';

import { formatCustomerTimestamp } from './customerDisplay.js';
import styles from './CustomerRecordInformationSection.module.css';
import { uiText } from '../../i18n/fi.js';

interface CustomerRecordInformationSectionProps {
  customer: Customer;
}

export function CustomerRecordInformationSection({
  customer,
}: CustomerRecordInformationSectionProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="customer-record-information-heading"
      className={`panel ${styles.panel}`}
    >
      <div className="panel-header">
        <h2 id="customer-record-information-heading">
          {uiText.customers.recordInformation}
        </h2>
      </div>

      <dl className={styles.facts}>
        <CustomerRecordFact
          label={uiText.customers.created}
          value={formatCustomerTimestamp(customer.createdAt)}
        />
        <CustomerRecordFact
          label={uiText.customers.updated}
          value={formatCustomerTimestamp(customer.updatedAt)}
        />
      </dl>
    </section>
  );
}

interface CustomerRecordFactProps {
  label: string;
  value: string;
}

function CustomerRecordFact({
  label,
  value,
}: CustomerRecordFactProps): React.JSX.Element {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
