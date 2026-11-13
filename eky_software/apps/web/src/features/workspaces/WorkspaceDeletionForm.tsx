import {
  WORKSPACE_LABEL_MAX_CODE_POINTS,
  matchesWorkspaceDeletionLabel,
  readWorkspaceDeletionRequest,
  workspaceDeletionProtocolVersion,
  type WorkspaceDeletionRequest,
  type WorkspaceManagementEntry,
} from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { LoadingStatus } from '../../shared/ui/index.js';
import styles from './WorkspaceDeletionForm.module.css';

interface WorkspaceDeletionFormProps {
  readonly target: Pick<WorkspaceManagementEntry, 'workspaceId' | 'workspaceLabel'>;
  readonly showWorkspaceIdentifier: boolean;
  readonly backupAvailable: boolean;
  readonly typedLabel: string;
  readonly backupChoice: WorkspaceDeletionRequest['backupChoice'] | null;
  readonly isBusy: boolean;
  readonly errorMessage: string | null;
  readonly progressMessage?: string | null;
  readonly onTypedLabelChange: (value: string) => void;
  readonly onBackupChoiceChange: (value: WorkspaceDeletionRequest['backupChoice']) => void;
  readonly onBack: () => void;
  readonly onSubmit: (request: Readonly<WorkspaceDeletionRequest>) => void;
}

export function WorkspaceDeletionForm(props: WorkspaceDeletionFormProps): React.JSX.Element {
  const { target, backupChoice, backupAvailable, isBusy } = props;
  const id = `workspace-deletion-${target.workspaceId}`;
  const text = uiText.workspaces;
  let request: Readonly<WorkspaceDeletionRequest> | undefined;
  if (matchesWorkspaceDeletionLabel(props.typedLabel, target.workspaceLabel) &&
      (backupChoice === 'explicitDataLoss' || (backupChoice === 'createBackup' && backupAvailable))) {
    try {
      request = readWorkspaceDeletionRequest({ formatVersion: workspaceDeletionProtocolVersion, workspaceId: target.workspaceId,
        typedLabel: props.typedLabel, backupChoice });
    } catch { /* Invalid or stale form input never starts a request. */ }
  }
  return (
    <form aria-busy={isBusy} aria-labelledby={`${id}-title`} className={styles.form}
      onSubmit={event => {
        event.preventDefault();
        if (!isBusy && request !== undefined) props.onSubmit(request);
      }}>
      <h3 id={`${id}-title`}>{text.deleteHeading}</h3>
      <div className={styles.target}>
        <strong>{target.workspaceLabel}</strong>
        {props.showWorkspaceIdentifier ? <span>{text.workspaceIdentifier(target.workspaceId)}</span> : null}
      </div>
      <div className={styles.scope} id={`${id}-scope`}>
        <p>{text.deleteRemovedData}</p>
        <p>{text.deleteRetainedData}</p>
      </div>
      <label className={styles.label}>
        <span>{text.deleteTypedLabel}</span>
        <input type="text" autoComplete="off" data-autofocus="true" disabled={isBusy} required
          aria-describedby={`${id}-name-help ${id}-scope`}
          maxLength={WORKSPACE_LABEL_MAX_CODE_POINTS * 2}
          value={props.typedLabel} onChange={event => {
            if (!isBusy) props.onTypedLabelChange(event.currentTarget.value);
          }} />
      </label>
      <p className={styles.help} id={`${id}-name-help`}>{text.deleteTypedLabelHelp}</p>
      <fieldset className={styles.choices} disabled={isBusy}>
        <legend>{text.deleteBackupChoice}</legend>
        {backupAvailable ? (
          <label className={styles.choice}>
            <input type="radio" name={`${id}-backup`} value="createBackup" required
              checked={backupChoice === 'createBackup'} onChange={() => {
                if (!isBusy) props.onBackupChoiceChange('createBackup');
              }} />
            <span>{text.deleteCreateBackup}</span>
          </label>
        ) : <p className={styles.help}>{text.deleteBackupUnavailable}</p>}
        <label className={styles.choice}>
          <input type="radio" name={`${id}-backup`} value="explicitDataLoss" required
            checked={backupChoice === 'explicitDataLoss'} onChange={() => {
              if (!isBusy) props.onBackupChoiceChange('explicitDataLoss');
            }} />
          <span>{text.deleteWithoutBackup}</span>
        </label>
      </fieldset>
      {props.errorMessage !== null ? <p className={styles.error} role="alert">{props.errorMessage}</p> : null}
      <LoadingStatus active={isBusy} className={styles.status}>{props.progressMessage ?? text.deleteProcessing}</LoadingStatus>
      <div className={styles.actions}>
        <button type="button" className="ghost-button" disabled={isBusy}
          onClick={() => { if (!isBusy) props.onBack(); }}>{text.back}</button>
        <button type="submit" disabled={isBusy || request === undefined}>{text.deleteContinue}</button>
      </div>
    </form>
  );
}
