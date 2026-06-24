import { useState } from 'react';

import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import styles from './AppLayout.module.css';
import type { AppView } from '../app/appNavigation.js';
import { uiText } from '../i18n/fi.js';

interface AppLayoutProps {
  activeView: AppView;
  children: React.ReactNode;
  onViewChange(view: AppView): void;
  title: string;
}

export function AppLayout({
  activeView,
  children,
  onViewChange,
  title,
}: AppLayoutProps): React.JSX.Element {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const toggleLabel = isSidebarCollapsed
    ? uiText.layout.expandSidebar
    : uiText.layout.collapseSidebar;

  return (
    <div
      className={`${styles.shell}${isSidebarCollapsed ? ` ${styles.collapsed}` : ''}`}
    >
      <Sidebar
        activeView={activeView}
        isCollapsed={isSidebarCollapsed}
        onViewChange={onViewChange}
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
    </div>
  );
}
