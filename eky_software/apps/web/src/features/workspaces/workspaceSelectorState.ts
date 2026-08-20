import type { WorkspaceManagementStatus } from '../../app/desktopWorkspaceManagement.js';

export type WorkspaceSelectorMode =
  | 'confirmSwitch'
  | 'create'
  | 'import'
  | 'list'
  | 'rename';

export interface WorkspaceSelectorState {
  readonly errorMessage: string | null;
  readonly isDialogOpen: boolean;
  readonly isSubmitting: boolean;
  readonly labelInput: string;
  readonly loadState: 'error' | 'loading' | 'ready';
  readonly mode: WorkspaceSelectorMode;
  readonly selectedWorkspaceId: string | null;
  readonly status: WorkspaceManagementStatus | null;
}

export type WorkspaceSelectorAction =
  | { readonly type: 'closeDialog' }
  | { readonly type: 'labelChanged'; readonly value: string }
  | { readonly type: 'loadFailed'; readonly errorMessage: string }
  | { readonly type: 'loadStarted' }
  | {
      readonly type: 'loadSucceeded';
      readonly status: WorkspaceManagementStatus;
    }
  | { readonly type: 'openDialog' }
  | { readonly type: 'operationCancelled' }
  | { readonly type: 'operationFailed'; readonly errorMessage: string }
  | { readonly type: 'operationStarted' }
  | { readonly type: 'relaunching' }
  | {
      readonly type: 'selectMode';
      readonly labelInput?: string;
      readonly mode: WorkspaceSelectorMode;
      readonly workspaceId?: string;
    }
  | {
      readonly type: 'statusRefreshed';
      readonly status: WorkspaceManagementStatus;
    };

export const initialWorkspaceSelectorState: WorkspaceSelectorState = {
  errorMessage: null,
  isDialogOpen: false,
  isSubmitting: false,
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
  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        errorMessage: null,
        loadState: 'loading',
      };
    case 'loadSucceeded':
      return {
        ...state,
        errorMessage: null,
        loadState: 'ready',
        status: action.status,
      };
    case 'loadFailed':
      return {
        ...state,
        errorMessage: action.errorMessage,
        loadState: 'error',
        status: null,
      };
    case 'openDialog':
      return {
        ...state,
        errorMessage: null,
        isDialogOpen: true,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'closeDialog':
      if (isWorkspaceSelectorBusy(state)) return state;
      return {
        ...state,
        errorMessage: null,
        isDialogOpen: false,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'selectMode':
      if (
        isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      return {
        ...state,
        errorMessage: null,
        labelInput: action.labelInput ?? '',
        mode: action.mode,
        selectedWorkspaceId: action.workspaceId ?? null,
      };
    case 'labelChanged':
      if (
        isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      return { ...state, labelInput: action.value };
    case 'operationStarted':
      if (
        isWorkspaceSelectorBusy(state) ||
        state.status?.operationState === 'recoveryRequired'
      ) {
        return state;
      }
      return { ...state, errorMessage: null, isSubmitting: true };
    case 'operationCancelled':
      return {
        ...state,
        errorMessage: null,
        isSubmitting: false,
        labelInput: '',
        mode: 'list',
        selectedWorkspaceId: null,
      };
    case 'operationFailed':
      return {
        ...state,
        errorMessage: action.errorMessage,
        isSubmitting: false,
      };
    case 'statusRefreshed':
      return {
        ...state,
        errorMessage: null,
        isSubmitting: false,
        labelInput: '',
        loadState: 'ready',
        mode: 'list',
        selectedWorkspaceId: null,
        status: action.status,
      };
    case 'relaunching':
      return { ...state, errorMessage: null, isSubmitting: true };
  }
}

export function isWorkspaceSelectorBusy(
  state: WorkspaceSelectorState,
): boolean {
  return state.isSubmitting || state.status?.operationState === 'busy';
}
