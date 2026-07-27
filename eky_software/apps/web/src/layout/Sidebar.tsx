import { uiText } from '../i18n/fi.js';
import type { AppView } from '../app/appNavigation.js';
import styles from './Sidebar.module.css';

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
  onViewChange(view: AppView): void;
}

export function Sidebar({
  activeView,
  isCollapsed,
  onViewChange,
}: SidebarProps): React.JSX.Element {
  return (
    <aside
      className={`${styles.sidebar}${isCollapsed ? ` ${styles.collapsed}` : ''}`}
      aria-label={uiText.layout.modules}
    >
      <div className={styles.brand}>
        <span className={styles.brandMark}>E</span>
        <div className={styles.brandCopy}>
          <strong>Eky</strong>
          <span>Paikallinen</span>
        </div>
      </div>

      <nav className={styles.navigation} aria-hidden={isCollapsed}>
        {navSections.map((section) => (
          <div className={styles.section} key={section.label}>
            <p className={styles.sectionLabel}>{section.label}</p>
            {section.items.map((module) => (
              <button
                aria-current={
                  isActiveNavigationItem(module.id, activeView)
                    ? 'page'
                    : undefined
                }
                className={styles.navItem}
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

function isActiveNavigationItem(
  itemId: SidebarNavItem['id'],
  activeView: AppView,
): boolean {
  if (itemId === 'companySettings') {
    return (
      activeView === 'companySettings' ||
      activeView === 'activity' ||
      activeView === 'diagnostics'
    );
  }

  return itemId === activeView;
}
