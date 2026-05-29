import { uiText } from '../i18n/fi.js';

export function TopBar(): React.JSX.Element {
  return (
    <header className="top-bar">
      <div>
        <p className="top-bar-kicker">{uiText.layout.appMode}</p>
        <h1>{uiText.modules.customers}</h1>
      </div>
      <div className="top-bar-status" aria-label={uiText.layout.currentRuntimeMode}>
        <span className="status-dot" />
        {uiText.layout.localBackend}
      </div>
    </header>
  );
}
