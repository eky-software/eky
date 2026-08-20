import { useEffect, useRef } from 'react';

import type { WorkspaceManagementEntry } from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { WorkspaceList } from './WorkspaceList.js';
import { WorkspaceOperationForm } from './WorkspaceOperationForm.js';
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
  readonly state: WorkspaceSelectorState;
  readonly onClose: () => void;
  readonly onLabelChange: (value: string) => void;
  readonly onModeChange: (
    mode: WorkspaceSelectorMode,
    workspace?: WorkspaceManagementEntry,
  ) => void;
  readonly onRetry: () => void;
  readonly onSubmit: () => void;
}

const focusableSelector =
  'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function WorkspaceManagementDialog({
  onClose,
  onLabelChange,
  onModeChange,
  onRetry,
  onSubmit,
  state,
}: WorkspaceManagementDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const isBusy = isWorkspaceSelectorBusy(state);
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const isRecoveryRequired =
    state.status?.operationState === 'recoveryRequired';
  const selectedWorkspace = state.status?.workspaces.find(
    (workspace) => workspace.workspaceId === state.selectedWorkspaceId,
  );

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
      if (shouldCloseWorkspaceDialog(event.key, busyRef.current)) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
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

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isBusy) onClose();
      }}
    >
      <div
        aria-labelledby="workspace-selector-title"
        aria-modal="true"
        className={styles.dialog}
        data-workspace-dialog="true"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.kicker}>{uiText.workspaces.kicker}</p>
            <h2 id="workspace-selector-title">{uiText.workspaces.heading}</h2>
          </div>
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
        </header>

        {state.loadState === 'loading' ? (
          <p aria-live="polite" className={styles.statusMessage}>
            {uiText.workspaces.loading}
          </p>
        ) : null}
        {state.loadState === 'error' ? (
          <div className={styles.loadError}>
            <p role="alert">{state.errorMessage}</p>
            <button className="ghost-button" onClick={onRetry} type="button">
              {uiText.workspaces.retry}
            </button>
          </div>
        ) : null}
        {state.loadState === 'ready' && state.mode === 'list' ? (
          <WorkspaceList
            isBusy={isBusy}
            isRecoveryRequired={isRecoveryRequired}
            onModeChange={onModeChange}
            workspaces={state.status?.workspaces ?? []}
          />
        ) : null}
        {state.loadState === 'ready' && state.mode !== 'list' ? (
          <WorkspaceOperationForm
            isBusy={isBusy}
            mode={state.mode}
            onBack={() => onModeChange('list')}
            onLabelChange={onLabelChange}
            onSubmit={onSubmit}
            {...(selectedWorkspace === undefined ? {} : { selectedWorkspace })}
            state={state}
          />
        ) : null}
      </div>
    </div>
  );
}
