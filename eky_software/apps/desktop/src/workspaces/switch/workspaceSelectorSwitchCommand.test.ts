import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { WorkspaceSwitchCoordinator } from './workspaceSwitchCoordinator.js';
import { createWorkspaceSwitchJournalPaths, WorkspaceSwitchJournalStore } from './workspaceSwitchJournal.js';
import { resolveWorkspaceSelectorSwitchStartup } from './workspaceSelectorSwitchStartup.js';
import { createWorkspaceSelectorSwitchRegistryVariants } from './workspaceSelectorSwitchState.js';
import { createSwitchRegistry, TEST_SWITCH_CREATED_AT, TEST_SWITCH_OPERATION_ID,
  TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from './workspaceSwitchTestSupport.js';

const variants = createWorkspaceSelectorSwitchRegistryVariants({
  ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null,
}, TEST_TARGET_WORKSPACE_ID);

it('publishes source-null through the existing command and selected stores before requesting relaunch', async test => {
  const f = await fixture(test);
  const legacyRead = vi.spyOn(f.registry, 'read');
  const legacyWrite = vi.spyOn(f.registry, 'write');
  const legacyJournal = vi.spyOn(f.journal, 'read');
  await f.command.switchTo(TEST_TARGET_WORKSPACE_ID);
  expect(await f.registry.inspect()).toEqual(variants.selected);
  expect((await f.journal.inspectSlots()).current?.value).toMatchObject({
    formatVersion: 2, sourceWorkspaceId: null, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, state: 'targetSelected',
  });
  expect(f.lease.readState()).toBe('idle');
  expect(f.relaunch.isRequested()).toBe(true);
  expect(f.launch).not.toHaveBeenCalled();
  expect(legacyRead).not.toHaveBeenCalled();
  expect(legacyWrite).not.toHaveBeenCalled();
  expect(legacyJournal).not.toHaveBeenCalled();
  expect(() => f.lifecycle.assertStoppedCurrent()).toThrow();
  f.relaunch.complete();
  expect(f.launch).toHaveBeenCalledExactlyOnceWith();
  const startup = await f.resolve();
  expect(startup.mode).toBe('targetValidation');
  if (startup.mode !== 'targetValidation') throw new Error('expected target validation');
  expect(startup.context.sourceWorkspaceId).toBeNull();
  // The test controls terminal proof; this is not business-health acceptance.
  await startup.accept('b'.repeat(64));
  expect((await f.journal.inspectSlots()).current).toBeUndefined();
  expect(await f.registry.inspect()).toEqual(variants.selected);
});

it.for(['next', 'backup', 'selected', 'legacy', 'missing', 'invalidTarget'] as const)(
  'rejects %s registry admission without quiescence or repairing read', async (kind, test) => {
    const f = await fixture(test);
    if (kind === 'missing') await rm(f.registryPath);
    else if (kind === 'legacy') await writeFile(f.registryPath, serializeWorkspaceRegistry(createSwitchRegistry()));
    else if (kind === 'selected') await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.selected));
    else if (kind === 'invalidTarget') await writeFile(f.registryPath, serializeWorkspaceRegistry({
      ...variants.before, workspaces: variants.before.workspaces.filter(entry => entry.workspaceId !== TEST_TARGET_WORKSPACE_ID),
    }));
    else await writeFile(f.registryPath + '.' + kind, serializeWorkspaceRegistry(variants.before));
    const before = await f.snapshot();
    const quiesce = vi.spyOn(f.lifecycle, 'quiesceWrites');
    await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_INVALID');
    expect(quiesce).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
    expect(f.relaunch.isRequested()).toBe(false);
    expect(f.lease.readState()).toBe('idle');
  },
);

it.for(['current', 'next', 'backup'] as const)('preserves existing %s journal before any runtime transition', async (slot, test) => {
  const f = await fixture(test);
  await writeFile(f.paths[`${slot}Path`], 'unresolved evidence');
  const before = await f.snapshot();
  const quiesce = vi.spyOn(f.lifecycle, 'quiesceWrites');
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(quiesce).not.toHaveBeenCalled();
  expect(f.relaunch.isRequested()).toBe(false);
});

it('does not release a foreign maintenance lease', async test => {
  const f = await fixture(test);
  const owner = await f.lease.acquire('import');
  try {
    const before = await f.snapshot();
    await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_BUSY');
    expect(f.lease.readState()).toBe('busy');
    expect(await f.snapshot()).toEqual(before);
  } finally { await owner.release(); }
});

it.for(['generation', 'reservation'] as const)('does not publish when %s is lost during stop', async (kind, test) => {
  const f = await fixture(test);
  const original = f.lifecycle.stopAndProveHandlesClosed.bind(f.lifecycle);
  vi.spyOn(f.lifecycle, 'stopAndProveHandlesClosed').mockImplementation(async id => {
    const result = await original(id);
    if (kind === 'generation') f.state.current = false;
    else f.state.owned = false;
    return result;
  });
  const before = await f.snapshot();
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await f.snapshot()).toEqual(before);
  expect(f.relaunch.isRequested()).toBe(false);
});

it.for(['bytes', 'identity'] as const)('rejects changed registry %s after quiescence without overwriting it', async (kind, test) => {
  const f = await fixture(test);
  const original = f.lifecycle.stopAndProveHandlesClosed.bind(f.lifecycle);
  let changed: Awaited<ReturnType<typeof f.snapshot>>;
  vi.spyOn(f.lifecycle, 'stopAndProveHandlesClosed').mockImplementation(async id => {
    const result = await original(id);
    if (kind === 'identity') {
      await rename(f.registryPath, f.registryPath + '.retained');
      await writeFile(f.registryPath, serializeWorkspaceRegistry(variants.before), { flag: 'wx' });
    } else await writeFile(f.registryPath, serializeWorkspaceRegistry({ ...variants.before,
      workspaces: variants.before.workspaces.map(entry => entry.workspaceId === TEST_SOURCE_WORKSPACE_ID
        ? { ...entry, workspaceLabel: 'Changed independently' } : entry),
    }));
    changed = await f.snapshot();
    return result;
  });
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await f.snapshot()).toEqual(changed!);
  expect(f.relaunch.isRequested()).toBe(false);
});

it.for(['prepared', 'registry', 'committed'] as const)(
  'retains a lost %s acknowledgement and lets the existing startup classify the exact persisted state', async (stage, test) => {
    const f = await fixture(test);
    const first = new Error('SYNTHETIC_PUBLICATION_ACK_LOST');
    if (stage === 'registry') {
      const original = f.registry.writeSelected.bind(f.registry);
      vi.spyOn(f.registry, 'writeSelected').mockImplementation(async (...args) => { await original(...args); throw first; });
    } else {
      const original = f.journal.writeSelector.bind(f.journal);
      let writes = 0;
      vi.spyOn(f.journal, 'writeSelector').mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++writes === (stage === 'prepared' ? 1 : 2)) throw first;
        return result;
      });
    }
    await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toMatchObject({
      code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED', cause: first,
    });
    expect(f.relaunch.isRequested()).toBe(false);
    expect(f.lease.readState()).toBe('idle');
    expect((await f.journal.inspectSlots()).current?.value.state).toBe(stage === 'committed' ? 'targetSelected' : 'prepared');
    expect(await f.registry.inspect()).toEqual(stage === 'prepared' ? variants.before : variants.selected);
    vi.restoreAllMocks();
    const startup = await f.resolve();
    expect(startup.mode).toBe(stage === 'prepared' ? 'selector' : 'targetValidation');
    expect(await f.registry.inspect()).toEqual(stage === 'prepared' ? variants.before : variants.selected);
  },
);

it('rejects an identical-byte replacement of the just-published journal', async test => {
  const f = await fixture(test);
  const original = f.journal.writeSelector.bind(f.journal);
  vi.spyOn(f.journal, 'writeSelector').mockImplementation(async (...args) => {
    const result = await original(...args);
    const bytes = await readFile(f.paths.currentPath);
    await rename(f.paths.currentPath, f.paths.currentPath + '.retained');
    await writeFile(f.paths.currentPath, bytes, { flag: 'wx' });
    return result;
  });
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect(await f.registry.inspect()).toEqual(variants.before);
  expect(await readFile(f.paths.currentPath)).toEqual(await readFile(f.paths.currentPath + '.retained'));
  expect(f.relaunch.isRequested()).toBe(false);
});

it('rechecks physical ownership after publication before requesting relaunch', async test => {
  const f = await fixture(test);
  const original = f.journal.writeSelector.bind(f.journal);
  let writes = 0;
  vi.spyOn(f.journal, 'writeSelector').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (++writes === 2) f.assertOwned.mockRejectedValue(new Error('RESERVATION_NOT_PROVEN'));
    return result;
  });
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  expect((await f.journal.inspectSlots()).current?.value.state).toBe('targetSelected');
  expect(await f.registry.inspect()).toEqual(variants.selected);
  expect(f.relaunch.isRequested()).toBe(false);
});

it.for([false, true])('does not request relaunch on lease release failure; prior publication failure: %s', async (priorFailure, test) => {
  const f = await fixture(test);
  const acquire = f.lease.acquire.bind(f.lease);
  const releaseError = new Error('LEASE_RELEASE_FAILED');
  vi.spyOn(f.lease, 'acquire').mockImplementation(async purpose => {
    const owner = await acquire(purpose);
    return { async release() { await owner.release(); throw releaseError; } };
  });
  const first = new Error('FIRST_PUBLICATION_FAILED');
  if (priorFailure) vi.spyOn(f.journal, 'writeSelector').mockRejectedValue(first);
  await expect(f.command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toMatchObject({
    code: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED', cause: priorFailure ? first : releaseError,
  });
  expect(f.relaunch.isRequested()).toBe(false);
});

it('rejects a promise-returning admission callback before reading or changing files', async test => {
  const f = await fixture(test);
  const before = await f.snapshot();
  const command = new WorkspaceSwitchCoordinator({ ...f.options, assertCurrent: async () => undefined });
  await expect(command.switchTo(TEST_TARGET_WORKSPACE_ID)).rejects.toThrow('WORKSPACE_SWITCH_INVALID');
  expect(await f.snapshot()).toEqual(before);
  expect(f.relaunch.isRequested()).toBe(false);
});

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-command-'));
  test.onTestFinished(async () => {
    vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const journal = new WorkspaceSwitchJournalStore(root);
  const paths = createWorkspaceSwitchJournalPaths(root);
  await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
  await writeFile(registryPath, serializeWorkspaceRegistry(variants.before), { mode: 0o600 });
  const state = { current: true, owned: true };
  const assertCurrent = () => { if (!state.current) throw new Error('SELECTOR_EXPIRED'); };
  const assertMainCurrent = () => { if (!state.owned) throw new Error('RESERVATION_LOST'); };
  const assertOwned = vi.fn(async () => assertMainCurrent());
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const launch = vi.fn();
  const relaunch = new DeferredWorkspaceRuntimeRelaunch(launch);
  const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ assertSelectorCurrent: assertCurrent,
    reservation: { assertMainCurrent, assertMainOwned: assertOwned }, maintenanceLease: lease, runtimeRelaunch: relaunch });
  const options = { mode: 'selector' as const, registry, journal, maintenanceLease: lease,
    activeWorkspaceLifecycle: lifecycle, assertCurrent, generateOperationId: () => TEST_SWITCH_OPERATION_ID,
    now: () => new Date(TEST_SWITCH_CREATED_AT), relaunchApplication: () => relaunch.request() };
  return { state, root, registryPath, registry, journal, paths, lease, lifecycle, assertOwned, launch, relaunch, options,
    command: new WorkspaceSwitchCoordinator(options),
    async resolve() {
      return resolveWorkspaceSelectorSwitchStartup({ registry, journal,
        authority: { assertCurrent, proveTerminal: async () => ({ assertCurrent }) },
        selection: { registrySlots: await registry.inspectSlots(), journalSlots: await journal.inspectSlots(),
          readRegistrySlots: () => registry.inspectSlots(), assertAuthority: assertCurrent } });
    },
    async snapshot() {
      const result: Record<string, string | null> = {};
      for (const [owner, file] of [['registry', registryPath], ['journal', paths.currentPath]] as const) {
        for (const suffix of ['', '.next', '.backup']) {
          try { result[owner + suffix] = (await readFile(file + suffix)).toString('hex'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; result[owner + suffix] = null; }
        }
      }
      return result;
    },
  };
}
