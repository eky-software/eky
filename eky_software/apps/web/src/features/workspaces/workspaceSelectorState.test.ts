import { describe, expect, it } from 'vitest';

import type { WorkspaceManagementStatus } from '../../app/desktopWorkspaceManagement.js';
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
      labelInput: '',
      mode: 'list',
      selectedWorkspaceId: null,
      status: idleStatus,
    });
  });
});
