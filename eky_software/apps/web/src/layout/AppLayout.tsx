import { useState } from 'react';

import { WorkspaceManagementDialog } from '../features/workspaces/WorkspaceManagementDialog.js';
import { useWorkspaceManagement } from '../features/workspaces/useWorkspaceManagement.js';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import styles from './AppLayout.module.css';
import type { AppView } from '../app/appNavigation.js';
import type { WorkspaceManagementCapability } from '../app/desktopWorkspaceManagement.js';
import { uiText } from '../i18n/fi.js';

interface AppLayoutProps {
  activeView: AppView;
  children: React.ReactNode;
  onViewChange(view: AppView): void;
  title: string;
  workspaceManagementCapability?: WorkspaceManagementCapability;
}

export function AppLayout({
  activeView,
  children,
  onViewChange,
  title,
  workspaceManagementCapability,
}: AppLayoutProps): React.JSX.Element {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const workspaceManagement = useWorkspaceManagement(
    workspaceManagementCapability,
  );
  const toggleLabel = isSidebarCollapsed
    ? uiText.layout.expandSidebar
    : uiText.layout.collapseSidebar;

  return (
    <div
      className={`${styles.shell}${isSidebarCollapsed ? ` ${styles.collapsed}` : ''}`}
    >
      <Sidebar
        activeView={activeView}
        activeWorkspaceLabel={workspaceManagement.activeWorkspaceLabel}
        brandState={workspaceManagement.brandState}
        isCollapsed={isSidebarCollapsed}
        isWorkspaceManagementOpen={workspaceManagement.state.isDialogOpen}
        onViewChange={onViewChange}
        onOpenWorkspaceManagement={workspaceManagement.openDialog}
        workspaceManagementAvailable={
          workspaceManagementCapability !== undefined
        }
      />
      <button
        aria-expanded={!isSidebarCollapsed}
        aria-label={toggleLabel}
        className={styles.toggle}
        onClick={() => setIsSidebarCollapsed((isCollapsed) => !isCollapsed)}
        title={toggleLabel}
        type="button"
      >
        <span aria-hidden="true">{isSidebarCollapsed ? '›' : '‹'}</span>
      </button>
      <div className={styles.workspace}>
        <TopBar title={title} />
        <main className={styles.mainArea}>{children}</main>
      </div>
      {workspaceManagementCapability !== undefined &&
      workspaceManagement.state.isDialogOpen ? (
        <WorkspaceManagementDialog
          onClose={workspaceManagement.closeDialog}
          onLabelChange={workspaceManagement.setLabelInput}
          onModeChange={workspaceManagement.selectMode}
          onRetry={workspaceManagement.retryStatus}
          onSubmit={workspaceManagement.submitOperation}
          state={workspaceManagement.state}
        />
      ) : null}
    </div>
  );
}
