import { describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceManagementCapability,
  WorkspaceManagementEntry,
  WorkspaceManagementStatus,
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

describe('runWorkspaceManagementOperation', () => {
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
