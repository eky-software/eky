import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenancePurpose } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { prepareWorkspaceDeletion, type WorkspaceDeletionPreparationOptions } from '../workspaces/management/workspaceDeletionPreparation.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import type { LocalWorkspaceRegistryV2, WorkspaceId } from '../workspaces/registry/workspaceRegistryTypes.js';

const targetId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const otherId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const operationId = '33333333-3333-4333-8333-333333333333';
const generationId = '44444444-4444-4444-8444-444444444444';
const label = 'Synthetic recovery target';
const choices = [{ name: 'target', persisted: targetId }, { name: 'other', persisted: otherId },
  { name: 'none', persisted: null }] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function ownerFixture(context: TestContext, persistedActiveWorkspaceId: WorkspaceId | null,
  purpose: WorkspaceMaintenancePurpose = 'delete') {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const handles: Awaited<ReturnType<typeof lease.acquire>>[] = [];
  const handle = await lease.acquire(purpose); handles.push(handle);
  const jobs: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const afterSettlement: ((passed: boolean) => Promise<void>)[] = [];
  let alive = true;
  const first = new Error('SYNTHETIC_RUNTIME_ABSENCE_LOST');
  const state = { runtimeAbsent: true, mainOwned: true };
  const check = () => {
    context.signal.throwIfAborted();
    if (!alive) throw new Error('SYNTHETIC_RECOVERY_OWNER_CLOSED');
  };
  const main = () => { check(); if (!state.mainOwned) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); };
  const runtimeCurrent = () => { check(); if (!state.runtimeAbsent) throw first; };
  const runtimeAbsent = vi.fn(async () => { runtimeCurrent(); });
  const recoveryManagement = { persistedActiveWorkspaceId, assertRuntimeCurrent: runtimeCurrent,
    assertRuntimeAbsent: runtimeAbsent };
  const reservation = { assertMainCurrent: vi.fn(main), assertMainOwned: vi.fn(async () => { main(); }) };
  const relaunch = vi.fn();
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  const options = { assertSelectorCurrent: check, reservation, kind: 'recoveryManagement' as const,
    ...recoveryManagement, assertMainOwnedAndRuntimeAbsent: runtimeAbsent,
    assertDeleteLease() { lease.captureCurrentOwner(['delete'], handle)(); } };
  let lifecycle = new MainOwnedSelectorWorkspaceLifecycle(options);
  context.onTestFinished(async ({ task }) => {
    alive = false;
    for (const release of releases) release();
    await Promise.allSettled(jobs);
    for (const owned of handles.reverse()) await owned.release();
    for (const close of afterSettlement) await close(task.result?.state === 'pass' && !context.signal.aborted);
  });
  const track = <T>(work: Promise<T>) => { jobs.push(work); void work.catch(() => undefined); return work; };
  return { lease, handle, state, first, check, main, runtimeCurrent, runtimeAbsent, reservation,
    recoveryManagement, options, relaunch, runtimeRelaunch, track, releases, afterSettlement,
    get lifecycle() { return lifecycle; },
    rebuild() { lifecycle = new MainOwnedSelectorWorkspaceLifecycle(options); },
    async replaceLease(next: WorkspaceMaintenancePurpose) {
      await handle.release(); const replacement = await lease.acquire(next); handles.push(replacement); return replacement;
    },
  };
}

async function preparationFixture(context: TestContext, persisted: WorkspaceId | null = targetId) {
  const f = await ownerFixture(context, persisted);
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-runtime-'));
  f.afterSettlement.push(async passed => { if (passed) await rm(root, { recursive: true }); });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const initial: LocalWorkspaceRegistryV2 = { formatVersion: 2, activeWorkspaceId: persisted,
    workspaces: [targetId, otherId].map((workspaceId, index) => ({
      workspaceId, workspaceLabel: index === 0 ? label : 'Synthetic retained company',
      lineageIdentity: { formatVersion: 1, profileId: (index === 0 ? 'a' : 'b').repeat(64) },
      layoutVersion: 1, lifecycleState: index === 0 && persisted !== targetId ? 'recoveryRequired' : 'ready',
      createdAt: '2026-11-01T00:00:00.000Z',
    })) };
  const sentinels: string[] = [];
  const setup = async () => {
    await registry.write(initial); f.check();
    for (const workspaceId of [targetId, otherId]) {
      const paths = deriveWorkspaceRoot(root, workspaceId, 1);
      await mkdir(paths.workspacesRoot, { recursive: true, mode: 0o700 }); f.check();
      await mkdir(paths.workspaceRoot, { mode: 0o700 }); f.check();
      const path = join(paths.workspaceRoot, 'retained.bin'); sentinels.push(path);
      await writeFile(path, Buffer.from([1, 0, 255, 23]), { flag: 'wx', mode: 0o600 }); f.check();
    }
  };
  await f.track(setup());
  const original = await readFile(registryPath);
  const recoveringRead = vi.spyOn(registry, 'read');
  const lifetime = { assertCurrent: f.check, closeAdmissionForOwnStop: vi.fn() };
  const assertLease = f.lease.captureCurrentOwner(['delete'], f.handle);
  const confirmDataLoss = vi.fn(async () => true), confirmDeletion = vi.fn(async () => true);
  const confirmReturn = vi.fn(async () => true), closeServiceAdmission = vi.fn(), setReturnGuard = vi.fn();
  const publish = vi.fn<WorkspaceDeletionPreparationOptions['publish']>(async (guard, selection, target, content) => {
    guard(); await selection(); guard();
    expect(target.workspaceId).toBe(targetId);
    expect(target.previousActiveWorkspaceId).toBe(persisted);
    expect(content.backupDisposition).toBe('explicitDataLoss');
  });
  const input: WorkspaceDeletionPreparationOptions = { operationId, runtimeGeneration: generationId,
    request: { formatVersion: 1, workspaceId: targetId, typedLabel: label, backupChoice: 'explicitDataLoss' },
    installationRoot: root, registry, lifetime,
    runtime: { kind: 'recoveryManagement', workspaceId: targetId, persistedActiveWorkspaceId: persisted,
      lifecycle: f.lifecycle, assertCurrent: f.check, async assertSelected() { f.check(); } },
    assertLease, assertMainReservation: f.reservation.assertMainOwned,
    assertMainReservationCurrent: f.reservation.assertMainCurrent,
    closeServiceAdmission, confirmDataLoss, confirmDeletion, confirmReturn, setReturnGuard, publish };
  return { ...f, input, registry, registryPath, initial, root, original, sentinels, lifetime,
    confirmDataLoss, confirmDeletion, confirmReturn, closeServiceAdmission, setReturnGuard, publish,
    start() { return f.track(prepareWorkspaceDeletion(input)); },
    async retained() {
      expect(await readFile(registryPath)).toEqual(original);
      for (const path of sentinels) expect(await readFile(path)).toEqual(Buffer.from([1, 0, 255, 23]));
      expect(recoveringRead).not.toHaveBeenCalled();
    },
  };
}

it.for(choices)('prepares only the selected recovery target with persisted $name choice and no backend', async ({ persisted }, context) => {
  const f = await preparationFixture(context, persisted);
  expect(await f.start()).toBe('prepared');
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.runtimeAbsent).toHaveBeenCalled();
  expect(f.lifecycle.readState()).toBe('stopped');
  expect(f.confirmReturn).not.toHaveBeenCalled();
  expect(f.relaunch).not.toHaveBeenCalled();
  await f.retained();
});

it.for(['early', 'afterStop'] as const)('cancels at %s without requesting a business relaunch or changing persisted choice', async (when, context) => {
  const f = await preparationFixture(context, otherId);
  (when === 'early' ? f.confirmDataLoss : f.confirmDeletion).mockResolvedValueOnce(false);
  expect(await f.start()).toBe('cancelled');
  expect(f.closeServiceAdmission).toHaveBeenCalledTimes(when === 'early' ? 0 : 1);
  expect(f.lifecycle.readState()).toBe(when === 'early' ? 'ready' : 'stopped');
  expect(f.publish).not.toHaveBeenCalled(); expect(f.setReturnGuard).not.toHaveBeenCalled();
  expect(f.confirmReturn).not.toHaveBeenCalled();
  expect(f.runtimeRelaunch.isRequested()).toBe(false);
  await f.retained();
});

it.for(['foreignTarget', 'wrongPointer', 'backup'] as const)('rejects %s before closing the management request', async (kind, context) => {
  const f = await preparationFixture(context);
  if (kind === 'foreignTarget') Object.assign(f.input.runtime, { workspaceId: otherId });
  if (kind === 'wrongPointer') Object.assign(f.input.runtime, { persistedActiveWorkspaceId: otherId });
  if (kind === 'backup') Object.assign(f.input, { request: { ...(f.input.request as object), backupChoice: 'createBackup' } });
  await expect(f.start()).rejects.toThrow(kind === 'backup'
    ? 'WORKSPACE_DELETE_BACKUP_OWNER_UNAVAILABLE' : 'WORKSPACE_DELETE_RUNTIME_MISMATCH');
  expect(f.closeServiceAdmission).not.toHaveBeenCalled();
  expect(f.reservation.assertMainOwned).not.toHaveBeenCalled(); expect(f.publish).not.toHaveBeenCalled();
  await f.retained();
});

it('rejects changed registry choice after confirmation instead of clearing it for selector mode', async context => {
  const f = await preparationFixture(context);
  f.confirmDeletion.mockImplementationOnce(async () => {
    await f.registry.write({ ...f.initial, activeWorkspaceId: otherId }); return true;
  });
  await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(f.publish).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
  expect(JSON.parse((await readFile(f.registryPath)).toString()).activeWorkspaceId).toBe(otherId);
  for (const path of f.sentinels) expect(await readFile(path)).toEqual(Buffer.from([1, 0, 255, 23]));
});

it.for(['identity', 'port', 'methods'] as const)('pins recovery preparation %s before the first await', async (changed, context) => {
  const f = await preparationFixture(context, otherId);
  const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_REPLACEMENT_LIFECYCLE'); });
  const replacement = { quiesceWrites: unexpected, stopAndProveHandlesClosed: unexpected,
    assertStoppedCurrent: unexpected, assertNoActiveWorkspaceRuntime: unexpected, ensurePreviousWorkspaceRunning: unexpected };
  if (changed === 'identity') {
    const inspect = f.registry.inspectSlots.bind(f.registry);
    vi.spyOn(f.registry, 'inspectSlots').mockImplementationOnce(async () => {
      const result = await inspect();
      Object.assign(f.input.runtime, { workspaceId: otherId, persistedActiveWorkspaceId: null }); return result;
    });
  } else {
    f.confirmDataLoss.mockImplementationOnce(async () => {
      if (changed === 'port') Object.assign(f.input.runtime, { lifecycle: replacement });
      else Object.assign(f.lifecycle, replacement);
      return true;
    });
  }
  expect(await f.start()).toBe('prepared');
  expect(unexpected).not.toHaveBeenCalled(); expect(f.publish).toHaveBeenCalledOnce();
  expect(f.runtimeAbsent).toHaveBeenCalled(); await f.retained();
});

it.for(['create', 'import', 'switch', 'backup'] as const)('does not bind a %s lease in restricted recovery lifecycle', async (purpose, context) => {
  const f = await ownerFixture(context, targetId, purpose);
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(f.runtimeAbsent).not.toHaveBeenCalled(); expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
});

it.for(['quiesce', 'stop', 'read'] as const)('joins held runtime-absence proof and rejects owner loss during %s', async (stage, context) => {
  const f = await ownerFixture(context, targetId);
  if (stage !== 'quiesce') await f.track(f.lifecycle.quiesceWrites(targetId));
  if (stage === 'read') await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  const entered = deferred(), finish = deferred(); f.releases.push(finish.resolve);
  let settled = false;
  f.runtimeAbsent.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; });
  const work = f.track<void | Readonly<{ handlesClosed: true }>>(stage === 'quiesce' ? f.lifecycle.quiesceWrites(targetId)
    : stage === 'stop' ? f.lifecycle.stopAndProveHandlesClosed(targetId) : f.lifecycle.assertNoActiveWorkspaceRuntime());
  const outcome = work.catch(error => error).finally(() => { settled = true; });
  try {
    await entered.promise; context.signal.throwIfAborted();
    f.state.runtimeAbsent = false;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); finish.resolve();
    expect(await outcome).toBe(f.first);
    f.state.runtimeAbsent = true;
    await expect(f.lifecycle.assertNoActiveWorkspaceRuntime()).rejects.toBe(f.first);
    expect(f.runtimeRelaunch.isRequested()).toBe(false);
  } finally { finish.resolve(); await outcome; }
});

it('rejects a false absence proof instead of inferring it from a physical main reservation', async context => {
  const f = await ownerFixture(context, targetId);
  Object.defineProperty(f.options, 'assertRuntimeAbsent', { value: async () => false });
  f.rebuild();
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
  expect(f.reservation.assertMainOwned).toHaveBeenCalledOnce();
  expect(f.runtimeRelaunch.isRequested()).toBe(false);
});

it('captures runtime callbacks and the persisted choice before mutable options change', async context => {
  const f = await ownerFixture(context, targetId);
  Object.assign(f.options, { persistedActiveWorkspaceId: null,
    assertRuntimeCurrent() {}, async assertRuntimeAbsent() {} });
  f.state.runtimeAbsent = false;
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toBe(f.first);
  expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
});

it('does not relaunch a recovery target even through the previous-workspace lifecycle port', async context => {
  const f = await ownerFixture(context, otherId);
  await f.track(f.lifecycle.quiesceWrites(otherId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(otherId));
  await expect(f.track(f.lifecycle.ensurePreviousWorkspaceRunning(otherId))).rejects.toThrow('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
  expect(f.runtimeRelaunch.isRequested()).toBe(false);
  await f.handle.release(); f.runtimeRelaunch.complete(); expect(f.relaunch).not.toHaveBeenCalled();
});

it('never revives restricted lifecycle authority by replacing a delete lease', async context => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  await f.replaceLease('delete');
  await expect(f.track(f.lifecycle.assertNoActiveWorkspaceRuntime())).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(f.runtimeRelaunch.isRequested()).toBe(false);
});


it('trial rejects a replacement delete lease before the first quiesce', async context => {
  const f = await ownerFixture(context, targetId);
  await f.replaceLease('delete');
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
  expect(f.runtimeAbsent).not.toHaveBeenCalled();
  expect(f.runtimeRelaunch.isRequested()).toBe(false);
});

it('trial pins the exact delete-lease callback before mutable constructor options change', async context => {
  const f = await ownerFixture(context, targetId);
  Object.assign(f.options, { assertDeleteLease() {} });
  await f.replaceLease('delete');
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
});

it('trial retains the original preparation error separately from recovery stop failure', async context => {
  const f = await preparationFixture(context, otherId);
  const first = new Error('SYNTHETIC_PREPARATION_FIRST_CAUSE');
  const cleanup = new Error('SYNTHETIC_RECOVERY_CLOSE_CAUSE');
  f.confirmDeletion.mockImplementationOnce(async () => {
    f.runtimeAbsent.mockRejectedValueOnce(cleanup); throw first;
  });
  const result = await f.start().catch(error => error);
  expect(result).toMatchObject({ firstFailure: first, cleanupFailure: cleanup, cause: first });
  expect(f.publish).not.toHaveBeenCalled(); expect(f.confirmReturn).not.toHaveBeenCalled();
  expect(f.runtimeRelaunch.isRequested()).toBe(false); await f.retained();
});

it('trial does not revive recovery lifecycle after observing a mismatched persisted pointer', async context => {
  const f = await ownerFixture(context, targetId);
  const first = await f.track(f.lifecycle.quiesceWrites(otherId)).catch(error => error);
  expect(first).toMatchObject({ message: 'WORKSPACE_RUNTIME_IDENTITY_MISMATCH' });
  await expect(f.track(f.lifecycle.quiesceWrites(targetId))).rejects.toBe(first);
  expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
});

it.for(['full', 'read'] as const)('uses one fresh combined proof for each stopped %s callback', async (kind, context) => {
  const f = await preparationFixture(context);
  Object.assign(f.input, { assertMainReservation: f.runtimeAbsent });
  let saved: (() => Promise<void>) | undefined;
  f.publish.mockImplementationOnce(async (guard, _selected, _target, _content, full, read) => {
    saved = kind === 'full' ? full : read!;
    for (let invocation = 0; invocation < 2; invocation++) {
      f.reservation.assertMainOwned.mockClear(); f.runtimeAbsent.mockClear();
      await saved(); guard();
      expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
      expect(f.runtimeAbsent).toHaveBeenCalledOnce();
    }
  });
  expect(await f.start()).toBe('prepared');
  const before = f.runtimeAbsent.mock.calls.length;
  await expect(saved!()).rejects.toThrow('WORKSPACE_DELETE_AUTHORITY_INVALID');
  expect(f.runtimeAbsent).toHaveBeenCalledTimes(before);
  await f.retained();
});

it.for(['lease', 'runtime', 'main'] as const)('rejects persistent %s loss before the combined physical proof', async (kind, context) => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  if (kind === 'lease') await f.replaceLease('delete');
  if (kind === 'runtime') f.state.runtimeAbsent = false;
  if (kind === 'main') f.state.mainOwned = false;
  const before = f.runtimeAbsent.mock.calls.length;
  await expect(f.track(f.lifecycle.assertRecoveryPreparationOwned())).rejects.toBeDefined();
  expect(f.runtimeAbsent).toHaveBeenCalledTimes(before);
  expect(f.lifecycle.readState()).toBe('stopFailed');
});

it.for(['error', 'undefined'] as const)('keeps the first combined %s failure after authority changes', async (kind, context) => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  const first = kind === 'error' ? new Error('SYNTHETIC_COMBINED_FIRST_CAUSE') : undefined;
  f.runtimeAbsent.mockRejectedValueOnce(first);
  await expect(f.track(f.lifecycle.assertRecoveryPreparationOwned())).rejects.toBe(first);
  f.state.mainOwned = false;
  await expect(f.track(f.lifecycle.assertRecoveryPreparationOwned())).rejects.toBe(first);
  expect(f.lifecycle.readState()).toBe('stopFailed');
});

it('rejects a non-void combined proof and never revives it with a later success', async context => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  f.runtimeAbsent.mockResolvedValueOnce(false as unknown as void);
  const first = await f.track(f.lifecycle.assertRecoveryPreparationOwned()).catch(error => error);
  expect(first).toMatchObject({ message: 'WORKSPACE_RUNTIME_STILL_ACTIVE' });
  await expect(f.track(f.lifecycle.assertRecoveryPreparationOwned())).rejects.toBe(first);
});

it('keeps the combined constructor callback despite mutable option replacement', async context => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  const unexpected = vi.fn(async () => undefined);
  Object.assign(f.options, { assertMainOwnedAndRuntimeAbsent: unexpected });
  f.runtimeAbsent.mockClear();
  await f.track(f.lifecycle.assertRecoveryPreparationOwned());
  expect(f.runtimeAbsent).toHaveBeenCalledOnce(); expect(unexpected).not.toHaveBeenCalled();
});

it('does not share or cache combined physical proofs between concurrent calls', async context => {
  const f = await ownerFixture(context, targetId);
  await f.track(f.lifecycle.quiesceWrites(targetId));
  await f.track(f.lifecycle.stopAndProveHandlesClosed(targetId));
  const first = deferred(), second = deferred(), both = deferred();
  f.releases.push(first.resolve, second.resolve);
  let calls = 0;
  f.runtimeAbsent.mockImplementation(async () => {
    const current = ++calls;
    if (current === 2) both.resolve();
    await (current === 1 ? first : second).promise; f.runtimeCurrent();
  });
  const a = f.track(f.lifecycle.assertRecoveryPreparationOwned());
  const b = f.track(f.lifecycle.assertRecoveryPreparationOwned());
  const joined = Promise.allSettled([a, b]);
  try {
    await both.promise; expect(calls).toBe(2);
    first.resolve(); await a;
    let secondSettled = false;
    void b.finally(() => { secondSettled = true; }).catch(() => undefined);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(secondSettled).toBe(false);
    second.resolve(); await b; expect(calls).toBe(2);
  } finally { first.resolve(); second.resolve(); await joined; }
});

it.for(['ready', 'quiesced'] as const)('refuses combined proof in %s state before physical I/O', async (state, context) => {
  const f = await ownerFixture(context, targetId);
  if (state === 'quiesced') await f.track(f.lifecycle.quiesceWrites(targetId));
  f.runtimeAbsent.mockClear(); f.reservation.assertMainOwned.mockClear();
  await expect(f.track(f.lifecycle.assertRecoveryPreparationOwned())).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
  expect(f.runtimeAbsent).not.toHaveBeenCalled(); expect(f.reservation.assertMainOwned).not.toHaveBeenCalled();
});

it('does not expose the combined recovery proof to an ordinary selector', async context => {
  const f = await ownerFixture(context, null);
  const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ assertSelectorCurrent: f.check,
    reservation: f.reservation, maintenanceLease: f.lease, runtimeRelaunch: f.runtimeRelaunch });
  await f.track(lifecycle.quiesceWrites(null));
  await f.track(lifecycle.stopAndProveHandlesClosed(null));
  const before = f.reservation.assertMainOwned.mock.calls.length;
  await expect(f.track(lifecycle.assertRecoveryPreparationOwned())).rejects.toThrow('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
  expect(f.reservation.assertMainOwned).toHaveBeenCalledTimes(before);
});

it.for(['port', 'method'] as const)('captures the combined preparation %s before its first await', async (kind, context) => {
  const f = await preparationFixture(context);
  const unexpected = vi.fn(async () => { throw new Error('SYNTHETIC_REPLACED_COMBINED_PROOF'); });
  f.confirmDataLoss.mockImplementationOnce(async () => {
    if (kind === 'method') Object.assign(f.lifecycle, { assertRecoveryPreparationOwned: unexpected });
    else Object.assign(f.input.runtime, { lifecycle: { ...f.lifecycle, assertRecoveryPreparationOwned: unexpected } });
    return true;
  });
  f.publish.mockImplementationOnce(async (guard, _selected, _target, _content, full, read) => {
    await full(); await read!(); guard();
  });
  expect(await f.start()).toBe('prepared'); expect(unexpected).not.toHaveBeenCalled(); await f.retained();
});

it.for(['full', 'read'] as const)('joins the held %s proof after its request loses the lease', async (kind, context) => {
  const f = await preparationFixture(context);
  const entered = deferred(), release = deferred(); f.releases.push(release.resolve);
  let settled = false, physicalSettled = false;
  const first = new Error('SYNTHETIC_HELD_COMBINED_PROOF');
  f.publish.mockImplementationOnce(async (_guard, _selected, _target, _content, full, read) => {
    f.runtimeAbsent.mockImplementationOnce(async () => { entered.resolve(); await release.promise; physicalSettled = true; throw first; });
    await (kind === 'full' ? full : read!)();
  });
  const result = f.start().then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await entered.promise; await f.replaceLease('delete');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(physicalSettled).toBe(false);
    release.resolve();
    const outcome = await result;
    expect(outcome).toHaveProperty('error');
    const failure = (outcome as { error: unknown }).error;
    expect(failure instanceof Error && 'firstFailure' in failure ? failure.firstFailure : failure).toBe(first);
    expect(physicalSettled).toBe(true);
  } finally { release.resolve(); await result; }
  await f.retained();
});

it.for(['error', 'undefined'] as const)('keeps combined %s rejection separate from stop cleanup failure', async (kind, context) => {
  const f = await preparationFixture(context);
  const first = kind === 'error' ? new Error('SYNTHETIC_COMBINED_READ_FIRST') : undefined;
  const cleanup = new Error('SYNTHETIC_COMBINED_STOP_CLEANUP');
  const stop = f.lifecycle.stopAndProveHandlesClosed.bind(f.lifecycle);
  let stops = 0;
  vi.spyOn(f.lifecycle, 'stopAndProveHandlesClosed').mockImplementation(async previous => {
    if (++stops > 1) throw cleanup;
    return stop(previous);
  });
  f.publish.mockImplementationOnce(async (_guard, _selected, _target, _content, _full, read) => {
    f.runtimeAbsent.mockRejectedValueOnce(first); await read!();
  });
  const error = await f.start().catch(error => error);
  expect(error).toMatchObject({ message: 'WORKSPACE_DELETE_PREPARATION_FAILED', firstFailure: first, cleanupFailure: cleanup });
  expect(error.cause).toBe(first); expect(stops).toBe(2); await f.retained();
});
