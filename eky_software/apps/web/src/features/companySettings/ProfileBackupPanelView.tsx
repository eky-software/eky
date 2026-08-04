import type {
  ProfileBackupInspectionSummary,
  ProfileProtectionStatus,
} from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';
import { ProfileBackupSummary } from './ProfileBackupSummary.js';
import { formatProfileBackupTimestamp } from './profileBackupFormatting.js';
import styles from './ProfileBackupPanel.module.css';

export interface ProfileBackupPanelViewProps {
  capabilityAvailable: boolean;
  errorMessage: string | null;
  inspection: ProfileBackupInspectionSummary | null;
  isBusy: boolean;
  onActivateRestore(): Promise<void>;
  onCreateBackup(): Promise<void>;
  onCreateRecoveryPoint(): Promise<void>;
  onInspectBackup(): Promise<void>;
  onPrepareRestore(): Promise<void>;
  restoreInspection: ProfileBackupInspectionSummary | null;
  status: ProfileProtectionStatus | null;
  successMessage: string | null;
}

export function ProfileBackupPanelView({
  capabilityAvailable,
  errorMessage,
  inspection,
  isBusy,
  onActivateRestore,
  onCreateBackup,
  onCreateRecoveryPoint,
  onInspectBackup,
  onPrepareRestore,
  restoreInspection,
  status,
  successMessage,
}: ProfileBackupPanelViewProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`}>
      <div>
        <p className="panel-kicker">
          {uiText.companySettings.profileBackupKicker}
        </p>
        <h3>{uiText.companySettings.profileBackupHeading}</h3>
        <p className={styles.description}>
          {uiText.companySettings.profileBackupDescription}
        </p>
        <ul className={styles.boundaries}>
          <li>{uiText.companySettings.profileBackupSecretExcluded}</li>
          <li>{uiText.companySettings.profileBackupArchiveExcluded}</li>
          <li>{uiText.companySettings.profileBackupPasswordWarning}</li>
        </ul>
      </div>

      {!capabilityAvailable ? (
        <MessageBanner variant="info">
          {uiText.companySettings.profileBackupDesktopOnly}
        </MessageBanner>
      ) : null}
      {errorMessage ? (
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
      ) : null}
      {successMessage ? (
        <MessageBanner variant="success">{successMessage}</MessageBanner>
      ) : null}
      {capabilityAvailable && status === null && isBusy ? (
        <MessageBanner variant="info">
          {uiText.companySettings.profileBackupLoading}
        </MessageBanner>
      ) : null}

      {capabilityAvailable ? (
        <div className={styles.section}>
          <h4>{uiText.companySettings.profileBackupPortableHeading}</h4>
          <p className={styles.sectionDescription}>
            {uiText.companySettings.profileBackupPortableDescription}
          </p>
          {status?.portableBackup.latestSuccessfulPortableBackupAt ? (
            <p className={styles.lastBackup}>
              <strong>
                {uiText.companySettings.profileBackupLatestSuccessful}
              </strong>{' '}
              {formatProfileBackupTimestamp(
                status.portableBackup.latestSuccessfulPortableBackupAt,
              )}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className="primary-button"
              disabled={isBusy}
              onClick={() => void onCreateBackup()}
              type="button"
            >
              {uiText.companySettings.profileBackupCreate}
            </button>
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onInspectBackup()}
              type="button"
            >
              {uiText.companySettings.profileBackupInspect}
            </button>
            <button
              className="ghost-button"
              disabled={isBusy}
              onClick={() => void onPrepareRestore()}
              type="button"
            >
              {uiText.companySettings.profileBackupRestore}
            </button>
          </div>
          {inspection ? (
            <ProfileBackupSummary
              heading={uiText.companySettings.profileBackupInspectionHeading}
              summary={inspection}
            />
          ) : null}
          {restoreInspection ? (
            <div className={styles.restore}>
              <ProfileBackupSummary
                heading={uiText.companySettings.profileRestoreSummaryHeading}
                summary={restoreInspection}
              />
              <MessageBanner variant="info">
                {uiText.companySettings.profileRestoreReplacementWarning}
              </MessageBanner>
              <p className={styles.restoreNote}>
                {uiText.companySettings.profileRestoreRecoveryPointNote}
              </p>
              <p className={styles.restoreNote}>
                {uiText.companySettings.profileRestoreRestartNote}
              </p>
              <button
                className="danger-button"
                disabled={isBusy}
                onClick={() => void onActivateRestore()}
                type="button"
              >
                {uiText.companySettings.profileRestoreActivate}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {status ? (
        <div className={styles.section}>
          <h4>{uiText.companySettings.profileRecoveryPointsHeading}</h4>
          <dl className={styles.statusGrid}>
            <div>
              <dt>{uiText.companySettings.profileRecoveryPointsStatus}</dt>
              <dd>
                {status.recoveryPoints.availability === 'available'
                  ? uiText.companySettings.profileRecoveryPointsAvailable
                  : uiText.companySettings.profileRecoveryPointsUnavailable}
              </dd>
            </div>
            <div>
              <dt>{uiText.companySettings.profileRecoveryPointsCount}</dt>
              <dd>{status.recoveryPoints.pointCount}</dd>
            </div>
            <div>
              <dt>{uiText.companySettings.profileRecoveryPointsLatest}</dt>
              <dd>
                {status.recoveryPoints.latestValidatedGoodAt
                  ? formatProfileBackupTimestamp(
                      status.recoveryPoints.latestValidatedGoodAt,
                    )
                  : uiText.companySettings.profileRecoveryPointsNone}
              </dd>
            </div>
            <div>
              <dt>{uiText.companySettings.profileRecoveryPointsNextCheck}</dt>
              <dd>
                {status.recoveryPoints.nextAutomaticCheckAt
                  ? formatProfileBackupTimestamp(
                      status.recoveryPoints.nextAutomaticCheckAt,
                    )
                  : uiText.companySettings.profileRecoveryPointsNotScheduled}
              </dd>
            </div>
          </dl>
          {status.recoveryPoints.availability === 'unavailable' ? (
            <MessageBanner variant="info">
              {
                uiText.companySettings
                  .profileRecoveryPointsEncryptionUnavailable
              }
            </MessageBanner>
          ) : null}
          {status.recoveryPoints.budgetState ===
          'protectedPointsExceedBudget' ? (
            <MessageBanner variant="info">
              {uiText.companySettings.profileRecoveryPointsBudgetWarning}
            </MessageBanner>
          ) : null}
          <button
            className="ghost-button"
            disabled={
              isBusy ||
              status.recoveryPoints.availability === 'unavailable'
            }
            onClick={() => void onCreateRecoveryPoint()}
            type="button"
          >
            {uiText.companySettings.profileRecoveryPointCreate}
          </button>
        </div>
      ) : null}
    </section>
  );
}
