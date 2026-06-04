import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import type { AppView } from '../App.js';

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
  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onViewChange={onViewChange} />
      <div className="app-workspace">
        <TopBar title={title} />
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
