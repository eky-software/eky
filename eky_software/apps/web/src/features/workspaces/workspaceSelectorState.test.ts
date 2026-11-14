import { describe, expect, it } from 'vitest';

import type { WorkspaceManagementStatus, WorkspaceRecoveryManagementStatus } from '../../app/desktopWorkspaceManagement.js';
import {
  initialWorkspaceSelectorState,
  isWorkspaceSelectorBusy,
  reduceWorkspaceSelectorState,
} from './workspaceSelectorState.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const idleStatus: WorkspaceManagementStatus = {
  activeWorkspaceId: workspaceId,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [
    {
      availability: 'ready',
      isActive: true,
      workspaceId,
      workspaceLabel: 'Oma yritys Oy',
    },
  ],
};

describe('workspace selector state', () => {
  const recoveryStatus: WorkspaceRecoveryManagementStatus = {
    formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
    maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: null,
    target: { workspaceId, workspaceLabel: 'Synthetic recovery target' },
  };

  it('keeps the recovery target separate from ordinary selection and rejects forbidden transitions', () => {
    const loaded = reduceWorkspaceSelectorState(initialWorkspaceSelectorState, { type: 'loadSucceeded', status: recoveryStatus });
    expect(loaded.status).toEqual(recoveryStatus);
    expect(loaded.status).not.toHaveProperty('workspaces');
    for (const action of [
      ...(['create', 'import', 'rename', 'confirmSwitch', 'confirmReplace'] as const).map(mode =>
        ({ type: 'selectMode', mode, workspaceId } as const)),
      { type: 'selectMode', mode: 'confirmDelete', workspaceId: '22222222-2222-4222-8222-222222222222' } as const,
    ]) expect(reduceWorkspaceSelectorState(loaded, action)).toBe(loaded);
    const selected = reduceWorkspaceSelectorState(loaded, { type: 'selectMode', mode: 'confirmDelete', workspaceId });
    expect(selected).toMatchObject({ selectedWorkspaceId: workspaceId, mode: 'confirmDelete' });
    expect(reduceWorkspaceSelectorState(selected, { type: 'backupChoiceChanged', value: 'createBackup' })).toBe(selected);
  });

  it.each(['busy', 'recoveryRequired'] as const)('clears the previous target and confirmation on recovery %s', operationState => {
    const selected = { ...initialWorkspaceSelectorState, status: recoveryStatus, loadState: 'ready' as const,
      mode: 'confirmDelete' as const, selectedWorkspaceId: workspaceId, labelInput: 'Synthetic recovery target',
      backupChoice: 'explicitDataLoss' as const };
    const status = { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
      maintenanceState: 'idle', operationState } as const;
    const state = reduceWorkspaceSelectorState(selected, { type: 'loadSucceeded', status });
    expect(state).toMatchObject({ selectedWorkspaceId: null, labelInput: '', backupChoice: null, mode: 'list', status });
    expect(state.status).not.toHaveProperty('target');
    expect(reduceWorkspaceSelectorState(state, { type: 'selectMode', mode: 'confirmDelete', workspaceId })).toBe(state);
  });

  it('latches a nonbusy completed result until a new capability session, without restarting or exposing forms', () => {
    const pending = { ...initialWorkspaceSelectorState, status: recoveryStatus, loadState: 'ready' as const,
      mode: 'confirmDelete' as const, selectedWorkspaceId: workspaceId, isSubmitting: true };
    const completed = reduceWorkspaceSelectorState(pending, { type: 'deletionCompleted', message: 'Safe completion' });
    expect(completed).toMatchObject({ deletionCompleted: true, isSubmitting: false, isRelaunching: false,
      requiresRestart: false, progressMessage: 'Safe completion', mode: 'list', selectedWorkspaceId: null });
    expect(isWorkspaceSelectorBusy(completed)).toBe(false);
    for (const action of [
      { type: 'contextChanged' }, { type: 'openDialog' }, { type: 'closeDialog' },
      { type: 'loadStarted' }, { type: 'loadSucceeded', status: idleStatus },
      { type: 'operationStarted' }, { type: 'operationCancelled' }, { type: 'relaunching' },
      { type: 'statusRefreshed', status: idleStatus }, { type: 'selectMode', mode: 'create' },
      { type: 'labelChanged', value: 'stale' }, { type: 'backupChoiceChanged', value: 'explicitDataLoss' },
    ] as const) expect(reduceWorkspaceSelectorState(completed, action)).toBe(completed);
    expect(reduceWorkspaceSelectorState(completed, { type: 'sessionReset' })).toEqual(initialWorkspaceSelectorState);
  });

  it('expires an idle backup choice without clearing admitted work or restart uncertainty', () => {
    const selected = { ...initialWorkspaceSelectorState, loadState: 'ready' as const, status: idleStatus,
      mode: 'confirmDelete' as const, selectedWorkspaceId: workspaceId, labelInput: 'Oma yritys Oy',
      backupChoice: 'createBackup' as const };
    expect(reduceWorkspaceSelectorState(selected, { type: 'contextChanged' })).toMatchObject({
      backupChoice: null, labelInput: selected.labelInput, requiresRestart: false,
    });
    const pending = { ...selected, isSubmitting: true };
    expect(reduceWorkspaceSelectorState(pending, { type: 'contextChanged' })).toEqual(pending);
    const blocked = { ...selected, requiresRestart: true, errorMessage: 'Safe uncertainty' };
    expect(reduceWorkspaceSelectorState(blocked, { type: 'contextChanged' })).toMatchObject({
      requiresRestart: true, errorMessage: 'Safe uncertainty', backupChoice: null,
    });
  });

  it('resets typed confirmation and explicit loss choice whenever the target or session changes', () => {
    const selected = { ...initialWorkspaceSelectorState, loadState: 'ready' as const, status: idleStatus,
      mode: 'confirmDelete' as const, selectedWorkspaceId: workspaceId, labelInput: 'Oma yritys Oy',
      backupChoice: 'explicitDataLoss' as const };
    for (const action of [
      { type: 'selectMode', mode: 'confirmDelete', workspaceId: '22222222-2222-4222-8222-222222222222' },
      { type: 'loadSucceeded', status: idleStatus }, { type: 'operationCancelled' }, { type: 'sessionReset' },
    ] as const) {
      expect(reduceWorkspaceSelectorState(selected, action)).toMatchObject({ backupChoice: null, labelInput: '' });
    }
    const fresh = reduceWorkspaceSelectorState(initialWorkspaceSelectorState, { type: 'backupChoiceChanged', value: 'explicitDataLoss' });
    expect(fresh).toBe(initialWorkspaceSelectorState);
  });

  it('keeps uncertainty distinct from pending work and only a new session clears it', () => {
    const pending = { ...initialWorkspaceSelectorState, status: idleStatus, loadState: 'ready' as const,
      isDialogOpen: true, isSubmitting: true, mode: 'confirmDelete' as const };
    const blocked = reduceWorkspaceSelectorState(pending, { type: 'restartRequired', errorMessage: 'Safe uncertainty' });
    expect(isWorkspaceSelectorBusy(blocked)).toBe(false);
    expect(blocked).toMatchObject({ requiresRestart: true, isSubmitting: false, isRelaunching: false });
    for (const action of [{ type: 'loadStarted' }, { type: 'loadSucceeded', status: idleStatus },
      { type: 'operationStarted' }, { type: 'operationCancelled' }, { type: 'relaunching' },
      { type: 'statusRefreshed', status: idleStatus }, { type: 'selectMode', mode: 'create' },
    ] as const) expect(reduceWorkspaceSelectorState(blocked, action)).toBe(blocked);
    const reopened = reduceWorkspaceSelectorState(reduceWorkspaceSelectorState(blocked, { type: 'closeDialog' }), { type: 'openDialog' });
    expect(reopened).toMatchObject({ requiresRestart: true, errorMessage: 'Safe uncertainty', isDialogOpen: true });
    expect(reduceWorkspaceSelectorState(reopened, { type: 'sessionReset' })).toEqual(initialWorkspaceSelectorState);
  });

  it('loads, opens and resets a cancelled operation without an error', () => {
    const loaded = reduceWorkspaceSelectorState(initialWorkspaceSelectorState, {
      status: idleStatus,
      type: 'loadSucceeded',
    });
    const opened = reduceWorkspaceSelectorState(loaded, { type: 'openDialog' });
    const selected = reduceWorkspaceSelectorState(opened, {
      mode: 'import',
      type: 'selectMode',
    });
    const started = reduceWorkspaceSelectorState(selected, {
      type: 'operationStarted',
    });
    const cancelled = reduceWorkspaceSelectorState(started, {
      type: 'operationCancelled',
    });

    expect(cancelled).toMatchObject({
      errorMessage: null,
      isDialogOpen: true,
      isSubmitting: false,
      isRelaunching: false,
      labelInput: '',
      mode: 'list',
      selectedWorkspaceId: null,
      status: idleStatus,
    });
  });

  it('keeps relaunching locked until the renderer process exits', () => {
    const state = {
      ...initialWorkspaceSelectorState,
      isDialogOpen: true,
      isSubmitting: true,
      loadState: 'ready' as const,
      mode: 'confirmSwitch' as const,
      status: idleStatus,
    };
    const relaunching = reduceWorkspaceSelectorState(state, {
      type: 'relaunching',
    });

    expect(isWorkspaceSelectorBusy(relaunching)).toBe(true);
    expect(relaunching.isRelaunching).toBe(true);
    expect(
      reduceWorkspaceSelectorState(relaunching, { type: 'closeDialog' }),
    ).toBe(relaunching);
    expect(
      reduceWorkspaceSelectorState(relaunching, {
        mode: 'create',
        type: 'selectMode',
      }),
    ).toBe(relaunching);
  });

  it.each(['busy', 'recoveryRequired'] as const)(
    'blocks mutating UI transitions while status is %s',
    (operationState) => {
      const state = {
        ...initialWorkspaceSelectorState,
        isDialogOpen: true,
        loadState: 'ready' as const,
        status: { ...idleStatus, operationState },
      };

      expect(
        reduceWorkspaceSelectorState(state, {
          mode: 'create',
          type: 'selectMode',
        }),
      ).toBe(state);
      expect(
        reduceWorkspaceSelectorState(state, {
          type: 'labelChanged',
          value: 'Ei sallittu',
        }),
      ).toBe(state);
      expect(
        reduceWorkspaceSelectorState(state, { type: 'operationStarted' }),
      ).toBe(state);
    },
  );

  it('replaces stale status only after an explicit refresh succeeds', () => {
    const busyStatus = { ...idleStatus, operationState: 'busy' as const };
    const state = {
      ...initialWorkspaceSelectorState,
      errorMessage: 'Vanha virhe',
      isSubmitting: true,
      labelInput: 'Nimi',
      loadState: 'ready' as const,
      mode: 'rename' as const,
      selectedWorkspaceId: workspaceId,
      status: busyStatus,
    };
    const refreshed = reduceWorkspaceSelectorState(state, {
      status: idleStatus,
      type: 'statusRefreshed',
    });

    expect(refreshed).toMatchObject({
      errorMessage: null,
      isSubmitting: false,
      isRelaunching: false,
      labelInput: '',
      mode: 'list',
      selectedWorkspaceId: null,
      status: idleStatus,
    });
  });
});
