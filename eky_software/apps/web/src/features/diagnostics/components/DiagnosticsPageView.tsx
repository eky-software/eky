import type {
  DiagnosticEventItem,
  DiagnosticEventLevel,
  DiagnosticEventOutcome,
  DiagnosticReadState,
  DiagnosticEventReadResult,
  RuntimeDiagnosticSummary,
} from '@eky/api-client';
import { useState } from 'react';

import type {
  CreateSupportBundle,
  OpenOperationalLogFolder,
} from '../../../app/desktopBridge.js';
import { formatFinnishDateTime } from '../../../shared/date/formatFinnishDateTime.js';
import styles from './DiagnosticsPageView.module.css';
import { uiText } from '../../../i18n/fi.js';
import { LoadingStatus } from '../../../shared/ui/index.js';
import { DiagnosticEventDetail } from './DiagnosticEventDetail.js';
import { DiagnosticReadNotice } from './DiagnosticReadNotice.js';
import { RuntimeDiagnosticSummaryView } from './RuntimeDiagnosticSummaryView.js';

interface DiagnosticsPageViewProps {
  createSupportBundle?: CreateSupportBundle;
  errorMessage: string | null;
  events: DiagnosticEventItem[];
  isLoading: boolean;
  isSummaryLoading: boolean;
  readState: DiagnosticReadState | null;
  openOperationalLogFolder?: OpenOperationalLogFolder;
  summary: RuntimeDiagnosticSummary | null;
  summaryErrorMessage: string | null;
  page?: Extract<DiagnosticEventReadResult, { state: 'ready' }> | null;
  isStale?: boolean;
  canRetry?: boolean;
  loadOlder?: () => void;
  loadNewer?: () => void;
  loadNewest?: () => void;
  retry?: () => void;
}

export function DiagnosticsPageView({
  createSupportBundle,
  errorMessage,
  events,
  isLoading,
  isSummaryLoading,
  readState,
  openOperationalLogFolder,
  summary,
  summaryErrorMessage,
  page,
  isStale = false,
  canRetry = false,
  loadOlder,
  loadNewer,
  loadNewest,
  retry,
}: DiagnosticsPageViewProps): React.JSX.Element {
  const [desktopErrorMessage, setDesktopErrorMessage] = useState<
    string | null
  >(null);
  const [isCreatingSupportBundle, setIsCreatingSupportBundle] =
    useState(false);
  const [supportBundleCreated, setSupportBundleCreated] = useState(false);

  async function handleOpenLogFolder(): Promise<void> {
    if (openOperationalLogFolder === undefined) {
      return;
    }

    setDesktopErrorMessage(null);
    try {
      await openOperationalLogFolder();
    } catch {
      setDesktopErrorMessage(uiText.diagnostics.openLogFolderError);
    }
  }

  async function handleCreateSupportBundle(): Promise<void> {
    if (createSupportBundle === undefined || isCreatingSupportBundle) {
      return;
    }

    setDesktopErrorMessage(null);
    setSupportBundleCreated(false);
    setIsCreatingSupportBundle(true);
    try {
      const result = await createSupportBundle();
      setSupportBundleCreated(result === 'created');
    } catch {
      setDesktopErrorMessage(uiText.diagnostics.createSupportBundleError);
    } finally {
      setIsCreatingSupportBundle(false);
    }
  }

  return (
    <section
      className={styles.workspace}
      aria-labelledby="diagnostics-heading"
    >
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>{uiText.diagnostics.kicker}</span>
          <h1 id="diagnostics-heading">{uiText.diagnostics.heading}</h1>
          <p>{uiText.diagnostics.description}</p>
        </div>
        {openOperationalLogFolder === undefined &&
        createSupportBundle === undefined ? null : (
          <div className={styles.actions}>
            {openOperationalLogFolder === undefined ? null : (
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  void handleOpenLogFolder();
                }}
                type="button"
              >
                {uiText.diagnostics.openLogFolder}
              </button>
            )}
            {createSupportBundle === undefined ? null : (
              <button
                disabled={isCreatingSupportBundle}
                onClick={() => {
                  void handleCreateSupportBundle();
                }}
                type="button"
              >
                {isCreatingSupportBundle
                  ? uiText.diagnostics.creatingSupportBundle
                  : uiText.diagnostics.createSupportBundle}
              </button>
            )}
          </div>
        )}
      </header>

      {createSupportBundle === undefined ? null : (
        <LoadingStatus active={isCreatingSupportBundle} className={styles.operationStatus}>
          {uiText.diagnostics.creatingSupportBundle}
        </LoadingStatus>
      )}
      {supportBundleCreated ? (
        <p className={`${styles.message} ${styles.success}`} role="status">
          {uiText.diagnostics.supportBundleCreated}
        </p>
      ) : null}
      {desktopErrorMessage !== null ? (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {desktopErrorMessage}
        </p>
      ) : null}
      {isLoading ? (
        <LoadingStatus className={styles.message}>{uiText.diagnostics.loading}</LoadingStatus>
      ) : null}
      {errorMessage !== null ? (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {errorMessage}
        </p>
      ) : null}
      {summaryErrorMessage !== null ? (
        <p className={`${styles.message} ${styles.error}`} role="alert">{summaryErrorMessage}</p>
      ) : null}
      {isSummaryLoading ? (
        <LoadingStatus className={styles.message}>
          {uiText.diagnostics.summaryLoading}
        </LoadingStatus>
      ) : null}
      {!isSummaryLoading && summary !== null ? (
        <RuntimeDiagnosticSummaryView summary={summary} />
      ) : null}
      {loadNewest === undefined ? null : (
        <nav className={styles.browseToolbar} aria-label={uiText.diagnostics.browseLabel}>
          <div className={styles.actions}>
            <button type="button" disabled={isLoading} onClick={loadNewest}>{uiText.diagnostics.browseNewest}</button>
            <button type="button" disabled={isLoading || isStale || page?.newer.state !== 'available'} onClick={loadNewer}>{uiText.diagnostics.browseNewer}</button>
            <button type="button" disabled={isLoading || isStale || page?.older.state !== 'available'} onClick={loadOlder}>{uiText.diagnostics.browseOlder}</button>
            {canRetry ? <button type="button" disabled={isLoading} onClick={retry}>{uiText.diagnostics.browseRetry}</button> : null}
          </div>
          {page == null ? null : <p className={styles.range}>
            {uiText.diagnostics.browseCount(events.length)}
            {events[0] === undefined ? null : <>: <time dateTime={events.at(-1)!.occurredAt}>{formatTimestamp(events.at(-1)!.occurredAt)}</time>
              {' - '}<time dateTime={events[0].occurredAt}>{formatTimestamp(events[0].occurredAt)}</time></>}
          </p>}
        </nav>
      )}
      {readState !== null ? <DiagnosticReadNotice readState={readState} className={styles.message!} /> : null}
      {!isLoading && errorMessage === null && readState?.status === 'complete' && events.length === 0 ? (
        <p className={styles.message}>{page?.older.state === 'available' || page?.newer.state === 'available' ? uiText.diagnostics.browseEmptyPage : uiText.diagnostics.empty}</p>
      ) : null}
      {events.length > 0 ? (
        <div className={styles.tableFrame} aria-busy={isLoading}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{uiText.diagnostics.occurredAt}</th>
                <th>{uiText.diagnostics.component}</th>
                <th>{uiText.diagnostics.event}</th>
                <th>{uiText.diagnostics.status}</th>
                <th>{uiText.diagnostics.errorCode}</th>
                <th>{uiText.diagnostics.details}</th>
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
                  <td>
                    <DiagnosticEventDetail event={event} />
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
    return styles.errorStatus!;
  }
  if (level === 'warn') {
    return styles.warningStatus!;
  }
  return styles.infoStatus!;
}

function getOutcomeLabel(outcome: DiagnosticEventOutcome): string {
  return uiText.diagnostics.outcomes[outcome];
}

function formatTimestamp(timestamp: string): string {
  return formatFinnishDateTime(timestamp) ?? timestamp;
}
