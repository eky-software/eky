import type {
  ActivityCategory,
  ActivityItem,
  ActivityOutcomeFilter,
} from '@eky/api-client';

import type { ActivityViewQuery } from './ActivityPage.js';
import styles from './ActivityPageView.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ActivityPageViewProps {
  errorMessage: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading: boolean;
  items: ActivityItem[];
  onCategoryChange(category: ActivityCategory): void;
  onMonthChange(month: string): void;
  onNextPage(): void;
  onOutcomeChange(outcome: ActivityOutcomeFilter): void;
  onPageSizeChange(pageSize: 20 | 50 | 100): void;
  onPreviousPage(): void;
  query: ActivityViewQuery;
}

export function ActivityPageView({
  errorMessage,
  hasNextPage,
  hasPreviousPage,
  isLoading,
  items,
  onCategoryChange,
  onMonthChange,
  onNextPage,
  onOutcomeChange,
  onPageSizeChange,
  onPreviousPage,
  query,
}: ActivityPageViewProps): React.JSX.Element {
  return (
    <section className={styles.workspace} aria-labelledby="activity-heading">
      <header className={styles.header}>
        <span className={styles.kicker}>{uiText.activity.kicker}</span>
        <h1 id="activity-heading">{uiText.activity.heading}</h1>
      </header>

      <div className={styles.filters} aria-label={uiText.activity.filters}>
        <label>
          <span>{uiText.activity.month}</span>
          <input
            max="9999-12"
            min="2000-01"
            type="month"
            value={query.month}
            onChange={(event) => {
              if (event.currentTarget.value !== '') {
                onMonthChange(event.currentTarget.value);
              }
            }}
          />
        </label>
        <label>
          <span>{uiText.activity.category}</span>
          <select
            value={query.category}
            onChange={(event) => {
              onCategoryChange(event.currentTarget.value as ActivityCategory);
            }}
          >
            <option value="all">{uiText.activity.categories.all}</option>
            <option value="customers">
              {uiText.activity.categories.customers}
            </option>
            <option value="invoicing">
              {uiText.activity.categories.invoicing}
            </option>
            <option value="companySettings">
              {uiText.activity.categories.companySettings}
            </option>
          </select>
        </label>
        <label>
          <span>{uiText.activity.outcome}</span>
          <select
            value={query.outcome}
            onChange={(event) => {
              onOutcomeChange(
                event.currentTarget.value as ActivityOutcomeFilter,
              );
            }}
          >
            <option value="all">{uiText.activity.outcomes.all}</option>
            <option value="success">{uiText.activity.outcomes.success}</option>
            <option value="failure">{uiText.activity.outcomes.failure}</option>
            <option value="unknown">{uiText.activity.outcomes.unknown}</option>
            <option value="blocked">{uiText.activity.outcomes.blocked}</option>
          </select>
        </label>
        <label>
          <span>{uiText.activity.pageSize}</span>
          <select
            value={query.pageSize}
            onChange={(event) => {
              onPageSizeChange(
                Number(event.currentTarget.value) as 20 | 50 | 100,
              );
            }}
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

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
                <th>{uiText.activity.outcome}</th>
                <th>{uiText.activity.occurredAt}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{getActivityLabel(item.type)}</td>
                  <td>{getReferenceLabel(item)}</td>
                  <td>{uiText.activity.outcomes[item.outcome]}</td>
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

      <nav className={styles.pagination} aria-label={uiText.activity.pagination}>
        <button
          disabled={isLoading || !hasPreviousPage}
          type="button"
          onClick={onPreviousPage}
        >
          {uiText.activity.previousPage}
        </button>
        <span>{uiText.activity.page.replace('{page}', String(query.page))}</span>
        <button
          disabled={isLoading || !hasNextPage}
          type="button"
          onClick={onNextPage}
        >
          {uiText.activity.nextPage}
        </button>
      </nav>
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
