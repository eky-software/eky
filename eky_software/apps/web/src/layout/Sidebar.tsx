import { uiText } from '../i18n/fi.js';
import type { AppView } from '../app/App.js';

type SidebarNavItem =
  | {
      id: AppView;
      label: string;
      status: 'available';
    }
  | {
      id: 'sites' | 'workOrders';
      label: string;
      status: 'soon';
    };

interface SidebarNavSection {
  items: SidebarNavItem[];
  label: string;
}

const navSections: SidebarNavSection[] = [
  {
    label: uiText.layout.primaryNavigation,
    items: [
      { id: 'customers', label: uiText.modules.customers, status: 'available' },
      { id: 'sites', label: uiText.modules.sites, status: 'soon' },
      { id: 'workOrders', label: uiText.modules.workOrders, status: 'soon' },
      { id: 'invoicing', label: uiText.modules.invoicing, status: 'available' },
    ],
  },
  {
    label: uiText.layout.companyNavigation,
    items: [
      {
        id: 'companySettings',
        label: uiText.modules.companySettings,
        status: 'available',
      },
    ],
  },
];

interface SidebarProps {
  activeView: AppView;
  isCollapsed: boolean;
  onToggle(): void;
  onViewChange(view: AppView): void;
}

export function Sidebar({
  activeView,
  isCollapsed,
  onToggle,
  onViewChange,
}: SidebarProps): React.JSX.Element {
  const toggleLabel = isCollapsed
    ? uiText.layout.expandSidebar
    : uiText.layout.collapseSidebar;

  return (
    <aside
      className={`sidebar${isCollapsed ? ' sidebar-collapsed' : ''}`}
      aria-label={uiText.layout.modules}
    >
      <div className="brand">
        <span className="brand-mark">E</span>
        <div className="brand-copy">
          <strong>Eky</strong>
          <span>Paikallinen</span>
        </div>
      </div>

      <button
        aria-expanded={!isCollapsed}
        aria-label={toggleLabel}
        className="sidebar-toggle"
        onClick={onToggle}
        title={toggleLabel}
        type="button"
      >
        <span aria-hidden="true">{isCollapsed ? '›' : '‹'}</span>
      </button>

      <nav className="module-nav" aria-hidden={isCollapsed}>
        {navSections.map((section) => (
          <div className="nav-section" key={section.label}>
            <p className="nav-section-label">{section.label}</p>
            {section.items.map((module) => (
              <button
                aria-current={module.id === activeView ? 'page' : undefined}
                className="nav-item"
                disabled={module.status !== 'available'}
                key={module.label}
                tabIndex={isCollapsed ? -1 : undefined}
                onClick={() => {
                  if (module.status === 'available') {
                    onViewChange(module.id);
                  }
                }}
                type="button"
              >
                <span>{module.label}</span>
                {module.status === 'soon' ? <small>{uiText.common.later}</small> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
