import { uiText } from '../i18n/fi.js';
import type { AppView } from '../app/App.js';

type SidebarNavItem =
  | {
      id: AppView;
      label: string;
      status: 'available';
    }
  | {
      id: 'invoicing' | 'sites' | 'workOrders';
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
      { id: 'invoicing', label: uiText.modules.invoicing, status: 'soon' },
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
  onViewChange(view: AppView): void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar" aria-label={uiText.layout.modules}>
      <div className="brand">
        <span className="brand-mark">E</span>
        <div>
          <strong>Eky</strong>
          <span>Paikallinen</span>
        </div>
      </div>

      <nav className="module-nav">
        {navSections.map((section) => (
          <div className="nav-section" key={section.label}>
            <p className="nav-section-label">{section.label}</p>
            {section.items.map((module) => (
              <button
                aria-current={module.id === activeView ? 'page' : undefined}
                className="nav-item"
                disabled={module.status !== 'available'}
                key={module.label}
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
