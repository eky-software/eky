import { describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceManagementCapability,
  WorkspaceManagementEntry,
  WorkspaceManagementStatus,
  WorkspaceDeletionResult,
  WorkspaceRecoveryManagementStatus,
} from '../../app/desktopWorkspaceManagement.js';
import { runWorkspaceManagementOperation } from './workspaceManagementOperation.js';

const activeWorkspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const activeWorkspace: WorkspaceManagementEntry = {
  availability: 'ready',
  isActive: true,
  workspaceId: activeWorkspaceId,
  workspaceLabel: 'Sama nimi',
};
const otherWorkspace: WorkspaceManagementEntry = {
  availability: 'ready',
  isActive: false,
  workspaceId: otherWorkspaceId,
  workspaceLabel: 'Sama nimi',
};
const status: WorkspaceManagementStatus = {
  activeWorkspaceId,
  formatVersion: 1,
  operationState: 'idle',
  workspaces: [activeWorkspace, otherWorkspace],
};

const recoveryStatus: WorkspaceRecoveryManagementStatus = {
  formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
  maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: otherWorkspaceId,
  target: { workspaceId: activeWorkspaceId, workspaceLabel: 'Sama nimi' },
};

describe('runWorkspaceManagementOperation', () => {
  it.each(['create', 'import', 'rename', 'confirmSwitch', 'confirmReplace'] as const)(
    'blocks the direct %s command in recovery management before invoking any capability', async mode => {
      const unexpected = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_COMMAND'); });
      const capability = { createEmpty: unexpected, importBackupAsNew: unexpected, rename: unexpected,
        switchTo: unexpected, replaceActiveFromBackup: unexpected, deleteWorkspace: unexpected, getStatus: unexpected };
      await expect(runWorkspaceManagementOperation({ capability, mode, status: recoveryStatus,
        selectedWorkspace: activeWorkspace, workspaceLabel: 'Sama nimi', deletionBackupChoice: 'explicitDataLoss' }))
        .rejects.toThrow('WORKSPACE_DELETION_UI_UNAVAILABLE');
      expect(unexpected).not.toHaveBeenCalled();
    });

  it('uses only the recovery target and explicit loss without inventing an ordinary entry or refreshing', async () => {
    const result = { formatVersion: 1, status: 'completed', navigation: 'selector' } as const;
    const remove = vi.fn(async () => result), getStatus = vi.fn(async () => recoveryStatus);
    const capability = { ...createCapability(), getStatus, deleteWorkspace: remove };
    for (const input of [
      { deletionBackupChoice: 'createBackup' as const, canCreateDeletionBackup: true },
      { deletionBackupChoice: 'explicitDataLoss' as const, selectedWorkspace: otherWorkspace },
      { deletionBackupChoice: 'explicitDataLoss' as const, selectedWorkspace: { ...activeWorkspace, workspaceLabel: 'Stale name' } },
    ]) {
      await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status: recoveryStatus,
        workspaceLabel: 'Sama nimi', ...input })).rejects.toThrow('WORKSPACE_DELETION_UI_UNAVAILABLE');
    }
    expect(remove).not.toHaveBeenCalled();
    await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status: recoveryStatus,
      workspaceLabel: 'Sama nimi', deletionBackupChoice: 'explicitDataLoss' })).resolves.toEqual({ type: 'deletion', result });
    expect(remove).toHaveBeenCalledExactlyOnceWith({ formatVersion: 1, workspaceId: activeWorkspaceId,
      typedLabel: 'Sama nimi', backupChoice: 'explicitDataLoss' });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it.each(['busy', 'recoveryRequired'] as const)('never uses a previous target in target-free recovery %s', async operationState => {
    const remove = vi.fn();
    await expect(runWorkspaceManagementOperation({ capability: createCapability({ deleteWorkspace: remove }),
      mode: 'confirmDelete', status: { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: 'idle', operationState }, selectedWorkspace: activeWorkspace,
      workspaceLabel: 'Sama nimi', deletionBackupChoice: 'explicitDataLoss' })).rejects.toThrow('WORKSPACE_DELETION_UI_UNAVAILABLE');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    { formatVersion: 1, status: 'completed', navigation: 'selector' },
    { formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'relaunching' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'restartRequired' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'none', nextAction: 'continue' },
    { formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'restartRequired' },
  ] satisfies WorkspaceDeletionResult[])('returns the closed deletion result without refreshing or choosing a workspace: %j', async result => {
    const remove = vi.fn(async () => result), getStatus = vi.fn(async () => status);
    const capability = createCapability({ deleteWorkspace: remove, getStatus });
    await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status,
      selectedWorkspace: otherWorkspace, workspaceLabel: 'Sama nimi', deletionBackupChoice: 'explicitDataLoss' }))
      .resolves.toEqual({ type: 'deletion', result });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith({ formatVersion: 1, workspaceId: otherWorkspaceId,
      typedLabel: 'Sama nimi', backupChoice: 'explicitDataLoss' });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('permits backup only with actual open-runtime context and the exact active target', async () => {
    const remove = vi.fn(async () => ({ formatVersion: 1, status: 'cancelled', nextAction: 'continue' } as const));
    const capability = createCapability({ deleteWorkspace: remove });
    for (const [selected, open] of [[activeWorkspace, false], [otherWorkspace, true]] as const) {
      await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status,
        selectedWorkspace: selected, workspaceLabel: selected.workspaceLabel,
        deletionBackupChoice: 'createBackup', canCreateDeletionBackup: open })).rejects.toThrow('WORKSPACE_DELETION_UI_UNAVAILABLE');
    }
    expect(remove).not.toHaveBeenCalled();
    await runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status,
      selectedWorkspace: activeWorkspace, workspaceLabel: activeWorkspace.workspaceLabel,
      deletionBackupChoice: 'createBackup', canCreateDeletionBackup: true });
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each(['busy', 'recoveryRequired'] as const)('does not turn global %s into deletion permission', async operationState => {
    const remove = vi.fn();
    await expect(runWorkspaceManagementOperation({ capability: createCapability({ deleteWorkspace: remove }), mode: 'confirmDelete',
      status: { ...status, operationState }, selectedWorkspace: otherWorkspace,
      workspaceLabel: otherWorkspace.workspaceLabel, deletionBackupChoice: 'explicitDataLoss' })).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects a changed target name, untrimmed confirmation or malformed result without refresh', async () => {
    const remove = vi.fn(async () => ({ formatVersion: 1, status: 'prepared' }) as never);
    const capability = createCapability({ deleteWorkspace: remove });
    for (const [selectedWorkspace, workspaceLabel] of [
      [{ ...otherWorkspace, workspaceLabel: 'Old name' }, 'Old name'], [otherWorkspace, 'Sama nimi '],
    ] as const) {
      await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status,
        selectedWorkspace, workspaceLabel, deletionBackupChoice: 'explicitDataLoss' })).rejects.toThrow();
    }
    expect(remove).not.toHaveBeenCalled();
    await expect(runWorkspaceManagementOperation({ capability, mode: 'confirmDelete', status,
      selectedWorkspace: otherWorkspace, workspaceLabel: 'Sama nimi', deletionBackupChoice: 'explicitDataLoss' }))
      .rejects.toThrow('Invalid workspace deletion result.');
  });

  it.each(['create', 'import', 'rename'] as const)(
    'refreshes %s from null selection without automatically opening a workspace', async (mode) => {
      const selectorStatus: WorkspaceManagementStatus = {
        ...status,
        activeWorkspaceId: null,
        workspaces: [otherWorkspace],
      };
      const getStatus = vi.fn(async () => selectorStatus);
      const switchTo = vi.fn(async () => 'relaunching' as const);
      const capability = createCapability({
        getStatus,
        importBackupAsNew: vi.fn(async () => 'completed' as const),
        switchTo,
      });

      await expect(runWorkspaceManagementOperation({
        capability,
        mode,
        selectedWorkspace: otherWorkspace,
        status: selectorStatus,
        workspaceLabel: 'New name',
      })).resolves.toEqual({ status: selectorStatus, type: 'refreshed' });
      expect(getStatus).toHaveBeenCalledOnce();
      expect(switchTo).not.toHaveBeenCalled();
    },
  );

  it('opens an explicitly chosen workspace from null selection through the existing switch', async () => {
    const getStatus = vi.fn(async () => status);
    const switchTo = vi.fn(async () => 'relaunching' as const);
    await expect(runWorkspaceManagementOperation({
      capability: createCapability({ getStatus, switchTo }),
      mode: 'confirmSwitch',
      selectedWorkspace: otherWorkspace,
      status: { ...status, activeWorkspaceId: null, workspaces: [otherWorkspace] },
      workspaceLabel: '',
    })).resolves.toEqual({ type: 'relaunching' });
    expect(switchTo).toHaveBeenCalledWith(otherWorkspaceId);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('refreshes a completed create and preserves relaunch as terminal busy state', async () => {
    const getStatus = vi.fn(async () => status);
    const completedCapability = createCapability({ getStatus });

    await expect(
      runWorkspaceManagementOperation({
        capability: completedCapability,
        mode: 'create',
        status,
        workspaceLabel: 'Uusi yritys',
      }),
    ).resolves.toEqual({ status, type: 'refreshed' });
    expect(getStatus).toHaveBeenCalledOnce();

    const relaunchGetStatus = vi.fn(async () => status);
    const relaunchCapability = createCapability({
      createEmpty: vi.fn(async () => 'relaunching' as const),
      getStatus: relaunchGetStatus,
    });
    await expect(
      runWorkspaceManagementOperation({
        capability: relaunchCapability,
        mode: 'create',
        status,
        workspaceLabel: 'Uusi yritys',
      }),
    ).resolves.toEqual({ type: 'relaunching' });
    expect(relaunchGetStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', { type: 'cancelled' }, false],
    ['completed', { status, type: 'refreshed' }, true],
    ['relaunching', { type: 'relaunching' }, false],
  ] as const)(
    'handles an import %s result without leaking native picker state',
    async (result, expected, expectsRefresh) => {
      const getStatus = vi.fn(async () => status);
      const capability = createCapability({
        getStatus,
        importBackupAsNew: vi.fn(async () => result),
      });

      await expect(
        runWorkspaceManagementOperation({
          capability,
          mode: 'import',
          status,
          workspaceLabel: 'Tuotu yritys',
        }),
      ).resolves.toEqual(expected);
      expect(getStatus).toHaveBeenCalledTimes(expectsRefresh ? 1 : 0);
    },
  );

  it('uses workspace identifiers when duplicate labels exist', async () => {
    const switchTo = vi.fn(async () => 'relaunching' as const);
    const capability = createCapability({ switchTo });

    await expect(
      runWorkspaceManagementOperation({
        capability,
        mode: 'confirmSwitch',
        selectedWorkspace: otherWorkspace,
        status,
        workspaceLabel: '',
      }),
    ).resolves.toEqual({ type: 'relaunching' });
    expect(switchTo).toHaveBeenCalledWith(otherWorkspaceId);
  });

  it('does not call the capability for an already active switch or unchanged label', async () => {
    const getStatus = vi.fn(async () => status);
    const rename = vi.fn(async () => 'completed' as const);
    const switchTo = vi.fn(async () => 'completed' as const);
    const capability = createCapability({ getStatus, rename, switchTo });

    await expect(
      runWorkspaceManagementOperation({
        capability,
        mode: 'confirmSwitch',
        selectedWorkspace: activeWorkspace,
        status,
        workspaceLabel: '',
      }),
    ).resolves.toEqual({ status, type: 'refreshed' });
    await expect(
      runWorkspaceManagementOperation({
        capability,
        mode: 'rename',
        selectedWorkspace: activeWorkspace,
        status,
        workspaceLabel: activeWorkspace.workspaceLabel,
      }),
    ).resolves.toEqual({ status, type: 'refreshed' });
    expect(getStatus).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('renames the selected identifier and then refreshes status', async () => {
    const getStatus = vi.fn(async () => status);
    const rename = vi.fn(async () => 'completed' as const);
    const capability = createCapability({ getStatus, rename });

    await expect(
      runWorkspaceManagementOperation({
        capability,
        mode: 'rename',
        selectedWorkspace: otherWorkspace,
        status,
        workspaceLabel: 'Uusi nimi',
      }),
    ).resolves.toEqual({ status, type: 'refreshed' });
    expect(rename).toHaveBeenCalledWith(otherWorkspaceId, 'Uusi nimi');
    expect(getStatus).toHaveBeenCalledOnce();
  });

  it.each([
    ['cancelled', { type: 'cancelled' }],
    ['relaunching', { type: 'relaunching' }],
  ] as const)(
    'handles active replacement %s without refreshing renderer state',
    async (result, expected) => {
      const getStatus = vi.fn(async () => status);
      const replaceActiveFromBackup = vi.fn(async () => result);
      const capability = createCapability({
        getStatus,
        replaceActiveFromBackup,
      });

      await expect(
        runWorkspaceManagementOperation({
          capability,
          mode: 'confirmReplace',
          selectedWorkspace: activeWorkspace,
          status,
          workspaceLabel: '',
        }),
      ).resolves.toEqual(expected);
      expect(replaceActiveFromBackup).toHaveBeenCalledWith();
      expect(getStatus).not.toHaveBeenCalled();
    },
  );

  it('fails closed when active replacement is unavailable or targets a non-active workspace', async () => {
    await expect(
      runWorkspaceManagementOperation({
        capability: createCapability(),
        mode: 'confirmReplace',
        selectedWorkspace: activeWorkspace,
        status,
        workspaceLabel: '',
      }),
    ).rejects.toThrow('WORKSPACE_REPLACEMENT_UI_UNAVAILABLE');

    await expect(
      runWorkspaceManagementOperation({
        capability: createCapability({
          replaceActiveFromBackup: async () => 'relaunching',
        }),
        mode: 'confirmReplace',
        selectedWorkspace: otherWorkspace,
        status,
        workspaceLabel: '',
      }),
    ).rejects.toThrow('WORKSPACE_REPLACEMENT_UI_UNAVAILABLE');
  });

  it('fails closed when a selection-required operation has no selection', async () => {
    await expect(
      runWorkspaceManagementOperation({
        capability: createCapability(),
        mode: 'confirmSwitch',
        status,
        workspaceLabel: '',
      }),
    ).rejects.toThrow('WORKSPACE_MANAGEMENT_UI_SELECTION_REQUIRED');
  });
});

function createCapability(
  overrides: Partial<WorkspaceManagementCapability> = {},
): WorkspaceManagementCapability {
  return {
    createEmpty: async () => 'completed',
    getStatus: async () => status,
    importBackupAsNew: async () => 'cancelled',
    rename: async () => 'completed',
    switchTo: async () => 'completed',
    ...overrides,
  };
}
