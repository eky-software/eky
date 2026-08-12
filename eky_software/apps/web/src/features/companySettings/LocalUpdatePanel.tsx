import { useEffect, useState } from 'react';

import type {
  LocalUpdateCapability,
  LocalUpdateStatus,
} from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';
import styles from './LocalUpdatePanel.module.css';

interface LocalUpdatePanelProps {
  capability?: LocalUpdateCapability;
}

type LocalUpdateOperation = 'confirm' | 'discard' | 'select';

export function LocalUpdatePanel({
  capability,
}: LocalUpdatePanelProps): React.JSX.Element {
  const [status, setStatus] = useState<LocalUpdateStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(capability !== undefined);
  const [operation, setOperation] = useState<LocalUpdateOperation | null>(null);

  useEffect(() => {
    let active = true;
    if (capability === undefined) {
      setIsLoading(false);
      setStatus(null);
      return () => {
        active = false;
      };
    }
    setIsLoading(true);
    setErrorMessage(null);
    void capability
      .getStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setErrorMessage(uiText.companySettings.localUpdateError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [capability]);

  async function runOperation(
    kind: LocalUpdateOperation,
  ): Promise<void> {
    if (capability === undefined || operation !== null) return;
    setOperation(kind);
    setErrorMessage(null);
    try {
      if (kind === 'select') {
        await capability.select();
      } else if (kind === 'discard') {
        await capability.discardSelected();
      } else {
        const result = await capability.confirm();
        if (result === 'handoffStarted') {
          return;
        }
      }
      setStatus(await capability.getStatus());
    } catch {
      setErrorMessage(uiText.companySettings.localUpdateError);
    } finally {
      setOperation(null);
    }
  }

  return (
    <LocalUpdatePanelView
      capabilityAvailable={capability !== undefined}
      errorMessage={errorMessage}
      isLoading={isLoading}
      onConfirm={() => runOperation('confirm')}
      onDiscard={() => runOperation('discard')}
      onSelect={() => runOperation('select')}
      operation={operation}
      status={status}
    />
  );
}

interface LocalUpdatePanelViewProps {
  capabilityAvailable: boolean;
  errorMessage: string | null;
  isLoading: boolean;
  onConfirm(): Promise<void>;
  onDiscard(): Promise<void>;
  onSelect(): Promise<void>;
  operation: LocalUpdateOperation | null;
  status: LocalUpdateStatus | null;
}

export function LocalUpdatePanelView({
  capabilityAvailable,
  errorMessage,
  isLoading,
  onConfirm,
  onDiscard,
  onSelect,
  operation,
  status,
}: LocalUpdatePanelViewProps): React.JSX.Element {
  const updateCanStart =
    status?.candidate !== null &&
    status?.currentRollbackPackage === 'ready' &&
    isReplaceablePhase(status?.phase);

  return (
    <div className={styles.section}>
      <div>
        <h4>{uiText.companySettings.localUpdateTitle}</h4>
        <p className={styles.description}>
          {uiText.companySettings.localUpdateDescription}
        </p>
      </div>
      {!capabilityAvailable ? (
        <MessageBanner variant="info">
          {uiText.companySettings.localUpdateUnavailable}
        </MessageBanner>
      ) : null}
      {isLoading ? (
        <MessageBanner variant="info">
          {uiText.companySettings.localUpdateLoading}
        </MessageBanner>
      ) : null}
      {errorMessage ? (
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
      ) : null}
      {status ? (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>{uiText.companySettings.localUpdateCurrentVersion}</dt>
              <dd>{status.current.appVersion}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdateBuild}</dt>
              <dd>{status.current.buildRevision.slice(0, 12)}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdateChannel}</dt>
              <dd>{status.current.releaseChannel}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdateRollbackPackage}</dt>
              <dd>
                {status.currentRollbackPackage === 'ready'
                  ? uiText.companySettings.localUpdateReady
                  : uiText.companySettings.localUpdateMissing}
              </dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdateCandidate}</dt>
              <dd>
                {status.candidate === null
                  ? uiText.companySettings.localUpdateNoCandidate
                  : `${status.candidate.appVersion} / MSI ${status.candidate.msiProductVersion}`}
              </dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdatePhase}</dt>
              <dd>{formatPhase(status.phase)}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.localUpdateRecoveryPoint}</dt>
              <dd>{formatRecoveryPoint(status.recoveryPointState)}</dd>
            </div>
          </dl>
          <MessageBanner variant="info">
            {uiText.companySettings.localUpdateUnsignedWarning}
          </MessageBanner>
          <div className={styles.actions}>
            <button
              className="ghost-button"
              disabled={operation !== null}
              onClick={() => void onSelect()}
              type="button"
            >
              {operation === 'select'
                ? uiText.companySettings.localUpdateSelecting
                : status.currentRollbackPackage === 'missing'
                  ? uiText.companySettings.localUpdateSelectCurrent
                  : uiText.companySettings.localUpdateSelectCandidate}
            </button>
            {status.candidate ? (
              <button
                className="ghost-button"
                disabled={operation !== null || !isReplaceablePhase(status.phase)}
                onClick={() => void onDiscard()}
                type="button"
              >
                {uiText.companySettings.localUpdateDiscard}
              </button>
            ) : null}
            <button
              disabled={operation !== null || !updateCanStart}
              onClick={() => void onConfirm()}
              type="button"
            >
              {operation === 'confirm'
                ? uiText.companySettings.localUpdateStarting
                : uiText.companySettings.localUpdateStart}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function isReplaceablePhase(phase: LocalUpdateStatus['phase'] | undefined): boolean {
  return phase === 'idle' || phase === 'accepted' || phase === 'failed' ||
    phase === 'installerNotApplied' || phase === 'rolledBack';
}

function formatPhase(phase: LocalUpdateStatus['phase']): string {
  const translations: Record<LocalUpdateStatus['phase'], string> = {
    accepted: uiText.companySettings.localUpdatePhaseAccepted,
    awaitingFirstStart: uiText.companySettings.localUpdatePhaseApplying,
    awaitingRollbackFirstStart: uiText.companySettings.localUpdatePhaseRollingBack,
    binaryRollbackPrepared: uiText.companySettings.localUpdatePhaseRollingBack,
    businessRollbackCompleted: uiText.companySettings.localUpdatePhaseRollingBack,
    businessRollbackStarting: uiText.companySettings.localUpdatePhaseRollingBack,
    failed: uiText.companySettings.localUpdatePhaseFailed,
    failedSafe: uiText.companySettings.localUpdatePhaseRecoveryRequired,
    firstStartValidating: uiText.companySettings.localUpdatePhaseValidating,
    idle: uiText.companySettings.localUpdatePhaseIdle,
    installerNotApplied: uiText.companySettings.localUpdatePhaseNotApplied,
    prepared: uiText.companySettings.localUpdatePhasePreparing,
    recoveryPointValidated: uiText.companySettings.localUpdatePhasePreparing,
    recoveryRequired: uiText.companySettings.localUpdatePhaseRecoveryRequired,
    rollbackPackageRequired: uiText.companySettings.localUpdatePhaseRecoveryRequired,
    rollbackRequired: uiText.companySettings.localUpdatePhaseRollingBack,
    rolledBack: uiText.companySettings.localUpdatePhaseRolledBack,
    runtimeStopping: uiText.companySettings.localUpdatePhaseApplying,
  };
  return translations[phase];
}

function formatRecoveryPoint(
  state: LocalUpdateStatus['recoveryPointState'],
): string {
  return {
    notStarted: uiText.companySettings.localUpdateRecoveryNotStarted,
    pending: uiText.companySettings.localUpdateRecoveryPending,
    ready: uiText.companySettings.localUpdateRecoveryReady,
    recoveryRequired: uiText.companySettings.localUpdateRecoveryRequired,
  }[state];
}
