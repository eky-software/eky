import { useEffect, useState } from 'react';

import type {
  InvoicePdfArchiveCapability,
  InvoicePdfArchiveStatus,
} from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { formatFinnishDateTime } from '../../shared/date/formatFinnishDateTime.js';
import { MessageBanner } from '../../shared/ui/index.js';
import styles from './InvoicePdfArchivePanel.module.css';

interface InvoicePdfArchivePanelProps {
  capability?: InvoicePdfArchiveCapability;
}

export function InvoicePdfArchivePanel({
  capability,
}: InvoicePdfArchivePanelProps): React.JSX.Element {
  const [status, setStatus] = useState<InvoicePdfArchiveStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(capability !== undefined);

  useEffect(() => {
    let active = true;

    if (capability === undefined) {
      setIsBusy(false);
      setStatus(null);
      return () => {
        active = false;
      };
    }

    setIsBusy(true);
    setErrorMessage(null);
    void capability
      .getStatus()
      .then((nextStatus) => {
        if (active) {
          setStatus(nextStatus);
        }
      })
      .catch(() => {
        if (active) {
          setErrorMessage(uiText.companySettings.invoicePdfArchiveLoadError);
        }
      })
      .finally(() => {
        if (active) {
          setIsBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [capability]);

  async function run(
    operation: () => Promise<InvoicePdfArchiveStatus | void>,
  ): Promise<void> {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const result = await operation();

      if (result !== undefined) {
        setStatus(result);
      }
    } catch {
      setErrorMessage(uiText.companySettings.invoicePdfArchiveOperationError);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <InvoicePdfArchivePanelView
      capabilityAvailable={capability !== undefined}
      errorMessage={errorMessage}
      isBusy={isBusy}
      onChoose={() =>
        capability === undefined
          ? Promise.resolve()
          : run(() => capability.chooseDirectory())
      }
      onDisable={() =>
        capability === undefined
          ? Promise.resolve()
          : run(() => capability.disable())
      }
      onOpen={() =>
        capability === undefined
          ? Promise.resolve()
          : run(() => capability.openDirectory())
      }
      onRetry={() =>
        capability === undefined
          ? Promise.resolve()
          : run(() => capability.retryPending())
      }
      status={status}
    />
  );
}

interface InvoicePdfArchivePanelViewProps {
  capabilityAvailable: boolean;
  errorMessage: string | null;
  isBusy: boolean;
  onChoose(): Promise<void>;
  onDisable(): Promise<void>;
  onOpen(): Promise<void>;
  onRetry(): Promise<void>;
  status: InvoicePdfArchiveStatus | null;
}

export function InvoicePdfArchivePanelView({
  capabilityAvailable,
  errorMessage,
  isBusy,
  onChoose,
  onDisable,
  onOpen,
  onRetry,
  status,
}: InvoicePdfArchivePanelViewProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`}>
      <div>
        <p className="panel-kicker">
          {uiText.companySettings.invoicePdfArchiveKicker}
        </p>
        <h3>{uiText.companySettings.invoicePdfArchiveHeading}</h3>
        <p className={styles.description}>
          {uiText.companySettings.invoicePdfArchiveDescription}
        </p>
      </div>

      {!capabilityAvailable ? (
        <MessageBanner variant="info">
          {uiText.companySettings.invoicePdfArchiveDesktopOnly}
        </MessageBanner>
      ) : null}
      {errorMessage ? (
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
      ) : null}
      {capabilityAvailable && status === null && isBusy ? (
        <MessageBanner variant="info">
          {uiText.companySettings.invoicePdfArchiveLoading}
        </MessageBanner>
      ) : null}

      {status !== null ? (
        <>
          <dl className={styles.statusGrid}>
            <div>
              <dt>{uiText.companySettings.invoicePdfArchiveStatus}</dt>
              <dd>
                {status.enabled
                  ? uiText.companySettings.invoicePdfArchiveEnabled
                  : uiText.companySettings.invoicePdfArchiveDisabled}
              </dd>
            </div>
            {status.displayName !== null ? (
              <div>
                <dt>{uiText.companySettings.invoicePdfArchiveDirectory}</dt>
                <dd>{status.displayName}</dd>
              </div>
            ) : null}
            <div>
              <dt>{uiText.companySettings.invoicePdfArchivePending}</dt>
              <dd>{status.pendingCount}</dd>
            </div>
            {status.lastArchivedAt !== null ? (
              <div>
                <dt>{uiText.companySettings.invoicePdfArchiveLastSaved}</dt>
                <dd>{formatTimestamp(status.lastArchivedAt)}</dd>
              </div>
            ) : null}
          </dl>
          {status.lastSafeErrorCode !== null ? (
            <MessageBanner variant="info">
              {readArchiveErrorMessage(status.lastSafeErrorCode)}
            </MessageBanner>
          ) : null}
        </>
      ) : null}

      {capabilityAvailable ? (
        <div className={styles.actions}>
          <button
            className="primary-button"
            disabled={isBusy}
            onClick={() => void onChoose()}
            type="button"
          >
            {status?.enabled
              ? uiText.companySettings.invoicePdfArchiveChangeDirectory
              : uiText.companySettings.invoicePdfArchiveChooseDirectory}
          </button>
          {status?.enabled ? (
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onOpen()}
              type="button"
            >
              {uiText.companySettings.invoicePdfArchiveOpenDirectory}
            </button>
          ) : null}
          {(status?.pendingCount ?? 0) > 0 ? (
            <button
              className="ghost-button"
              disabled={isBusy || !status?.enabled}
              onClick={() => void onRetry()}
              type="button"
            >
              {uiText.companySettings.invoicePdfArchiveRetry}
            </button>
          ) : null}
          {status?.enabled ? (
            <button
              className="danger-button"
              disabled={isBusy}
              onClick={() => void onDisable()}
              type="button"
            >
              {uiText.companySettings.invoicePdfArchiveDisable}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function formatTimestamp(value: string): string {
  return formatFinnishDateTime(value) ?? value;
}

function readArchiveErrorMessage(errorCode: string): string {
  return errorCode === 'ARCHIVE_FILE_CONFLICT'
    ? uiText.companySettings.invoicePdfArchiveConflict
    : uiText.companySettings.invoicePdfArchivePendingError;
}
