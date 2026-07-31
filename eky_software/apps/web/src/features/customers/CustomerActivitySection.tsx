import type { CustomerActivityEntry } from '@eky/api-client';

import type { CustomerActivityState } from './hooks/useCustomerActivity.js';
import { formatCustomerTimestamp } from './customerDisplay.js';
import styles from './CustomerActivitySection.module.css';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerActivitySectionProps {
  activityState: CustomerActivityState;
}

export function CustomerActivitySection({
  activityState,
}: CustomerActivitySectionProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="customer-activity-heading"
      className={`panel ${styles.panel}`}
    >
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.history}</p>
          <h2 id="customer-activity-heading">
            {uiText.customers.customerActivity}
          </h2>
        </div>
      </div>

      {activityState.isLoading ? (
        <p className="message">{uiText.customers.activityLoading}</p>
      ) : null}
      {activityState.errorMessage !== null ? (
        <MessageBanner variant="error">
          {activityState.errorMessage}
        </MessageBanner>
      ) : null}
      {!activityState.isLoading &&
      activityState.errorMessage === null &&
      activityState.activityEntries.length === 0 ? (
        <p className="message">{uiText.customers.activityEmpty}</p>
      ) : null}
      {!activityState.isLoading &&
      activityState.errorMessage === null &&
      activityState.activityEntries.length > 0 ? (
        <ol className={styles.list}>
          {activityState.activityEntries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{getCustomerActivityDescription(entry)}</strong>
                <time dateTime={entry.occurredAt}>
                  {formatCustomerTimestamp(entry.occurredAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {activityState.hasNextPage || activityState.hasPreviousPage ? (
        <nav
          aria-label={uiText.customers.activityPagination}
          className={styles.pagination}
        >
          <button
            className="ghost-button"
            disabled={!activityState.hasPreviousPage}
            onClick={() => activityState.goToPage(activityState.page - 1)}
            type="button"
          >
            {uiText.customers.previousPage}
          </button>
          <span>{uiText.customers.currentPage(activityState.page)}</span>
          <button
            className="ghost-button"
            disabled={!activityState.hasNextPage}
            onClick={() => activityState.goToPage(activityState.page + 1)}
            type="button"
          >
            {uiText.customers.nextPage}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function getCustomerActivityDescription(entry: CustomerActivityEntry): string {
  if (entry.action === 'customer.created') {
    return uiText.customers.activityDescriptions.created;
  }
  if (entry.action === 'customer.activated') {
    return uiText.customers.activityDescriptions.activated;
  }
  if (entry.action === 'customer.deactivated') {
    return uiText.customers.activityDescriptions.deactivated;
  }
  if (entry.changeCategories.length === 0) {
    return uiText.customers.activityDescriptions.updated;
  }

  return uiText.customers.activityDescriptions.categories(
    entry.changeCategories.map(
      (category) => uiText.activity.changeCategories[category],
    ),
  );
}
