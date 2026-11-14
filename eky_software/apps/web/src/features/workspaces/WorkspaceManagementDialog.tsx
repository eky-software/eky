import { useEffect, useRef } from 'react';

import type { WorkspaceDeletionRequest, WorkspaceManagementEntry } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { LoadingStatus } from '../../shared/ui/index.js';
import { WorkspaceList } from './WorkspaceList.js';
import { WorkspaceOperationForm } from './WorkspaceOperationForm.js';
import { WorkspaceDeletionForm } from './WorkspaceDeletionForm.js';
import {
  resolveWorkspaceDialogFocusTarget,
  shouldCloseWorkspaceDialog,
} from './workspaceDialogKeyboard.js';
import {
  isWorkspaceSelectorBusy,
  type WorkspaceSelectorMode,
  type WorkspaceSelectorState,
} from './workspaceSelectorState.js';
import styles from './WorkspaceSelector.module.css';

interface WorkspaceManagementDialogProps {
  readonly canDeleteWorkspace?: boolean;
  readonly backupAvailableForSelectedWorkspace?: boolean;
  readonly onBackupChoiceChange?: (value: WorkspaceDeletionRequest['backupChoice']) => void;
  readonly canReplaceActiveWorkspace: boolean;
  readonly state: WorkspaceSelectorState;
  readonly onClose?: () => void;
  readonly onLabelChange: (value: string) => void;
  readonly onModeChange: (
    mode: WorkspaceSelectorMode,
    workspace?: WorkspaceManagementEntry,
  ) => void;
  readonly onRetry?: () => void;
  readonly onSubmit: () => void;
  readonly supportBundleControl?: React.ReactNode;
}

const focusableSelector =
  'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function WorkspaceManagementDialog({
  canDeleteWorkspace = false,
  backupAvailableForSelectedWorkspace = false,
  onBackupChoiceChange,
  canReplaceActiveWorkspace,
  onClose,
  onLabelChange,
  onModeChange,
  onRetry,
  onSubmit,
  state,
  supportBundleControl,
}: WorkspaceManagementDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const Container = onClose === undefined ? 'main' : 'div';
  const Heading = onClose === undefined ? 'h1' : 'h2';
  const isBusy = isWorkspaceSelectorBusy(state);
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const isRecoveryRequired =
    state.status?.operationState === 'recoveryRequired';
  const ordinaryStatus = state.status?.formatVersion === 1 ? state.status : undefined;
  const recoveryStatus = state.status?.formatVersion === 2 ? state.status : undefined;
  const ordinarySelectedWorkspace = ordinaryStatus?.workspaces.find(
    (workspace) => workspace.workspaceId === state.selectedWorkspaceId,
  );
  const selectedWorkspace = recoveryStatus?.operationState === 'idle'
    ? state.selectedWorkspaceId === recoveryStatus.target.workspaceId ? recoveryStatus.target : undefined
    : ordinarySelectedWorkspace;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const dialogElement: HTMLDivElement = dialog;
    const previouslyFocused = document.activeElement;
    const animationFrame = window.requestAnimationFrame(() => {
      const autofocusTarget =
        dialogElement.querySelector<HTMLElement>('[data-autofocus]');
      const firstTarget =
        dialogElement.querySelector<HTMLElement>(focusableSelector);
      (autofocusTarget ?? firstTarget ?? dialogElement).focus();
    });

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        onClose !== undefined &&
        shouldCloseWorkspaceDialog(event.key, busyRef.current)
      ) {
        event.preventDefault();
        onClose();
        return;
      }
      if (onClose === undefined || event.key !== 'Tab') return;
      const focusable = [
        ...dialogElement.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const target = resolveWorkspaceDialogFocusTarget({
        activeIndex,
        focusableCount: focusable.length,
        shiftKey: event.shiftKey,
      });
      if (target === null) return;
      event.preventDefault();
      if (focusable.length === 0) {
        dialogElement.focus();
      } else if (target === 'last') {
        focusable.at(-1)?.focus();
      } else {
        focusable[0]?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  useEffect(() => {
    if (state.mode === 'list') return;
    const animationFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>('[data-autofocus]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [state.mode]);

  return (
    <Container
      aria-labelledby={onClose === undefined ? 'workspace-selector-title' : undefined}
      className={onClose === undefined ? styles.selectorPage : styles.backdrop}
      onMouseDown={(event: React.MouseEvent<HTMLElement>) => {
        if (event.currentTarget === event.target && !isBusy) onClose?.();
      }}
    >
      <div
        aria-labelledby="workspace-selector-title"
        aria-modal={onClose === undefined ? undefined : true}
        className={onClose === undefined ? styles.selectorContent : styles.dialog}
        data-workspace-dialog="true"
        ref={dialogRef}
        role={onClose === undefined ? undefined : 'dialog'}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.kicker}>{uiText.workspaces.kicker}</p>
            <Heading id="workspace-selector-title">{recoveryStatus === undefined
              ? uiText.workspaces.heading : uiText.workspaces.recoveryManagementHeading}</Heading>
          </div>
          {onClose !== undefined ? (
            <button
              aria-label={uiText.workspaces.close}
              className={styles.closeButton}
              disabled={isBusy}
              onClick={onClose}
              title={uiText.workspaces.close}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </header>

        {state.deletionCompleted ? <p className={styles.statusMessage} role="status">{state.progressMessage}</p> : null}
        {state.requiresRestart ? <p className={styles.operationError} role="alert">{state.errorMessage}</p> : null}
        {!state.requiresRestart && state.loadState === 'loading' ? (
          <LoadingStatus className={styles.statusMessage}>
            {uiText.workspaces.loading}
          </LoadingStatus>
        ) : null}
        {!state.requiresRestart && state.loadState === 'error' ? (
          <div className={styles.loadError}>
            <p role="alert">{state.errorMessage}</p>
            {onRetry !== undefined ? (
              <button className="ghost-button" onClick={onRetry} type="button">
                {uiText.workspaces.retry}
              </button>
            ) : null}
          </div>
        ) : null}
        {!state.deletionCompleted && !state.requiresRestart && state.loadState === 'ready' && state.mode === 'list' && recoveryStatus !== undefined ? (
          <>
            <p className={styles.warning} role="status">{uiText.workspaces.recoveryManagementPending}</p>
            {recoveryStatus.operationState === 'idle' ? (
              <div className={styles.workspaceRow}>
                <div className={styles.workspaceIdentity}><strong>{recoveryStatus.target.workspaceLabel}</strong></div>
                {canDeleteWorkspace ? <button className="ghost-button" type="button"
                  disabled={isBusy} onClick={() => onModeChange('confirmDelete')}>
                  {uiText.workspaces.deleteWorkspace}
                </button> : null}
              </div>
            ) : (
              <>
                {isRecoveryRequired ? <p className={styles.operationError} role="alert">{uiText.workspaces.recoveryRequired}</p>
                  : <LoadingStatus className={styles.statusMessage}>{uiText.workspaces.processing}</LoadingStatus>}
                {onRetry !== undefined && !state.isSubmitting ? <button className="ghost-button" type="button" onClick={onRetry}>
                  {uiText.workspaces.retry}
                </button> : null}
              </>
            )}
          </>
        ) : null}
        {!state.deletionCompleted && !state.requiresRestart && state.loadState === 'ready' && state.mode === 'list' && ordinaryStatus !== undefined ? (
          <WorkspaceList
            canDeleteWorkspace={canDeleteWorkspace}
            canReplaceActiveWorkspace={canReplaceActiveWorkspace}
            duplicateWorkspaceLabelIds={ordinaryStatus.duplicateWorkspaceLabelIds ?? []}
            isBusy={isBusy}
            isRecoveryRequired={isRecoveryRequired}
            onModeChange={onModeChange}
            workspaces={ordinaryStatus.workspaces}
          />
        ) : null}
        {!state.deletionCompleted && !state.requiresRestart && state.loadState === 'ready' && state.mode === 'confirmDelete' ? (
          canDeleteWorkspace && onBackupChoiceChange !== undefined && selectedWorkspace !== undefined ? (
            <WorkspaceDeletionForm target={selectedWorkspace}
              backupAvailable={recoveryStatus === undefined && backupAvailableForSelectedWorkspace}
              showWorkspaceIdentifier={ordinaryStatus?.duplicateWorkspaceLabelIds?.includes(selectedWorkspace.workspaceId) === true}
              backupChoice={state.backupChoice} typedLabel={state.labelInput} isBusy={isBusy}
              errorMessage={state.errorMessage} progressMessage={state.progressMessage}
              onBack={() => onModeChange('list')} onBackupChoiceChange={onBackupChoiceChange}
              onTypedLabelChange={onLabelChange} onSubmit={() => onSubmit()} />
          ) : <p className={styles.operationError} role="alert">{uiText.workspaces.safeError}</p>
        ) : null}
        {!state.deletionCompleted && !state.requiresRestart && state.loadState === 'ready' && state.mode !== 'list' && state.mode !== 'confirmDelete' && ordinaryStatus !== undefined ? (
          <WorkspaceOperationForm
            isBusy={isBusy}
            mode={state.mode}
            onBack={() => onModeChange('list')}
            onLabelChange={onLabelChange}
            onSubmit={onSubmit}
            {...(ordinarySelectedWorkspace === undefined ? {} : { selectedWorkspace: ordinarySelectedWorkspace })}
            state={state}
          />
        ) : null}
        {supportBundleControl}
      </div>
    </Container>
  );
}
