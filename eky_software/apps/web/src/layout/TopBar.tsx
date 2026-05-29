export function TopBar(): React.JSX.Element {
  return (
    <header className="top-bar">
      <div>
        <p className="top-bar-kicker">Eky Local UI</p>
        <h1>Customers</h1>
      </div>
      <div className="top-bar-status" aria-label="Current runtime mode">
        <span className="status-dot" />
        Local backend
      </div>
    </header>
  );
}
