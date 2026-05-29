const modules = [
  { label: 'Customers', status: 'active' },
  { label: 'Sites', status: 'soon' },
  { label: 'Work orders', status: 'soon' },
  { label: 'Invoicing', status: 'soon' },
] as const;

export function Sidebar(): React.JSX.Element {
  return (
    <aside className="sidebar" aria-label="Modules">
      <div className="brand">
        <span className="brand-mark">E</span>
        <div>
          <strong>Eky</strong>
          <span>Local</span>
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
            {module.status === 'soon' ? <small>Later</small> : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}
