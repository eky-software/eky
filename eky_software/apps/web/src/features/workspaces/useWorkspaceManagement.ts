import { useCallback, useEffect, useReducer, useRef } from 'react';

import type {
  WorkspaceManagementCapability,
  WorkspaceManagementEntry,
} from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { runWorkspaceManagementOperation } from './workspaceManagementOperation.js';
import { tryAcquireWorkspaceOperation } from './workspaceOperationGate.js';
import {
  initialWorkspaceSelectorState,
  isWorkspaceSelectorBusy,
  reduceWorkspaceSelectorState,
  type WorkspaceSelectorMode,
  type WorkspaceSelectorState,
} from './workspaceSelectorState.js';

export type WorkspaceBrandState =
  | 'browserFallback'
  | 'busy'
  | 'idle'
  | 'loading'
  | 'recoveryRequired'
  | 'unavailable';

export interface WorkspaceManagementController {
  readonly activeWorkspaceLabel: string;
  readonly brandState: WorkspaceBrandState;
  readonly state: WorkspaceSelectorState;
  closeDialog(): void;
  openDialog(): void;
  retryStatus(): void;
  selectMode(
    mode: WorkspaceSelectorMode,
    workspace?: WorkspaceManagementEntry,
  ): void;
  setLabelInput(value: string): void;
  submitOperation(): void;
}

const genericWorkspaceError = uiText.workspaces.safeError;

export function useWorkspaceManagement(
  capability?: WorkspaceManagementCapability,
): WorkspaceManagementController {
  const [state, dispatch] = useReducer(
    reduceWorkspaceSelectorState,
    initialWorkspaceSelectorState,
  );
  const operationInFlight = useRef(false);

  useEffect(() => {
    operationInFlight.current = false;
    if (capability === undefined) return;
    let isCurrent = true;
    dispatch({ type: 'loadStarted' });
    void capability
      .getStatus()
      .then((status) => {
        if (isCurrent) dispatch({ status, type: 'loadSucceeded' });
      })
      .catch(() => {
        if (isCurrent) {
          dispatch({ errorMessage: genericWorkspaceError, type: 'loadFailed' });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [capability]);

  const retryStatus = useCallback(() => {
    if (capability === undefined || operationInFlight.current) return;
    dispatch({ type: 'loadStarted' });
    void capability
      .getStatus()
      .then((status) => dispatch({ status, type: 'loadSucceeded' }))
      .catch(() =>
        dispatch({ errorMessage: genericWorkspaceError, type: 'loadFailed' }),
      );
  }, [capability]);

  const closeDialog = useCallback(() => {
    dispatch({ type: 'closeDialog' });
  }, []);

  const openDialog = useCallback(() => {
    dispatch({ type: 'openDialog' });
  }, []);

  const selectMode = useCallback(
    (mode: WorkspaceSelectorMode, workspace?: WorkspaceManagementEntry) => {
      dispatch({
        labelInput:
          mode === 'rename' && workspace !== undefined
            ? workspace.workspaceLabel
            : '',
        mode,
        type: 'selectMode',
        ...(workspace === undefined
          ? {}
          : { workspaceId: workspace.workspaceId }),
      });
    },
    [],
  );

  const setLabelInput = useCallback((value: string) => {
    dispatch({ type: 'labelChanged', value });
  }, []);

  const submitOperation = useCallback(() => {
    if (
      capability === undefined ||
      operationInFlight.current ||
      state.status === null ||
      isWorkspaceSelectorBusy(state) ||
      state.status.operationState === 'recoveryRequired' ||
      state.mode === 'list'
    ) {
      return;
    }

    const workspaceLabel = state.labelInput.trim();
    if (
      (state.mode === 'create' ||
        state.mode === 'import' ||
        state.mode === 'rename') &&
      workspaceLabel.length === 0
    ) {
      dispatch({
        errorMessage: uiText.workspaces.workspaceNameRequired,
        type: 'operationFailed',
      });
      return;
    }

    const selectedWorkspace = state.status.workspaces.find(
      (workspace) => workspace.workspaceId === state.selectedWorkspaceId,
    );
    if (!tryAcquireWorkspaceOperation(operationInFlight)) return;
    dispatch({ type: 'operationStarted' });
    void runWorkspaceManagementOperation({
      capability,
      mode: state.mode,
      ...(selectedWorkspace === undefined ? {} : { selectedWorkspace }),
      status: state.status,
      workspaceLabel,
    })
      .then((outcome) => {
        if (outcome.type === 'cancelled') {
          operationInFlight.current = false;
          dispatch({ type: 'operationCancelled' });
        } else if (outcome.type === 'refreshed') {
          operationInFlight.current = false;
          dispatch({ status: outcome.status, type: 'statusRefreshed' });
        } else {
          dispatch({ type: 'relaunching' });
        }
      })
      .catch(() => {
        operationInFlight.current = false;
        dispatch({ errorMessage: genericWorkspaceError, type: 'operationFailed' });
      });
  }, [capability, state]);

  const activeWorkspaceLabel =
    state.status?.workspaces.find((workspace) => workspace.isActive)
      ?.workspaceLabel ?? uiText.workspaces.fallbackName;

  return Object.freeze({
    activeWorkspaceLabel,
    brandState: deriveWorkspaceBrandState(capability, state),
    closeDialog,
    openDialog,
    retryStatus,
    selectMode,
    setLabelInput,
    state,
    submitOperation,
  });
}

function deriveWorkspaceBrandState(
  capability: WorkspaceManagementCapability | undefined,
  state: WorkspaceSelectorState,
): WorkspaceBrandState {
  if (capability === undefined) return 'browserFallback';
  if (state.loadState === 'loading') return 'loading';
  if (state.loadState === 'error' || state.status === null) return 'unavailable';
  if (state.isSubmitting || state.status.operationState === 'busy') return 'busy';
  if (state.status.operationState === 'recoveryRequired') {
    return 'recoveryRequired';
  }
  return 'idle';
}
