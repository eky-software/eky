import { describe, expect, it, vi } from 'vitest';

import {
  ActiveWorkspaceStartupRelaunchRequiredError,
  type ActiveWorkspaceStartupSelection,
} from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { resolveDesktopWorkspaceStartup } from './resolveDesktopWorkspaceStartup.js';

describe('desktop workspace startup boundary', () => {
  it('relaunches before creating a runtime session after safe target rollback', async () => {
    const createRuntimeSession = vi.fn(() => 'unused-session');
    const relaunchApplication = vi.fn();

    await expect(
      resolveDesktopWorkspaceStartup({
        createRuntimeSession,
        relaunchApplication,
        resolveActiveWorkspace: async () => {
          throw new ActiveWorkspaceStartupRelaunchRequiredError();
        },
        userDataRoot: 'synthetic-root',
      }),
    ).resolves.toEqual({ status: 'relaunching' });

    expect(relaunchApplication).toHaveBeenCalledTimes(1);
    expect(createRuntimeSession).not.toHaveBeenCalled();
  });

  it('creates the runtime session only after workspace resolution succeeds', async () => {
    const selection = createSelection();
    const createRuntimeSession = vi.fn(() => 'synthetic-session');

    await expect(
      resolveDesktopWorkspaceStartup({
        createRuntimeSession,
        relaunchApplication: vi.fn(),
        resolveActiveWorkspace: async () => selection,
        userDataRoot: 'synthetic-root',
      }),
    ).resolves.toEqual({
      status: 'ready',
      activeWorkspace: selection,
      runtimeSessionSecret: 'synthetic-session',
    });
    expect(createRuntimeSession).toHaveBeenCalledTimes(1);
  });

  it('preserves unrelated safe startup failures without relaunching', async () => {
    const relaunchApplication = vi.fn();

    await expect(
      resolveDesktopWorkspaceStartup({
        createRuntimeSession: vi.fn(),
        relaunchApplication,
        resolveActiveWorkspace: async () => {
          throw new Error('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
        },
        userDataRoot: 'synthetic-root',
      }),
    ).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    expect(relaunchApplication).not.toHaveBeenCalled();
  });
});

function createSelection(): Readonly<ActiveWorkspaceStartupSelection> {
  return Object.freeze({
    mode: 'normal',
    workspaceId:
      '11111111-1111-4111-8111-111111111111' as ActiveWorkspaceStartupSelection['workspaceId'],
    workspaceRoot: 'synthetic-workspace-root',
    assertCanAccept: () => undefined,
    accept: async () => undefined,
    recoverFromFailure: async () => 'notRecovered' as const,
  });
}
