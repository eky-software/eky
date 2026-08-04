import type { ProfileBackupInspectionSummary } from '../../app/desktopBridge.js';
import { uiText } from '../../i18n/fi.js';
import {
  formatProfileBackupByteSize,
  formatProfileBackupTimestamp,
} from './profileBackupFormatting.js';
import styles from './ProfileBackupPanel.module.css';

interface ProfileBackupSummaryProps {
  heading: string;
  summary: ProfileBackupInspectionSummary;
}

export function ProfileBackupSummary({
  heading,
  summary,
}: ProfileBackupSummaryProps): React.JSX.Element {
  return (
    <div className={styles.summary}>
      <h5>{heading}</h5>
      <dl className={styles.summaryGrid}>
        <div>
          <dt>{uiText.companySettings.profileBackupCreatedAt}</dt>
          <dd>{formatProfileBackupTimestamp(summary.createdAt)}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.profileBackupAppVersion}</dt>
          <dd>{summary.appVersion}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.profileBackupDocumentCount}</dt>
          <dd>{summary.documentCount}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.profileBackupBusinessDataSize}</dt>
          <dd>
            {formatProfileBackupByteSize(summary.totalBusinessByteSize)}
          </dd>
        </div>
        <div>
          <dt>{uiText.companySettings.profileBackupProfileMatch}</dt>
          <dd>
            {summary.profileMatchStatus === 'same'
              ? uiText.companySettings.profileBackupProfileSame
              : uiText.companySettings.profileBackupProfileDifferent}
          </dd>
        </div>
      </dl>
    </div>
  );
}
