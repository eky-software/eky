import { describe, expect, it, vi } from 'vitest';

import {
  ActiveWorkspaceStartupRelaunchRequiredError,
  type ActiveWorkspaceStartupSelection,
} from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { resolveDesktopWorkspaceStartup } from './resolveDesktopWorkspaceStartup.js';
import type { ResolveDesktopWorkspaceStartupOptions } from './resolveDesktopWorkspaceStartup.js';

describe('desktop workspace startup boundary', () => {
  it.each([false, true])('forwards only the supplied selector authority (present: %s)', async present => {
    const resolveActiveWorkspace = vi.fn<ResolveDesktopWorkspaceStartupOptions['resolveActiveWorkspace']>(async () => createSelection());
    const selectorAuthority = { assertCurrent: vi.fn(), proveTerminal: vi.fn(async () => ({ assertCurrent: vi.fn() })) };
    await resolveDesktopWorkspaceStartup({
      assertStartupCurrent: vi.fn(), createRuntimeSession: () => 'synthetic-session', relaunchApplication: vi.fn(),
      resolveActiveWorkspace, userDataRoot: 'synthetic-root', ...(present ? { selectorAuthority } : {}),
    });
    expect(resolveActiveWorkspace).toHaveBeenCalledExactlyOnceWith('synthetic-root',
      ...(present ? [{ selectorAuthority }] : []));
    if (present) expect(resolveActiveWorkspace.mock.calls[0]?.[1]?.selectorAuthority).toBe(selectorAuthority);
  });

  it('relaunches before creating a runtime session after safe target rollback', async () => {
    const createRuntimeSession = vi.fn(() => 'unused-session');
    const relaunchApplication = vi.fn();

    await expect(
      resolveDesktopWorkspaceStartup({
        assertStartupCurrent: vi.fn(),
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
        assertStartupCurrent: vi.fn(),
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
        assertStartupCurrent: vi.fn(),
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

  it('rejects an expired startup before resolving any workspace', async () => {
    const resolveActiveWorkspace = vi.fn(async () => createSelection());
    const createRuntimeSession = vi.fn();
    const relaunchApplication = vi.fn();
    await expect(resolveDesktopWorkspaceStartup({
      assertStartupCurrent: () => { throw new Error('startup expired'); },
      createRuntimeSession, relaunchApplication, resolveActiveWorkspace,
      userDataRoot: 'synthetic-root',
    })).rejects.toThrow('startup expired');
    expect(resolveActiveWorkspace).not.toHaveBeenCalled();
    expect(createRuntimeSession).not.toHaveBeenCalled();
    expect(relaunchApplication).not.toHaveBeenCalled();
  });

  it.each(['ready', 'relaunching', 'failed'] as const)(
    'retains the original startup guard across a delayed %s result', async outcome => {
      let current = true;
      let resolve!: (selection: Readonly<ActiveWorkspaceStartupSelection>) => void;
      let reject!: (error: unknown) => void;
      const pending = new Promise<Readonly<ActiveWorkspaceStartupSelection>>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const createRuntimeSession = vi.fn();
      const relaunchApplication = vi.fn();
      const options = {
        assertStartupCurrent: () => { if (!current) throw new Error('startup expired'); },
        createRuntimeSession, relaunchApplication,
        resolveActiveWorkspace: () => pending, userDataRoot: 'synthetic-root',
      } satisfies ResolveDesktopWorkspaceStartupOptions;
      const result = resolveDesktopWorkspaceStartup(options);
      const failure = new Error('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
      const rejected = expect(result).rejects.toThrow(outcome === 'failed' ? failure : 'startup expired');
      current = false;
      options.assertStartupCurrent = vi.fn();
      if (outcome === 'ready') resolve(createSelection());
      else reject(outcome === 'relaunching' ? new ActiveWorkspaceStartupRelaunchRequiredError() : failure);
      await rejected;
      expect(options.assertStartupCurrent).not.toHaveBeenCalled();
      expect(createRuntimeSession).not.toHaveBeenCalled();
      expect(relaunchApplication).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])('renews startup authority after selector verification (expired: %s)', async expired => {
    let current = true;
    const selection = {
      mode: 'selector' as const,
      registry: { formatVersion: 2 as const, activeWorkspaceId: null, workspaces: [] },
      async assertCurrent() { current = !expired; },
    };
    const createRuntimeSession = vi.fn();
    const relaunchApplication = vi.fn();
    const result = resolveDesktopWorkspaceStartup({
      assertStartupCurrent: () => { if (!current) throw new Error('startup expired'); },
      createRuntimeSession, relaunchApplication,
      resolveActiveWorkspace: async () => selection, userDataRoot: 'synthetic-root',
    });
    if (expired) await expect(result).rejects.toThrow('startup expired');
    else await expect(result).resolves.toEqual({ status: 'selector', selection });
    expect(createRuntimeSession).not.toHaveBeenCalled();
    expect(relaunchApplication).not.toHaveBeenCalled();
  });

  it('does not reinterpret a selector proof failure as safe rollback', async () => {
    const relaunchApplication = vi.fn();
    const createRuntimeSession = vi.fn();
    const failure = new ActiveWorkspaceStartupRelaunchRequiredError();
    await expect(resolveDesktopWorkspaceStartup({
      assertStartupCurrent: vi.fn(), createRuntimeSession, relaunchApplication,
      resolveActiveWorkspace: async () => ({
        mode: 'selector',
        registry: { formatVersion: 2, activeWorkspaceId: null, workspaces: [] },
        async assertCurrent() { throw failure; },
      }),
      userDataRoot: 'synthetic-root',
    })).rejects.toBe(failure);
    expect(createRuntimeSession).not.toHaveBeenCalled();
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
