import type { ActivityItem } from '@eky/api-client';

import styles from './ActivityPageView.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ActivityPageViewProps {
  errorMessage: string | null;
  isLoading: boolean;
  items: ActivityItem[];
}

export function ActivityPageView({
  errorMessage,
  isLoading,
  items,
}: ActivityPageViewProps): React.JSX.Element {
  return (
    <section className={styles.workspace} aria-labelledby="activity-heading">
      <header className={styles.header}>
        <span className={styles.kicker}>{uiText.activity.kicker}</span>
        <h1 id="activity-heading">{uiText.activity.heading}</h1>
      </header>

      {isLoading ? (
        <p className={styles.message}>{uiText.activity.loading}</p>
      ) : null}
      {errorMessage !== null ? (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {errorMessage}
        </p>
      ) : null}
      {!isLoading && errorMessage === null && items.length === 0 ? (
        <p className={styles.message}>{uiText.activity.empty}</p>
      ) : null}
      {!isLoading && errorMessage === null && items.length > 0 ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{uiText.activity.event}</th>
                <th>{uiText.activity.reference}</th>
                <th>{uiText.activity.occurredAt}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{getActivityLabel(item.type)}</td>
                  <td>{getReferenceLabel(item)}</td>
                  <td>
                    <time dateTime={item.occurredAt}>
                      {formatActivityTimestamp(item.occurredAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function getActivityLabel(type: ActivityItem['type']): string {
  return uiText.activity.types[type];
}

function getReferenceLabel(item: ActivityItem): string {
  if (item.reference === null) {
    return uiText.activity.noReference;
  }
  const prefix =
    item.reference.kind === 'customerNumber'
      ? uiText.activity.customerNumber
      : uiText.activity.invoiceNumber;
  return `${prefix} ${item.reference.value}`;
}

function formatActivityTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
