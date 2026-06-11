import { useState } from 'react';

import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import type { AppView } from '../app/App.js';

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

  return (
    <div className={`app-shell${isSidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      <Sidebar
        activeView={activeView}
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed((isCollapsed) => !isCollapsed)}
        onViewChange={onViewChange}
      />
      <div className="app-workspace">
        <TopBar title={title} />
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
