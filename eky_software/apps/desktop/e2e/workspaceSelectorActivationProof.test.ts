import { describe, expect, it, vi } from 'vitest';

import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import type { LocalWorkspaceRegistry } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { serializeVersionedWorkspaceSwitchJournal, type WorkspaceSwitchJournalV2 } from '../src/workspaces/switch/workspaceSwitchJournal.js';
import { proveSelectorActivationOpening, requireActivationProofRegistry } from './workspaceSelectorActivationProof.js';

const target = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const registry: LocalWorkspaceRegistry = { formatVersion: 2, activeWorkspaceId: null, workspaces: [{
  workspaceId: target, workspaceLabel: 'Synthetic opening', layoutVersion: 1,
  lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
  lifecycleState: 'ready', createdAt: '2026-01-01T00:00:00.000Z',
}] };

describe('activation proof assertions', () => {
  it.each([1, 2] as const)('requires exact registry format %s at every checkpoint', formatVersion => {
    const matching = { ...registry, formatVersion };
    expect(requireActivationProofRegistry(matching, formatVersion)).toBe(matching);
    expect(() => requireActivationProofRegistry({ ...registry, formatVersion: formatVersion === 1 ? 2 : 1 }, formatVersion))
      .toThrow('WORKSPACE_ACTIVATION_PROOF_REGISTRY_INVALID');
    expect(() => requireActivationProofRegistry(undefined, formatVersion)).toThrow();
  });

  it('checks the preload result and closes before destroying its owned window', async () => {
    const f = fixture();
    await expect(proveSelectorActivationOpening(f.input)).resolves.toBeUndefined();
    expect(f.execute).toHaveBeenCalledWith(`window.ekyDesktop.switchWorkspace(${JSON.stringify({ workspaceId: target })})`);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.destroy).toHaveBeenCalledOnce();
    expect(f.stop.mock.invocationCallOrder[0]).toBeLessThan(f.destroy.mock.invocationCallOrder[0]!);
    expect(f.cleanupFailure).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves an IPC failure when cleanup also fails: %s', cleanupFails => {
    const f = fixture();
    const first = new Error('synthetic first error');
    f.execute.mockRejectedValue(first);
    if (cleanupFails) f.stop.mockRejectedValue(new Error('synthetic cleanup error'));
    return expect(proveSelectorActivationOpening(f.input).catch(error => {
      expect(f.cleanupFailure).toHaveBeenCalledTimes(cleanupFails ? 1 : 0);
      expect(f.destroy).toHaveBeenCalledTimes(cleanupFails ? 0 : 1);
      throw error;
    })).rejects.toBe(first);
  });

  it('fails otherwise successful evidence when stop is uncertain', async () => {
    const f = fixture();
    const failure = new Error('synthetic stop error');
    f.stop.mockRejectedValue(failure);
    await expect(proveSelectorActivationOpening(f.input)).rejects.toBe(failure);
    expect(f.cleanupFailure).toHaveBeenCalledOnce();
    expect(f.destroy).not.toHaveBeenCalled();
  });

  it('records a failed owned-window cleanup', async () => {
    const f = fixture();
    f.destroy.mockImplementation(() => { throw new Error('synthetic window error'); });
    await expect(proveSelectorActivationOpening(f.input)).rejects.toThrow('synthetic window error');
    expect(f.cleanupFailure).toHaveBeenCalledOnce();
  });

  it.each(['backendStarts', 'sessionStarts'] as const)('rejects a selector that created %s', async key => {
    const f = fixture();
    f.runtime[key] = 1;
    await expect(proveSelectorActivationOpening(f.input)).rejects.toThrow('SELECTOR_STARTED_BUSINESS');
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it('preserves a failed selection assertion over a cleanup failure', async () => {
    const f = fixture();
    f.readRegistry.mockReset().mockResolvedValueOnce(registry).mockResolvedValue({ ...registry, formatVersion: 1 });
    f.stop.mockRejectedValue(new Error('secondary'));
    await expect(proveSelectorActivationOpening(f.input)).rejects.toThrow('REGISTRY_INVALID');
    expect(f.cleanupFailure).toHaveBeenCalledOnce();
    expect(f.destroy).not.toHaveBeenCalled();
  });

  it('rejects an unfinished journal side slot', async () => {
    const f = fixture();
    f.input.inspectSwitchSlots = async () => ({ current: f.slot, next: f.slot, backup: undefined });
    await expect(proveSelectorActivationOpening(f.input)).rejects.toThrow('SELECTOR_SELECTION_INVALID');
    expect(f.stop).toHaveBeenCalledOnce();
  });
});

function fixture() {
  const journal: WorkspaceSwitchJournalV2 = { formatVersion: 2, operationId: target,
    sourceWorkspaceId: null, targetWorkspaceId: target, state: 'targetSelected',
    createdAt: '2026-01-01T00:00:00.000Z', registryBeforeSha256: 'a'.repeat(64),
    registrySelectedSha256: 'b'.repeat(64), registryRejectedSha256: 'c'.repeat(64) };
  const slot = { value: journal, bytes: serializeVersionedWorkspaceSwitchJournal(journal) };
  const runtime = { backendStarts: 0, sessionStarts: 0, relaunches: 0 };
  const execute = vi.fn(async () => { runtime.relaunches += 1; return { formatVersion: 1, status: 'relaunching' }; });
  const readRegistry = vi.fn<() => Promise<LocalWorkspaceRegistry>>().mockResolvedValueOnce(registry)
    .mockResolvedValue({ ...registry, activeWorkspaceId: target });
  const stop = vi.fn(async () => {});
  const destroy = vi.fn(() => {});
  const cleanupFailure = vi.fn();
  const input: Parameters<typeof proveSelectorActivationOpening>[0] = {
    window: { isDestroyed: () => false, destroy, webContents: { executeJavaScript: execute } },
    targetWorkspaceId: target, readRegistry, readRuntime: () => ({ ...runtime }),
    inspectSwitchSlots: async () => ({ current: slot, next: undefined, backup: undefined }),
    stop, recordCleanupFailure: cleanupFailure,
  };
  return { input, slot, runtime, execute, readRegistry, stop, destroy, cleanupFailure };
}
