import type {
  DiagnosticEventItem,
  DiagnosticEventLevel,
  DiagnosticEventOutcome,
} from '@eky/api-client';

import styles from './DiagnosticsPageView.module.css';
import { uiText } from '../../../i18n/fi.js';

interface DiagnosticsPageViewProps {
  errorMessage: string | null;
  events: DiagnosticEventItem[];
  isLoading: boolean;
}

export function DiagnosticsPageView({
  errorMessage,
  events,
  isLoading,
}: DiagnosticsPageViewProps): React.JSX.Element {
  return (
    <section
      className={styles.workspace}
      aria-labelledby="diagnostics-heading"
    >
      <header className={styles.header}>
        <span className={styles.kicker}>{uiText.diagnostics.kicker}</span>
        <h1 id="diagnostics-heading">{uiText.diagnostics.heading}</h1>
        <p>{uiText.diagnostics.description}</p>
      </header>

      {isLoading ? (
        <p className={styles.message}>{uiText.diagnostics.loading}</p>
      ) : null}
      {errorMessage !== null ? (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {errorMessage}
        </p>
      ) : null}
      {!isLoading && errorMessage === null && events.length === 0 ? (
        <p className={styles.message}>{uiText.diagnostics.empty}</p>
      ) : null}
      {!isLoading && errorMessage === null && events.length > 0 ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{uiText.diagnostics.occurredAt}</th>
                <th>{uiText.diagnostics.component}</th>
                <th>{uiText.diagnostics.event}</th>
                <th>{uiText.diagnostics.status}</th>
                <th>{uiText.diagnostics.errorCode}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.occurredAt}>
                      {formatTimestamp(event.occurredAt)}
                    </time>
                  </td>
                  <td>{uiText.diagnostics.components[event.component]}</td>
                  <td>
                    <code className={styles.eventName}>{event.eventName}</code>
                  </td>
                  <td>
                    <span
                      className={`${styles.status} ${getLevelClass(event.level)}`}
                    >
                      {getOutcomeLabel(event.outcome)}
                    </span>
                  </td>
                  <td>
                    {event.errorCode ?? uiText.diagnostics.noErrorCode}
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

function getLevelClass(level: DiagnosticEventLevel): string {
  if (level === 'error') {
    return styles.errorStatus;
  }
  if (level === 'warn') {
    return styles.warningStatus;
  }
  return styles.infoStatus;
}

function getOutcomeLabel(outcome: DiagnosticEventOutcome): string {
  return uiText.diagnostics.outcomes[outcome];
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

