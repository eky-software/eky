import { describe, expect, it, vi } from 'vitest';

import { readSafeElectronE2eWorkspaceStartupFailureCode } from './electronE2eWorkspaceStartupFailure.js';
import { resolveElectronE2eWorkspaceStartup } from './electronE2eWorkspaceStartup.js';
import { ActiveWorkspaceStartupRelaunchRequiredError, type ActiveWorkspaceStartupOptions } from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { resolveDesktopWorkspaceStartup } from '../src/main/resolveDesktopWorkspaceStartup.js';

const resolveStartup = vi.hoisted(() => vi.fn());
vi.mock('../src/workspaces/runtime/resolveActiveWorkspaceStartup.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/workspaces/runtime/resolveActiveWorkspaceStartup.js')>(),
  resolveActiveWorkspaceStartup: resolveStartup,
}));

describe('Electron E2E workspace authority forwarding', () => {
  it('preserves the completed recovery signal through the real main resolution owner', async () => {
    const signal = new ActiveWorkspaceStartupRelaunchRequiredError();
    signal.cause = new Error('synthetic private root failure');
    const relaunchApplication = vi.fn();
    const createRuntimeSession = vi.fn();
    resolveStartup.mockImplementationOnce(async (_root: string, options: ActiveWorkspaceStartupOptions) => {
      options.reportProgress?.({ phase: 'workspaceRootInspection', state: 'started' });
      throw signal;
    });
    await expect(resolveDesktopWorkspaceStartup({
      userDataRoot: 'synthetic-root', resolveActiveWorkspace: resolveElectronE2eWorkspaceStartup,
      assertStartupCurrent: vi.fn(), relaunchApplication, createRuntimeSession,
    })).resolves.toEqual({ status: 'relaunching' });
    expect(relaunchApplication).toHaveBeenCalledOnce();
    expect(createRuntimeSession).not.toHaveBeenCalled();
  });

  it('does not promote an error with the same message to a recovery receipt', async () => {
    resolveStartup.mockRejectedValueOnce(new Error(new ActiveWorkspaceStartupRelaunchRequiredError().message));
    const relaunchApplication = vi.fn();
    await expect(resolveDesktopWorkspaceStartup({
      userDataRoot: 'synthetic-root', resolveActiveWorkspace: resolveElectronE2eWorkspaceStartup,
      assertStartupCurrent: vi.fn(), relaunchApplication, createRuntimeSession: vi.fn(),
    })).rejects.not.toBeInstanceOf(ActiveWorkspaceStartupRelaunchRequiredError);
    expect(relaunchApplication).not.toHaveBeenCalled();
  });

  it('passes the exact main-owned authority and returns its selector result unchanged', async () => {
    const authority: NonNullable<ActiveWorkspaceStartupOptions['selectorAuthority']> = {
      assertCurrent: vi.fn(), admitSelection: vi.fn(), proveTerminal: vi.fn(),
    };
    const progress = vi.fn();
    const result = { mode: 'selector', assertCurrent: vi.fn() };
    resolveStartup.mockImplementationOnce(async (_root: string, options: ActiveWorkspaceStartupOptions) => {
      expect(options.selectorAuthority).toBe(authority);
      options.reportProgress?.({ phase: 'registryStateRead', state: 'started' });
      return result;
    });
    await expect(resolveElectronE2eWorkspaceStartup('synthetic-root', {
      selectorAuthority: authority, reportProgress: progress,
    })).resolves.toBe(result);
    expect(progress).toHaveBeenCalledExactlyOnceWith({ phase: 'registryStateRead', state: 'started' });
  });

  it('does not fabricate a selector authority on the existing business path', async () => {
    const result = { mode: 'normal' };
    resolveStartup.mockImplementationOnce(async (_root: string, options: ActiveWorkspaceStartupOptions) => {
      expect(options).not.toHaveProperty('selectorAuthority');
      return result;
    });
    await expect(resolveElectronE2eWorkspaceStartup('synthetic-root')).resolves.toBe(result);
  });

  it('retains phase failure classification and clears a completed phase', async () => {
    for (const complete of [false, true]) {
      resolveStartup.mockImplementationOnce(async (_root: string, options: ActiveWorkspaceStartupOptions) => {
        options.reportProgress?.({ phase: 'registryStateRead', state: 'started' });
        if (complete) options.reportProgress?.({ phase: 'registryStateRead', state: 'completed' });
        throw new Error('synthetic private detail');
      });
      await expect(resolveElectronE2eWorkspaceStartup('synthetic-root')).rejects.toThrow(
        complete ? 'DESKTOP_SMOKE_E2E_WORKSPACE_RESOLUTION_FAILED' : 'DESKTOP_SMOKE_E2E_WORKSPACE_REGISTRY_READ_FAILED',
      );
    }
  });
});

describe('Electron E2E workspace startup failure reporting', () => {
  it.each([
    ['registryStateRead', 'DESKTOP_SMOKE_E2E_WORKSPACE_REGISTRY_READ_FAILED'],
    ['legacyAdoption', 'DESKTOP_SMOKE_E2E_WORKSPACE_ADOPTION_FAILED'],
    [
      'legacyAdoptionRecovery',
      'DESKTOP_SMOKE_E2E_WORKSPACE_ADOPTION_RECOVERY_FAILED',
    ],
    ['switchRecovery', 'DESKTOP_SMOKE_E2E_WORKSPACE_SWITCH_RECOVERY_FAILED'],
    [
      'workspaceRootInspection',
      'DESKTOP_SMOKE_E2E_WORKSPACE_ROOT_INSPECTION_FAILED',
    ],
  ] as const)('reports the closed %s failure without raw details', (phase, code) => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('private path and stack detail'),
        phase,
      ),
    ).toBe(code);
  });

  it('preserves an existing allowlisted startup failure', () => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('WORKSPACE_ADOPTION_RECOVERY_REQUIRED'),
        'legacyAdoption',
      ),
    ).toBe('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  });

  it('uses the generic closed failure before any phase starts', () => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('private path and stack detail'),
        undefined,
      ),
    ).toBe('DESKTOP_SMOKE_E2E_WORKSPACE_RESOLUTION_FAILED');
  });
});
