import { uiText } from '../i18n/fi.js';

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps): React.JSX.Element {
  return (
    <header className="top-bar">
      <div>
        <p className="top-bar-kicker">{uiText.layout.appMode}</p>
        <h1>{title}</h1>
      </div>
      <div className="top-bar-status" aria-label={uiText.layout.currentRuntimeMode}>
        <span className="status-dot" />
        {uiText.layout.localBackend}
      </div>
    </header>
  );
}
