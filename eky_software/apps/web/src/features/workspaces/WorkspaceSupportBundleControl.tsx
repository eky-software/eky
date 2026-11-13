import { uiText } from '../../i18n/fi.js';
import { LoadingStatus } from '../../shared/ui/index.js';
import type { WorkspaceSupportBundleController } from './useWorkspaceSupportBundle.js';
import styles from './WorkspaceSupportBundleControl.module.css';

interface WorkspaceSupportBundleControlProps {
  readonly controller: WorkspaceSupportBundleController;
}

export function WorkspaceSupportBundleControl({
  controller,
}: WorkspaceSupportBundleControlProps): React.JSX.Element {
  const { state } = controller;

  return (
    <div className={styles.control}>
      <button className="ghost-button" disabled={controller.disabled}
        onClick={controller.create} type="button">
        {uiText.diagnostics.createSupportBundle}
      </button>
      <LoadingStatus active={state === 'pending'} className={styles.status}>
        {uiText.diagnostics.creatingSupportBundle}
      </LoadingStatus>
      {state === 'created' ? <p className={styles.status} role="status">
        {uiText.diagnostics.supportBundleCreated}
      </p> : null}
      {state === 'failed' ? <p className={styles.error} role="alert">
        {uiText.diagnostics.createSupportBundleError}
      </p> : null}
    </div>
  );
}
