import type { WorkspaceManagementEntry } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import type {
  WorkspaceSelectorMode,
  WorkspaceSelectorState,
} from './workspaceSelectorState.js';
import styles from './WorkspaceSelector.module.css';

interface WorkspaceOperationFormProps {
  readonly isBusy: boolean;
  readonly mode: Exclude<WorkspaceSelectorMode, 'list'>;
  readonly selectedWorkspace?: WorkspaceManagementEntry;
  readonly state: WorkspaceSelectorState;
  readonly onBack: () => void;
  readonly onLabelChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function WorkspaceOperationForm({
  isBusy,
  mode,
  onBack,
  onLabelChange,
  onSubmit,
  selectedWorkspace,
  state,
}: WorkspaceOperationFormProps): React.JSX.Element {
  const needsLabel = mode === 'create' || mode === 'import' || mode === 'rename';
  return (
    <form
      className={styles.operationForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>{operationTitle(mode)}</h3>
      {mode === 'confirmSwitch' ? (
        <>
          <p>{uiText.workspaces.switchConfirmation}</p>
          <p className={styles.targetWorkspace}>
            {selectedWorkspace?.workspaceLabel}
          </p>
        </>
      ) : null}
      {mode === 'confirmReplace' ? (
        <div className={styles.replacementWarning}>
          <p>
            {uiText.workspaces.replaceConfirmation(
              selectedWorkspace?.workspaceLabel ?? '',
            )}
          </p>
          <ul>
            <li>{uiText.workspaces.replaceSameCompany}</li>
            <li>{uiText.workspaces.replaceRecoveryPoint}</li>
            <li>{uiText.workspaces.replaceRestart}</li>
          </ul>
        </div>
      ) : null}
      {needsLabel ? (
        <label className={styles.label}>
          <span>{uiText.workspaces.workspaceName}</span>
          <input
            data-autofocus="true"
            disabled={isBusy}
            maxLength={80}
            onChange={(event) => onLabelChange(event.currentTarget.value)}
            required
            value={state.labelInput}
          />
        </label>
      ) : null}
      {mode === 'import' ? (
        <p className={styles.helpText}>{uiText.workspaces.importHelp}</p>
      ) : null}
      {state.errorMessage !== null ? (
        <p className={styles.operationError} role="alert">
          {state.errorMessage}
        </p>
      ) : null}
      {isBusy ? (
        <p aria-live="polite" className={styles.statusMessage}>
          {state.isRelaunching
            ? uiText.workspaces.relaunching
            : uiText.workspaces.processing}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <button
          {...(mode === 'confirmReplace' ? { 'data-autofocus': 'true' } : {})}
          className="ghost-button"
          disabled={isBusy}
          onClick={onBack}
          type="button"
        >
          {uiText.workspaces.back}
        </button>
        <button
          {...(mode === 'confirmSwitch' ? { 'data-autofocus': 'true' } : {})}
          disabled={isBusy}
          type="submit"
        >
          {operationButtonLabel(mode)}
        </button>
      </div>
    </form>
  );
}

function operationTitle(mode: Exclude<WorkspaceSelectorMode, 'list'>): string {
  switch (mode) {
    case 'create':
      return uiText.workspaces.addWorkspace;
    case 'import':
      return uiText.workspaces.importBackup;
    case 'rename':
      return uiText.workspaces.rename;
    case 'confirmSwitch':
      return uiText.workspaces.openWorkspace;
    case 'confirmReplace':
      return uiText.workspaces.replaceActiveHeading;
  }
}

function operationButtonLabel(
  mode: Exclude<WorkspaceSelectorMode, 'list'>,
): string {
  switch (mode) {
    case 'create':
      return uiText.workspaces.create;
    case 'import':
      return uiText.workspaces.chooseBackup;
    case 'rename':
      return uiText.workspaces.saveName;
    case 'confirmSwitch':
      return uiText.workspaces.confirmSwitch;
    case 'confirmReplace':
      return uiText.workspaces.continueToBackup;
  }
}
