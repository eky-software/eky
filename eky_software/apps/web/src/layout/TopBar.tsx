import { uiText } from '../i18n/fi.js';
import styles from './TopBar.module.css';

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps): React.JSX.Element {
  return (
    <header className={styles.topBar}>
      <div>
        <p className={styles.kicker}>{uiText.layout.appMode}</p>
        <h1>{title}</h1>
      </div>
      <div className={styles.status} aria-label={uiText.layout.currentRuntimeMode}>
        <span className={styles.statusDot} />
        {uiText.layout.localBackend}
      </div>
    </header>
  );
}
