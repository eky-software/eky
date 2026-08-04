import type { RuntimeDiagnosticSummary } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';
import { formatFinnishDateTime } from '../../../shared/date/formatFinnishDateTime.js';
import styles from './RuntimeDiagnosticSummaryView.module.css';

interface RuntimeDiagnosticSummaryViewProps {
  summary: RuntimeDiagnosticSummary;
}

export function RuntimeDiagnosticSummaryView({
  summary,
}: RuntimeDiagnosticSummaryViewProps): React.JSX.Element {
  const databaseSummary =
    summary.databaseHealth === 'ok'
      ? uiText.diagnostics.databaseSummary(
          summary.appliedMigrationCount ?? 0,
          summary.latestMigrationName,
        )
      : uiText.diagnostics.databaseHealth[summary.databaseHealth];

  return (
    <section
      className={styles.summary}
      aria-labelledby="diagnostics-summary-heading"
    >
      <h2 id="diagnostics-summary-heading">
        {uiText.diagnostics.summaryHeading}
      </h2>
      <dl className={styles.grid}>
        <SummaryValue
          label={uiText.diagnostics.version}
          value={summary.appVersion}
        />
        <SummaryValue
          label={uiText.diagnostics.buildRevision}
          value={summary.buildRevision}
        />
        <SummaryValue
          label={uiText.diagnostics.buildCreatedAt}
          value={formatTimestamp(summary.buildCreatedAt)}
        />
        <SummaryValue
          label={uiText.diagnostics.buildState}
          value={
            summary.buildDirty
              ? uiText.diagnostics.dirtyBuild
              : uiText.diagnostics.cleanBuild
          }
        />
        <SummaryValue
          label={uiText.diagnostics.runtimeInstance}
          value={summary.runtimeInstanceId}
        />
        <SummaryValue
          label={uiText.diagnostics.runtime}
          value={`${summary.platform} / ${summary.architecture}`}
        />
        <SummaryValue
          label={uiText.diagnostics.nodeVersion}
          value={summary.nodeVersion}
        />
        {summary.electronVersion === null ? null : (
          <SummaryValue
            label={uiText.diagnostics.electronVersion}
            value={summary.electronVersion}
          />
        )}
        <SummaryValue
          label={uiText.diagnostics.database}
          value={databaseSummary}
        />
      </dl>

      {summary.operationalLogsAvailable ? (
        <div className={styles.logSummary}>
          <h3>{uiText.diagnostics.operationalLogs}</h3>
          <dl className={styles.grid}>
            <SummaryValue
              label={uiText.diagnostics.logPeriod}
              value={formatLogPeriod(summary)}
            />
            <SummaryValue
              label={uiText.diagnostics.logSize}
              value={formatBytes(summary.operationalLogTotalBytes)}
            />
            <SummaryValue
              label={uiText.diagnostics.latestWarning}
              value={formatOptionalTimestamp(summary.latestWarningAt)}
            />
            <SummaryValue
              label={uiText.diagnostics.latestError}
              value={formatOptionalTimestamp(summary.latestErrorAt)}
            />
            <SummaryValue
              label={uiText.diagnostics.latestSecurityEvent}
              value={formatOptionalTimestamp(summary.latestSecurityEventAt)}
            />
          </dl>
        </div>
      ) : (
        <p className={styles.notice}>
          {uiText.diagnostics.desktopLogsOnly}
        </p>
      )}
    </section>
  );
}

function SummaryValue({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className={styles.value}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatLogPeriod(summary: RuntimeDiagnosticSummary): string {
  if (
    summary.operationalLogOldestMonth === null ||
    summary.operationalLogNewestMonth === null
  ) {
    return uiText.diagnostics.noData;
  }
  return summary.operationalLogOldestMonth ===
    summary.operationalLogNewestMonth
    ? summary.operationalLogOldestMonth
    : `${summary.operationalLogOldestMonth}–${summary.operationalLogNewestMonth}`;
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('fi-FI', {
    maximumFractionDigits: 1,
    style: 'unit',
    unit: bytes >= 1_048_576 ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
  }).format(
    bytes >= 1_048_576 ? bytes / 1_048_576 : bytes / 1_024,
  );
}

function formatOptionalTimestamp(timestamp: string | null): string {
  return timestamp === null
    ? uiText.diagnostics.noData
    : formatTimestamp(timestamp);
}

function formatTimestamp(timestamp: string): string {
  return formatFinnishDateTime(timestamp) ?? timestamp;
}
