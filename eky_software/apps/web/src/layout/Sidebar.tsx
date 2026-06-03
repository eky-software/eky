import { uiText } from '../i18n/fi.js';

interface SidebarNavItem {
  label: string;
  status: 'active' | 'soon';
}

interface SidebarNavSection {
  items: SidebarNavItem[];
  label: string;
}

const navSections: SidebarNavSection[] = [
  {
    label: uiText.layout.primaryNavigation,
    items: [
      { label: uiText.modules.customers, status: 'active' },
      { label: uiText.modules.sites, status: 'soon' },
      { label: uiText.modules.workOrders, status: 'soon' },
      { label: uiText.modules.invoicing, status: 'soon' },
    ],
  },
  {
    label: uiText.layout.companyNavigation,
    items: [{ label: uiText.modules.companySettings, status: 'soon' }],
  },
];

export function Sidebar(): React.JSX.Element {
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
                aria-current={module.status === 'active' ? 'page' : undefined}
                className="nav-item"
                disabled={module.status !== 'active'}
                key={module.label}
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
