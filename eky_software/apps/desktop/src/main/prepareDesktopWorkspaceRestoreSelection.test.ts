import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { prepareDesktopWorkspaceRestoreSelection } from './prepareDesktopWorkspaceRestoreSelection.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-main-restore-selection-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const path = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: path });
  await registry.write({ formatVersion: 2, activeWorkspaceId: workspaceId, workspaces: [{
    workspaceId, workspaceLabel: 'Synthetic company', layoutVersion: 1, lifecycleState: 'ready',
    lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) }, createdAt: '2026-10-29T00:00:00.000Z',
  }] });
  const before = await readFile(path);
  const maintenanceLease = new InMemoryWorkspaceMaintenanceLease();
  const input = {
    selection: { userDataRoot: root, operationId, workspaceId, lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) },
      mode: 'normal' as const },
    sources: { registry, switchJournal: new WorkspaceSwitchJournalStore(root) }, maintenanceLease,
    assertAuthority: vi.fn(), assertMainOwned: vi.fn(async () => {}), assertJournalSelection: vi.fn(async () => {}),
    onUnsettledWork: vi.fn(),
  };
  return { input, maintenanceLease,
    async assertPreserved() { expect(await readFile(path)).toEqual(before); },
  };
}

describe('main workspace restore selection preparation', () => {
  it.for([false, true])('rejects an asynchronous owner before acquiring a lease (rejects: %s)', async (rejects, context) => {
    const f = await fixture(context);
    const acquire = vi.spyOn(f.maintenanceLease, 'acquire');
    f.input.assertAuthority.mockImplementationOnce(() => rejects
      ? Promise.reject(new Error('synthetic async ownership')) : Promise.resolve());
    await expect(prepareDesktopWorkspaceRestoreSelection({ ...f.input, signal: new AbortController().signal }))
      .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(acquire).not.toHaveBeenCalled();
    expect(f.maintenanceLease.readState()).toBe('idle');
    await f.assertPreserved();
  });

  it('releases only the completed cold preparation lease and accepts a fresh phase owner', async context => {
    const f = await fixture(context);
    const selected = await prepareDesktopWorkspaceRestoreSelection({ ...f.input, deadline: performance.now() + 35_000 });
    expect(f.maintenanceLease.readState()).toBe('idle');
    expect(f.input.onUnsettledWork).not.toHaveBeenCalled();
    const lease = await f.maintenanceLease.acquire('restore');
    try { await selected.assertCurrent(f.maintenanceLease.captureCurrentOwner(['restore'], lease)); }
    finally { await lease.release(); }
    await f.assertPreserved();
  });

  it('pins the input before asynchronous acquisition and keeps accepted preparation within its caller scope', async context => {
    const f = await fixture(context);
    const signal = new AbortController();
    const original = prepareDesktopWorkspaceRestoreSelection({ ...f.input, signal: signal.signal });
    f.input.selection.lineageIdentity.profileId = 'b'.repeat(64);
    const selected = await original;
    expect(selected.mode).toBe('legacyUnbound');
    expect(f.maintenanceLease.readState()).toBe('idle');
    signal.abort();
    expect(f.input.onUnsettledWork).not.toHaveBeenCalled();
    await selected.assertCurrent(() => {});
    await f.assertPreserved();
  });

  it('uses the supplied cold deadline and retains ownership through a late original read', async context => {
    const f = await fixture(context);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const entered = gate();
    const finish = gate();
    f.input.assertJournalSelection.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    const deadline = performance.now() + 35_000;
    await vi.advanceTimersByTimeAsync(10_000);
    const original = prepareDesktopWorkspaceRestoreSelection({ ...f.input, deadline });
    const failed = expect(original).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    await entered.promise;
    await vi.advanceTimersByTimeAsync(25_000);
    await failed;
    expect(f.input.onUnsettledWork).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('busy');
    finish.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.input.assertJournalSelection).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('busy');
    expect(vi.getTimerCount()).toBe(0);
    await f.assertPreserved();
  });

  it('returns the original accepted task through cancellation instead of a settled abort proxy', async context => {
    const f = await fixture(context);
    const entered = gate();
    const finish = gate();
    const signal = new AbortController();
    f.input.assertJournalSelection.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
    let settled = false;
    const original = prepareDesktopWorkspaceRestoreSelection({ ...f.input, signal: signal.signal });
    const result = original.then(() => { settled = true; return 'completed'; }, () => { settled = true; return 'failed'; });
    await entered.promise;
    signal.abort();
    expect(settled).toBe(false);
    expect(f.input.onUnsettledWork).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('busy');
    finish.resolve();
    expect(await result).toBe('failed');
    expect(f.input.assertJournalSelection).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('busy');
    await f.assertPreserved();
  });

  it('preserves a preparation error separately from a failed lease release', async context => {
    const f = await fixture(context);
    const first = new Error('synthetic first journal failure');
    const cleanup = new Error('synthetic lease release failure');
    const lease = { release: vi.fn(async () => { throw cleanup; }) };
    f.input.assertJournalSelection.mockRejectedValueOnce(first);
    const original = prepareDesktopWorkspaceRestoreSelection({ ...f.input, signal: new AbortController().signal,
      maintenanceLease: { acquire: async () => lease, captureCurrentOwner: () => () => {} },
    });
    await expect(original).rejects.toMatchObject({ errors: [first, cleanup] });
    expect(f.input.onUnsettledWork).toHaveBeenCalledWith(first);
    await f.assertPreserved();
  });
});
