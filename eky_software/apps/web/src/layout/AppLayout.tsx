import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps): React.JSX.Element {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-workspace">
        <TopBar />
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
