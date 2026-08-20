import { uiText } from '../../i18n/fi.js';
import type { WorkspaceBrandState } from './useWorkspaceManagement.js';
import styles from './WorkspaceSelector.module.css';

interface WorkspaceBrandButtonProps {
  readonly activeWorkspaceLabel: string;
  readonly brandState: WorkspaceBrandState;
  readonly isCollapsed: boolean;
  readonly isDialogOpen: boolean;
  readonly workspaceManagementAvailable: boolean;
  readonly onOpenWorkspaceManagement: () => void;
}

export function WorkspaceBrandButton({
  activeWorkspaceLabel,
  brandState,
  isCollapsed,
  isDialogOpen,
  onOpenWorkspaceManagement,
  workspaceManagementAvailable,
}: WorkspaceBrandButtonProps): React.JSX.Element {
  const accessibleLabel = uiText.workspaces.selectorLabel(
    activeWorkspaceLabel,
  );
  const className = `${workspaceManagementAvailable ? styles.brandButton : styles.brand}${isCollapsed ? ` ${styles.brandCollapsed}` : ''}`;
  const content = (
    <>
      <span className={styles.brandMark} aria-hidden="true">
        E
      </span>
      <span className={styles.brandCopy} aria-hidden={isCollapsed}>
        <strong>
          {activeWorkspaceLabel}
          {workspaceManagementAvailable ? (
            <span className={styles.chevron} aria-hidden="true">
              ▾
            </span>
          ) : null}
        </strong>
        <span>{secondaryLabel(brandState)}</span>
      </span>
    </>
  );

  if (!workspaceManagementAvailable) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      aria-expanded={isDialogOpen}
      aria-haspopup="dialog"
      aria-label={accessibleLabel}
      className={className}
      onClick={onOpenWorkspaceManagement}
      title={accessibleLabel}
      type="button"
    >
      {content}
    </button>
  );
}

function secondaryLabel(state: WorkspaceBrandState): string {
  switch (state) {
    case 'browserFallback':
      return uiText.workspaces.browserSubtitle;
    case 'loading':
      return uiText.workspaces.loadingWorkspace;
    case 'busy':
      return uiText.workspaces.busySubtitle;
    case 'recoveryRequired':
      return uiText.workspaces.recoverySubtitle;
    case 'unavailable':
      return uiText.workspaces.unavailableSubtitle;
    case 'idle':
      return uiText.workspaces.localSubtitle;
  }
}
