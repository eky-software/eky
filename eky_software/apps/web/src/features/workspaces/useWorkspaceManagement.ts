import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';

import {
  isWorkspaceLabelExistsError,
  matchesWorkspaceDeletionLabel,
  type WorkspaceDeletionRequest,
  type WorkspaceManagementViewCapability,
  type WorkspaceManagementEntry,
} from '../../app/desktopWorkspaceManagement.js';
import { uiText } from '../../i18n/fi.js';
import { runWorkspaceManagementOperation } from './workspaceManagementOperation.js';
import { tryAcquireWorkspaceOperation } from './workspaceOperationGate.js';
import { WorkspaceStatusLoadController } from './workspaceStatusLoadController.js';
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
  readonly canReplaceActiveWorkspace: boolean;
  readonly canDeleteWorkspace: boolean;
  readonly backupAvailableForSelectedWorkspace: boolean;
  readonly state: WorkspaceSelectorState;
  closeDialog(): void;
  openDialog(): void;
  retryStatus(): void;
  selectMode(
    mode: WorkspaceSelectorMode,
    workspace?: WorkspaceManagementEntry,
  ): void;
  setLabelInput(value: string): void;
  setBackupChoice(value: WorkspaceDeletionRequest['backupChoice']): void;
  submitOperation(): void;
}

const genericWorkspaceError = uiText.workspaces.safeError;

export function useWorkspaceManagement(
  capability?: WorkspaceManagementViewCapability,
  hasBusinessRuntime = false,
): WorkspaceManagementController {
  const [state, dispatch] = useReducer(
    reduceWorkspaceSelectorState,
    initialWorkspaceSelectorState,
  );
  const operationInFlight = useRef(false);
  const operationGeneration = useRef(0);
  const committedCapability = useRef(capability);
  const businessContext = useRef({ present: hasBusinessRuntime, generation: 0 });
  const contextGeneration = businessContext.current.generation;
  const commandsClosed = useRef(false);
  const viewGeneration = operationGeneration.current;
  const statusLoader = useRef(new WorkspaceStatusLoadController());
  const isViewCurrent = useCallback(() => operationGeneration.current === viewGeneration &&
    committedCapability.current === capability && businessContext.current.present === hasBusinessRuntime &&
    businessContext.current.generation === contextGeneration,
  [capability, contextGeneration, hasBusinessRuntime, viewGeneration]);

  // Presentation changes expire UI handlers, not an admitted command's reply.
  useLayoutEffect(() => {
    if (businessContext.current.present === hasBusinessRuntime) return;
    businessContext.current = { present: hasBusinessRuntime, generation: businessContext.current.generation + 1 };
    dispatch({ type: 'contextChanged' });
  }, [hasBusinessRuntime]);

  const loadStatus = useCallback(() => {
    if (capability === undefined || committedCapability.current !== capability ||
        operationInFlight.current || commandsClosed.current) {
      return Promise.resolve();
    }
    return statusLoader.current.load(capability, {
      failed() {
        dispatch({ errorMessage: genericWorkspaceError, type: 'loadFailed' });
      },
      started() {
        operationGeneration.current += 1;
        dispatch({ type: 'loadStarted' });
      },
      succeeded(status) {
        dispatch({ status, type: 'loadSucceeded' });
      },
    });
  }, [capability]);

  useLayoutEffect(() => {
    operationGeneration.current += 1;
    committedCapability.current = capability;
    operationInFlight.current = false;
    commandsClosed.current = false;
    statusLoader.current.invalidate();
    dispatch({ type: 'sessionReset' });
    if (capability !== undefined) void loadStatus();
    return () => {
      operationGeneration.current += 1;
      committedCapability.current = undefined;
      statusLoader.current.invalidate();
    };
  }, [capability, loadStatus]);

  const retryStatus = useCallback(() => {
    void loadStatus();
  }, [loadStatus]);

  const closeDialog = useCallback(() => {
    if (operationInFlight.current) return;
    operationGeneration.current += 1;
    statusLoader.current.invalidate();
    dispatch({ type: 'closeDialog' });
  }, []);

  const openDialog = useCallback(() => {
    if (operationInFlight.current || committedCapability.current !== capability) return;
    operationGeneration.current += 1;
    dispatch({ type: 'openDialog' });
    void loadStatus();
  }, [capability, loadStatus]);

  const selectMode = useCallback(
    (mode: WorkspaceSelectorMode, workspace?: WorkspaceManagementEntry) => {
      if (operationInFlight.current || commandsClosed.current ||
          !isViewCurrent() || state.loadState !== 'ready') return;
      const status = state.status;
      if (status?.formatVersion === 2) {
        if (hasBusinessRuntime || status.operationState !== 'idle' ||
            (mode !== 'list' && mode !== 'confirmDelete') ||
            (workspace !== undefined && (workspace.workspaceId !== status.target.workspaceId ||
              workspace.workspaceLabel !== status.target.workspaceLabel)) ||
            (mode === 'confirmDelete' && capability?.deleteWorkspace === undefined)) return;
      } else if (mode === 'confirmDelete' && (capability?.deleteWorkspace === undefined || workspace === undefined ||
          !status?.workspaces.some(entry => entry.workspaceId === workspace.workspaceId &&
            entry.workspaceLabel === workspace.workspaceLabel))) return;
      operationGeneration.current += 1;
      statusLoader.current.invalidate();
      dispatch({
        labelInput:
          mode === 'rename' && workspace !== undefined
            ? workspace.workspaceLabel
            : '',
        mode,
        type: 'selectMode',
        ...(status?.formatVersion === 2 && status.operationState === 'idle' && mode === 'confirmDelete'
          ? { workspaceId: status.target.workspaceId }
          : workspace === undefined ? {} : { workspaceId: workspace.workspaceId }),
      });
    },
    [capability, hasBusinessRuntime, isViewCurrent, state],
  );

  const setLabelInput = useCallback((value: string) => {
    if (operationInFlight.current || commandsClosed.current || !isViewCurrent()) return;
    operationGeneration.current += 1;
    dispatch({ type: 'labelChanged', value });
  }, [isViewCurrent]);

  const setBackupChoice = useCallback((value: WorkspaceDeletionRequest['backupChoice']) => {
    if (operationInFlight.current || commandsClosed.current || !isViewCurrent() ||
        (state.status?.formatVersion === 2 && value !== 'explicitDataLoss')) return;
    operationGeneration.current += 1;
    dispatch({ type: 'backupChoiceChanged', value });
  }, [isViewCurrent, state.status]);

  const submitOperation = useCallback(() => {
    if (
      capability === undefined ||
      !isViewCurrent() ||
      commandsClosed.current || state.loadState !== 'ready' ||
      operationInFlight.current ||
      state.status === null ||
      isWorkspaceSelectorBusy(state) ||
      state.status.operationState === 'recoveryRequired' ||
      state.mode === 'list'
    ) {
      return;
    }

    const workspaceLabel = state.mode === 'confirmDelete' ? state.labelInput : state.labelInput.trim();
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

    const status = state.status;
    if (status.formatVersion === 2 && (hasBusinessRuntime || status.operationState !== 'idle')) return;
    const selectedWorkspace = status.formatVersion === 1 ? status.workspaces.find(
      (workspace) => workspace.workspaceId === state.selectedWorkspaceId,
    ) : undefined;
    const deletionTarget = status.formatVersion === 2 && status.operationState === 'idle' ? status.target : selectedWorkspace;
    const canCreateDeletionBackup = status.formatVersion === 1 && hasBusinessRuntime && selectedWorkspace?.isActive === true &&
      selectedWorkspace.availability === 'ready' && status.activeWorkspaceId === selectedWorkspace.workspaceId;
    if (state.mode === 'confirmDelete' && (capability.deleteWorkspace === undefined || deletionTarget === undefined ||
        state.selectedWorkspaceId !== deletionTarget.workspaceId ||
        !matchesWorkspaceDeletionLabel(workspaceLabel, deletionTarget.workspaceLabel) ||
        (state.backupChoice !== 'explicitDataLoss' &&
          (state.backupChoice !== 'createBackup' || !canCreateDeletionBackup)))) return;
    if (!tryAcquireWorkspaceOperation(operationInFlight)) return;
    const generation = ++operationGeneration.current;
    const isCurrent = () => operationGeneration.current === generation && committedCapability.current === capability;
    statusLoader.current.invalidate();
    dispatch({ type: 'operationStarted' });
    void runWorkspaceManagementOperation({
      capability,
      mode: state.mode,
      ...(selectedWorkspace === undefined ? {} : { selectedWorkspace }),
      status: state.status,
      workspaceLabel,
      deletionBackupChoice: state.backupChoice,
      canCreateDeletionBackup,
    })
      .then((outcome) => {
        if (!isCurrent()) return;
        if (outcome.type === 'deletion') {
          const result = outcome.result;
          if (result.status === 'completed') {
            if (status.formatVersion === 2) {
              operationInFlight.current = false;
              commandsClosed.current = true;
              dispatch({ type: 'deletionCompleted', message: uiText.workspaces.deleteCompletedClose });
            } else dispatch({ type: 'relaunching', progressMessage: result.navigation === 'selector'
              ? uiText.workspaces.deleteCompletedSelector : uiText.workspaces.deleteCompletedReturn });
          } else if (result.status === 'cancelled' && result.nextAction === 'relaunching') {
            dispatch({ type: 'relaunching', progressMessage: uiText.workspaces.deleteReturnPending });
          } else if (result.status === 'recoveryRequired' || result.nextAction === 'restartRequired') {
            operationInFlight.current = false;
            commandsClosed.current = true;
            dispatch({ type: 'restartRequired', errorMessage: result.status === 'recoveryRequired'
              ? uiText.workspaces.deleteOutcomeUnknown : uiText.workspaces.deleteRestartRequired });
          } else {
            operationInFlight.current = false;
            dispatch(result.status === 'cancelled' ? { type: 'operationCancelled' }
              : { type: 'operationFailed', errorMessage: uiText.workspaces.deleteFailedNoChange });
          }
          return;
        }
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
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        operationInFlight.current = false;
        if (state.mode === 'confirmDelete') {
          commandsClosed.current = true;
          dispatch({ type: 'restartRequired', errorMessage: uiText.workspaces.deleteOutcomeUnknown });
          return;
        }
        dispatch({
          errorMessage: isWorkspaceLabelExistsError(error)
            ? uiText.workspaces.workspaceNameExists
            : genericWorkspaceError,
          type: 'operationFailed',
        });
      });
  }, [capability, hasBusinessRuntime, isViewCurrent, state]);

  const ordinaryStatus = state.status?.formatVersion === 1 ? state.status : undefined;
  const activeWorkspaceLabel =
    ordinaryStatus?.workspaces.find((workspace) => workspace.isActive)
      ?.workspaceLabel ?? uiText.workspaces.fallbackName;

  return Object.freeze({
    activeWorkspaceLabel,
    brandState: deriveWorkspaceBrandState(capability, state),
    canReplaceActiveWorkspace:
      state.status?.formatVersion !== 2 && capability?.replaceActiveFromBackup !== undefined,
    canDeleteWorkspace: capability?.deleteWorkspace !== undefined,
    backupAvailableForSelectedWorkspace: hasBusinessRuntime && ordinaryStatus?.workspaces.some(workspace =>
      workspace.workspaceId === state.selectedWorkspaceId && workspace.isActive &&
      workspace.availability === 'ready' && ordinaryStatus.activeWorkspaceId === workspace.workspaceId) === true,
    closeDialog,
    openDialog,
    retryStatus,
    selectMode,
    setLabelInput,
    setBackupChoice,
    state,
    submitOperation,
  });
}

function deriveWorkspaceBrandState(
  capability: WorkspaceManagementViewCapability | undefined,
  state: WorkspaceSelectorState,
): WorkspaceBrandState {
  if (capability === undefined) return 'browserFallback';
  if (state.requiresRestart) return 'recoveryRequired';
  if (state.loadState === 'loading') return 'loading';
  if (state.loadState === 'error' || state.status === null) return 'unavailable';
  if (state.isSubmitting || state.status.operationState === 'busy') return 'busy';
  if (state.status.operationState === 'recoveryRequired') {
    return 'recoveryRequired';
  }
  return 'idle';
}
