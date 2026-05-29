import { uiText } from '../i18n/fi.js';

const modules = [
  { label: uiText.modules.customers, status: 'active' },
  { label: uiText.modules.sites, status: 'soon' },
  { label: uiText.modules.workOrders, status: 'soon' },
  { label: uiText.modules.invoicing, status: 'soon' },
] as const;

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
        {modules.map((module) => (
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
      </nav>
    </aside>
  );
}
