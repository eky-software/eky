import { uiText } from '../../i18n/fi.js';
import styles from './CompanyOperationsPanel.module.css';
import type { LocalUpdateCapability } from '../../app/desktopBridge.js';
import { LocalUpdatePanel } from './LocalUpdatePanel.js';

interface CompanyOperationsPanelProps {
  localUpdateCapability?: LocalUpdateCapability;
  onOpenActivity(): void;
  onOpenDiagnostics(): void;
}

export function CompanyOperationsPanel({
  localUpdateCapability,
  onOpenActivity,
  onOpenDiagnostics,
}: CompanyOperationsPanelProps): React.JSX.Element {
  return (
    <section className={`panel ${styles.panel}`}>
      <div>
        <p className="panel-kicker">
          {uiText.companySettings.operationsKicker}
        </p>
        <h3>{uiText.companySettings.operationsTitle}</h3>
        <p className={styles.description}>
          {uiText.companySettings.operationsDescription}
        </p>
      </div>
      <div className={styles.actions}>
        <button className="ghost-button" onClick={onOpenActivity} type="button">
          {uiText.modules.activity}
        </button>
        <button
          className="ghost-button"
          onClick={onOpenDiagnostics}
          type="button"
        >
          {uiText.modules.diagnostics}
        </button>
      </div>
      <LocalUpdatePanel
        {...(localUpdateCapability === undefined
          ? {}
          : { capability: localUpdateCapability })}
      />
    </section>
  );
}
