import type { WorkspaceManagementEntry } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import type { WorkspaceSelectorMode } from './workspaceSelectorState.js';
import styles from './WorkspaceSelector.module.css';

interface WorkspaceListProps {
  readonly isBusy: boolean;
  readonly isRecoveryRequired: boolean;
  readonly workspaces: readonly WorkspaceManagementEntry[];
  readonly onModeChange: (
    mode: WorkspaceSelectorMode,
    workspace?: WorkspaceManagementEntry,
  ) => void;
}

export function WorkspaceList({
  isBusy,
  isRecoveryRequired,
  onModeChange,
  workspaces,
}: WorkspaceListProps): React.JSX.Element {
  return (
    <>
      {isBusy ? (
        <p aria-live="polite" className={styles.statusMessage}>
          {uiText.workspaces.processing}
        </p>
      ) : null}
      {isRecoveryRequired ? (
        <p className={styles.warning} role="alert">
          {uiText.workspaces.recoveryRequired}
        </p>
      ) : null}
      {workspaces.length === 0 ? (
        <p className={styles.statusMessage}>{uiText.workspaces.noWorkspaces}</p>
      ) : (
        <ul className={styles.workspaceList}>
          {workspaces.map((workspace) => {
            const unavailable =
              isBusy ||
              isRecoveryRequired ||
              workspace.availability === 'recoveryRequired';
            return (
              <li className={styles.workspaceRow} key={workspace.workspaceId}>
                <div className={styles.workspaceIdentity}>
                  <strong>{workspace.workspaceLabel}</strong>
                  <span>
                    {workspace.isActive
                      ? uiText.workspaces.active
                      : workspace.availability === 'recoveryRequired'
                        ? uiText.workspaces.requiresRecovery
                        : uiText.workspaces.ready}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {!workspace.isActive ? (
                    <button
                      disabled={unavailable}
                      onClick={() => onModeChange('confirmSwitch', workspace)}
                      type="button"
                    >
                      {uiText.workspaces.openWorkspace}
                    </button>
                  ) : null}
                  <button
                    className="ghost-button"
                    disabled={unavailable}
                    onClick={() => onModeChange('rename', workspace)}
                    type="button"
                  >
                    {uiText.workspaces.rename}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.addActions}>
        <button
          disabled={isBusy || isRecoveryRequired}
          onClick={() => onModeChange('create')}
          type="button"
        >
          {uiText.workspaces.addWorkspace}
        </button>
        <button
          className="ghost-button"
          disabled={isBusy || isRecoveryRequired}
          onClick={() => onModeChange('import')}
          type="button"
        >
          {uiText.workspaces.importBackup}
        </button>
      </div>
    </>
  );
}
