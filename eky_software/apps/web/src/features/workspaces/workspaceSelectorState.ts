import type { WorkspaceDeletionRequest, WorkspaceManagementViewStatus } from '../../app/desktopWorkspaceManagement.js';

export type WorkspaceSelectorMode =
  | 'confirmDelete'
  | 'confirmSwitch'
  | 'confirmReplace'
  | 'create'
  | 'import'
  | 'list'
  | 'rename';

export interface WorkspaceSelectorState {
  readonly backupChoice: WorkspaceDeletionRequest['backupChoice'] | null;
  readonly deletionCompleted: boolean;
  readonly requiresRestart: boolean;
  readonly progressMessage: string | null;
  readonly errorMessage: string | null;
  readonly isDialogOpen: boolean;
  readonly isSubmitting: boolean;
  readonly isRelaunching: boolean;
  readonly labelInput: string;
  readonly loadState: 'error' | 'loading' | 'ready';
  readonly mode: WorkspaceSelectorMode;
  readonly selectedWorkspaceId: string | null;
  readonly status: WorkspaceManagementViewStatus | null;
}

export type WorkspaceSelectorAction =
  | { readonly type: 'sessionReset' }
  | { readonly type: 'contextChanged' }
  | { readonly type: 'backupChoiceChanged'; readonly value: WorkspaceDeletionRequest['backupChoice'] }
  | { readonly type: 'restartRequired'; readonly errorMessage: string }
  | { readonly type: 'deletionCompleted'; readonly message: string }
  | { readonly type: 'closeDialog' }
  | { readonly type: 'labelChanged'; readonly value: string }
  | { readonly type: 'loadFailed'; readonly errorMessage: string }
  | { readonly type: 'loadStarted' }
  | {
      readonly type: 'loadSucceeded';
      readonly status: WorkspaceManagementViewStatus;
    }
  | { readonly type: 'openDialog' }
  | { readonly type: 'operationCancelled' }
  | { readonly type: 'operationFailed'; readonly errorMessage: string }
  | { readonly type: 'operationStarted' }
  | { readonly type: 'relaunching'; readonly progressMessage?: string }
  | {
      readonly type: 'selectMode';
      readonly labelInput?: string;
      readonly mode: WorkspaceSelectorMode;
      readonly workspaceId?: string;
    }
  | {
      readonly type: 'statusRefreshed';
      readonly status: WorkspaceManagementViewStatus;
    };

export const initialWorkspaceSelectorState: WorkspaceSelectorState = {
  backupChoice: null,
  deletionCompleted: false,
  requiresRestart: false,
  progressMessage: null,
  errorMessage: null,
  isDialogOpen: false,
  isSubmitting: false,
  isRelaunching: false,
  labelInput: '',
  loadState: 'loading',
  mode: 'list',
  selectedWorkspaceId: null,
  status: null,
};

export function reduceWorkspaceSelectorState(
  state: WorkspaceSelectorState,
  action: WorkspaceSelectorAction,
): WorkspaceSelectorState {
  if (state.deletionCompleted && action.type !== 'sessionReset') return state;
  switch (action.type) {
    case 'sessionReset':
      return { ...initialWorkspaceSelectorState };
    case 'contextChanged':
      return { ...state, backupChoice: state.isSubmitting ? state.backupChoice : null };
    case 'deletionCompleted':
      return { ...state, deletionCompleted: true, backupChoice: null, labelInput: '',
        selectedWorkspaceId: null, mode: 'list', isSubmitting: false, isRelaunching: false,
        errorMessage: null, progressMessage: action.message };
    case 'restartRequired':
      return { ...state, errorMessage: action.errorMessage, requiresRestart: true,
        isSubmitting: false, isRelaunching: false, progressMessage: null };
    case 'backupChoiceChanged':
      if (state.mode !== 'confirmDelete' || state.requiresRestart || isWorkspaceSelectorBusy(state) ||
          state.status?.operationState === 'recoveryRequired' ||
          (state.status?.formatVersion === 2 && action.value !== 'explicitDataLoss')) return state;
      return { ...state, backupChoice: action.value };
    case 'loadStarted':
      if (state.requiresRestart) return state;
      return {
        ...state,
        errorMessage: null,
        loadState: 'loading',
      };
    case 'loadSucceeded':
      if (state.requiresRestart) return state;
      return {
        ...state,
        backupChoice: null,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
        errorMessage: null,
        loadState: 'ready',
        status: action.status,
      };
    case 'loadFailed':
      if (state.requiresRestart) return state;
      return {
        ...state,
        errorMessage: action.errorMessage,
        loadState: 'error',
        status: null,
      };
    case 'openDialog':
      if (state.requiresRestart) return { ...state, isDialogOpen: true };
      return {
        ...state,
        backupChoice: null,
        progressMessage: null,
        errorMessage: null,
        isDialogOpen: true,
        isRelaunching: false,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'closeDialog':
      if (isWorkspaceSelectorBusy(state)) return state;
      return {
        ...state,
        errorMessage: state.requiresRestart ? state.errorMessage : null,
        isDialogOpen: false,
        isRelaunching: false,
        labelInput: '',
        backupChoice: null,
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'selectMode':
      if (
        state.requiresRestart || isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      if (state.status?.formatVersion === 2 && (state.status.operationState !== 'idle' ||
          (action.mode !== 'list' && action.mode !== 'confirmDelete') ||
          (action.mode === 'confirmDelete' && action.workspaceId !== state.status.target.workspaceId))) return state;
      return {
        ...state,
        backupChoice: null,
        progressMessage: null,
        errorMessage: null,
        labelInput: action.labelInput ?? '',
        mode: action.mode,
        selectedWorkspaceId: action.workspaceId ?? null,
      };
    case 'labelChanged':
      if (
        state.requiresRestart || isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      return { ...state, labelInput: action.value };
    case 'operationStarted':
      if (
        state.requiresRestart || isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      return { ...state, errorMessage: null, isSubmitting: true };
    case 'operationCancelled':
      if (state.requiresRestart) return state;
      return {
        ...state,
        backupChoice: null,
        progressMessage: null,
        errorMessage: null,
        isSubmitting: false,
        isRelaunching: false,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'operationFailed':
      if (state.requiresRestart) return state;
      return {
        ...state,
        errorMessage: action.errorMessage,
        isSubmitting: false,
        isRelaunching: false,
      };
    case 'statusRefreshed':
      if (state.requiresRestart) return state;
      return {
        ...state,
        backupChoice: null,
        progressMessage: null,
        errorMessage: null,
        isSubmitting: false,
        isRelaunching: false,
        labelInput: '',
        loadState: 'ready',
        mode: 'list',
        selectedWorkspaceId: null,
        status: action.status,
      };
    case 'relaunching':
      if (state.requiresRestart) return state;
      return {
        ...state,
        errorMessage: null,
        isRelaunching: true,
        isSubmitting: true,
        progressMessage: action.progressMessage ?? null,
      };
  }
}

export function isWorkspaceSelectorBusy(
  state: WorkspaceSelectorState,
): boolean {
  return state.isSubmitting || state.status?.operationState === 'busy';
}
