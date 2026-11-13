import { expect, it, vi, type TestContext } from 'vitest';
import { WorkspaceManagementService, type WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { parseWorkspaceRecoveryManagementStatus } from './workspaceManagementStatus.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceDeletionPreparationLifetime } from './workspaceManagementTypes.js';

const targetId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const otherId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const request = Object.freeze({ formatVersion: 1, workspaceId: targetId, typedLabel: 'Synthetic target', backupChoice: 'explicitDataLoss' });
type Mode = NonNullable<WorkspaceManagementServiceOptions['recoveryManagement']>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(context: TestContext) {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const jobs: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const pending = new Set<Promise<unknown>>();
  const handles: Awaited<ReturnType<typeof lease.acquire>>[] = [];
  const first = new Error('SYNTHETIC_RECOVERY_SERVICE_OWNER_LOST');
  const changed = new Error('SYNTHETIC_RECOVERY_SERVICE_SELECTION_CHANGED');
  const state = { ownerCurrent: true, selected: true, prepared: false };
  let acknowledgedShutdown: { cause: unknown } | undefined;
  let alive = true;
  const check = () => { context.signal.throwIfAborted(); if (!alive || !state.ownerCurrent) throw first; };
  const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_FORBIDDEN_COORDINATOR'); });
  const genericGuard = vi.fn((): never => { throw new Error('SYNTHETIC_ORDINARY_RECOVERY_GUARD'); });
  const registryRead = vi.fn((): never => { throw new Error('SYNTHETIC_REPAIRING_REGISTRY_READ'); });
  const selected = vi.fn<Mode['assertSelected']>(async () => { check(); if (!state.selected) throw changed; });
  const readStatus = vi.fn<Mode['readStatus']>(async phase => {
    const maintenance = lease.captureStatusObservation();
    const value = parseWorkspaceRecoveryManagementStatus({ formatVersion: 2, mode: 'recoveryManagement',
      runtimeState: 'absent', maintenanceState: maintenance.state,
      ...(phase.operationState === 'busy' || maintenance.state === 'busy' ? { operationState: 'busy' }
        : { operationState: 'idle', persistedActiveWorkspaceId: otherId,
          target: { workspaceId: targetId, workspaceLabel: 'Synthetic target' } }),
    });
    return Object.freeze({ value, assertCurrent() { check(); phase.assertCurrent(); maintenance.assertCurrent(); } });
  });
  const recoveryManagement: Mode = { targetWorkspaceId: targetId, assertCurrent: check, assertSelected: selected, readStatus };
  const completeReturn = vi.fn(() => { throw new Error('SYNTHETIC_BUSINESS_RETURN_FORBIDDEN'); });
  const acquire = vi.fn(async (...args: Parameters<typeof lease.acquire>) => {
    const handle = await lease.acquire(...args); handles.push(handle); return handle;
  });
  const captureLease = vi.fn(lease.captureCurrentOwner.bind(lease));
  let capturedLifetime: WorkspaceDeletionPreparationLifetime | undefined;
  const prepare = vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionPreparation']>['prepare']>(async (_request, lifetime, owned) => {
    capturedLifetime = lifetime; lifetime.assertCurrent(); owned();
    return state.prepared ? 'prepared' : 'cancelled';
  });
  const completed = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const });
  const recordRemoved = vi.fn(() => completed);
  const continuation = {
    captureAuthority: vi.fn(() => ({ assertCurrent: check, async assertOwned() { check(); }, recordRemoved })),
    resume: vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>(async (_operation, owner) => {
      owner.assertCurrent(); await owner.assertOwned(); owner.recordRemoved({ synthetic: true }); return completed;
    }),
  };
  const observer = { record: vi.fn() };
  const options: WorkspaceManagementServiceOptions = { recoveryManagement, observer,
    deletionPreparation: { prepare, maintenanceLease: { acquire, captureCurrentOwner: captureLease } },
    deletionContinuation: continuation,
  };
  // Deliberately malformed caller options prove that restricted construction and commands
  // never inspect ordinary dependencies. No such dependencies are supplied by main.
  Object.defineProperties(options, {
    createEmpty: { get: unexpected }, importBackup: { get: unexpected }, replaceActive: { get: unexpected },
    switchWorkspace: { get: unexpected }, renameWorkspace: { get: unexpected },
    registry: { get: registryRead }, operationGuard: { get: genericGuard },
    runtimeRelaunchCompletion: { get: completeReturn },
  });
  const service = new WorkspaceManagementService(options);
  const caller = { assertCurrent: vi.fn(check), closeAdmissionForOwnStop: vi.fn() };
  const track = <T>(job: Promise<T>) => {
    jobs.push(job);
    pending.add(job);
    void job.then(() => pending.delete(job), () => pending.delete(job));
    return job;
  };
  context.onTestFinished(async () => {
    const unfinished = pending.size;
    for (const release of releases) release();
    await Promise.allSettled(jobs);
    alive = false;
    let closeFailure: { cause: unknown } | undefined;
    try { await service.shutdown(); } catch (cause) { closeFailure = { cause }; }
    for (const handle of handles) await handle.release();
    if (closeFailure !== undefined && (acknowledgedShutdown === undefined || closeFailure.cause !== acknowledgedShutdown.cause)) {
      throw closeFailure.cause;
    }
    if (unfinished !== 0) throw new Error('SYNTHETIC_RECOVERY_SERVICE_UNFINISHED_WORK');
  });
  return { service, options, recoveryManagement, lease, state, first, changed, check,
    selected, readStatus, genericGuard, registryRead, unexpected, completeReturn, acquire, captureLease,
    prepare, continuation, recordRemoved, observer, caller, track, releases,
    get capturedLifetime() { return capturedLifetime; },
    acknowledgeShutdown(cause: unknown) { acknowledgedShutdown = { cause }; },
  };
}

it('keeps ordinary v1 status closed without repairing registry or reading recovery journals', async context => {
  const f = fixture(context);
  await expect(f.track(f.service.getStatus())).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
  expect(f.registryRead).not.toHaveBeenCalled(); expect(f.genericGuard).not.toHaveBeenCalled();
  expect(f.readStatus).not.toHaveBeenCalled(); expect(f.completeReturn).not.toHaveBeenCalled();
});

it('returns a frozen private v2 observation without granting command or registry authority', async context => {
  const f = fixture(context);
  const observed = await f.track(f.service.getRecoveryManagementStatus());
  expect(observed.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
    maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: otherId,
    target: { workspaceId: targetId, workspaceLabel: 'Synthetic target' } });
  expect(Object.isFrozen(observed)).toBe(true); expect(Object.isFrozen(observed.value)).toBe(true);
  observed.assertCurrent();
  expect(f.selected).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  expect(f.registryRead).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
});

it('returns target-free recovery-required status without granting deletion authority', async context => {
  const f = fixture(context);
  const value = parseWorkspaceRecoveryManagementStatus({ formatVersion: 2, mode: 'recoveryManagement',
    runtimeState: 'absent', maintenanceState: 'idle', operationState: 'recoveryRequired' });
  f.readStatus.mockResolvedValueOnce({ value, assertCurrent: f.check });
  const observed = await f.track(f.service.getRecoveryManagementStatus());
  expect(observed.value).toEqual(value);
  observed.assertCurrent();
  expect(f.selected).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  expect(f.registryRead).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  f.selected.mockRejectedValueOnce(f.changed);
  await expect(f.track(f.service.deleteWorkspace(request, f.caller))).rejects.toMatchObject({ cause: f.changed });
  expect(f.acquire).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
});

it('uses fresh command proof independently of a target-free status projection', async context => {
  const f = fixture(context);
  const value = parseWorkspaceRecoveryManagementStatus({ formatVersion: 2, mode: 'recoveryManagement',
    runtimeState: 'absent', maintenanceState: 'idle', operationState: 'recoveryRequired' });
  f.readStatus.mockResolvedValueOnce({ value, assertCurrent: f.check });
  const observed = await f.track(f.service.getRecoveryManagementStatus());
  expect(observed.value).toEqual(value);
  expect(f.selected).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  expect(await f.track(f.service.deleteWorkspace(request, f.caller))).toEqual({ formatVersion: 1, status: 'cancelled' });
  expect(f.selected).toHaveBeenCalledTimes(2);
  expect(f.acquire).toHaveBeenCalledWith('delete');
  expect(f.prepare).toHaveBeenCalledOnce();
});

it.for(['create', 'import', 'replace', 'switch', 'rename'] as const)('rejects restricted %s before any coordinator or generic recovery bypass', async (kind, context) => {
  const f = fixture(context);
  const outcome = kind === 'create' ? f.service.createEmpty('Synthetic')
    : kind === 'import' ? f.service.importBackupAsNew({ containerPath: 'synthetic.backup', password: 'Synthetic only', workspaceLabel: 'Synthetic' })
      : kind === 'replace' ? f.service.replaceActiveFromBackup({ containerPath: 'synthetic.backup', password: 'Synthetic only', targetWorkspaceId: targetId })
        : kind === 'switch' ? f.service.switchTo(otherId) : f.service.rename(targetId, 'Synthetic renamed');
  await expect(f.track<unknown>(outcome)).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', operationKind: kind });
  expect(f.unexpected).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
  expect(f.genericGuard).not.toHaveBeenCalled(); expect(f.selected).not.toHaveBeenCalled();
  expect(f.completeReturn).not.toHaveBeenCalled();
});

it('rejects the preparation-only command in restricted mode', async context => {
  const f = fixture(context);
  await expect(f.track(f.service.prepareDeletion(request, f.caller)))
    .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
  expect(f.acquire).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
});

it('reports the live command stage in restricted recovery management without opening ordinary dependencies', async context => {
  const f = fixture(context), first = new Error('SYNTHETIC_RECOVERY_PURGE_FAILURE');
  f.state.prepared = true;
  f.continuation.resume.mockImplementationOnce(async (_operation, owner, observeStage) => {
    await owner.assertOwned();
    observeStage!('deletePurge');
    throw first;
  });
  await expect(f.track(f.service.deleteWorkspace(request, f.caller))).rejects.toMatchObject({ cause: first });
  expect(f.observer.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    operationKind: 'delete', stage: 'deletePurge', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown',
  }));
  expect(f.recordRemoved).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  expect(f.genericGuard).not.toHaveBeenCalled(); expect(f.registryRead).not.toHaveBeenCalled();
  expect(f.unexpected).not.toHaveBeenCalled(); expect(f.completeReturn).not.toHaveBeenCalled();
});

it('rejects a different deletion target before lease acquisition and reports proven no effect', async context => {
  const f = fixture(context), reports = vi.fn();
  await expect(f.track(f.service.deleteWorkspace({ ...request, workspaceId: otherId }, f.caller, reports)))
    .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
  expect(reports).toHaveBeenCalledOnce(); expect(reports.mock.calls[0]![0].sideEffectState).toBe('none');
  expect(f.acquire).not.toHaveBeenCalled(); expect(f.selected).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
});

it('uses the exact selected proof before and after its real delete lease without invoking ordinary recovery', async context => {
  const f = fixture(context);
  expect(await f.track(f.service.deleteWorkspace(request, f.caller))).toEqual({ formatVersion: 1, status: 'cancelled' });
  expect(f.selected).toHaveBeenCalledTimes(2); expect(f.acquire).toHaveBeenCalledWith('delete');
  expect(f.prepare).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
  expect(f.genericGuard).not.toHaveBeenCalled(); expect(f.completeReturn).not.toHaveBeenCalled();
});

it('rechecks selection changed during lease acquisition before invoking preparation', async context => {
  const f = fixture(context), acquire = f.options.deletionPreparation!.maintenanceLease.acquire;
  f.acquire.mockImplementationOnce(async purpose => {
    const handle = await f.lease.acquire(purpose); f.state.selected = false; return handle;
  });
  await expect(f.track(f.service.deleteWorkspace(request, f.caller))).rejects.toMatchObject({ cause: f.changed });
  expect(f.selected).toHaveBeenCalledTimes(2); expect(f.prepare).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle'); expect(f.completeReturn).not.toHaveBeenCalled();
  expect(acquire).toBe(f.acquire);
});

it('rejects false selection proof before acquiring any lease', async context => {
  const f = fixture(context);
  f.selected.mockResolvedValueOnce(false as never);
  await expect(f.track(f.service.deleteWorkspace(request, f.caller))).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  expect(f.acquire).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
});

it('does not enter preparation after admission closes during the second selected read', async context => {
  const f = fixture(context), entered = deferred(), finish = deferred(); f.releases.push(finish.resolve);
  f.selected.mockImplementationOnce(async () => { f.check(); })
    .mockImplementationOnce(async () => { entered.resolve(); await finish.promise; f.check(); });
  const command = f.track(f.service.deleteWorkspace(request, f.caller));
  try {
    await entered.promise; context.signal.throwIfAborted();
    f.service.closeAdmission(); finish.resolve();
    await expect(command).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
    expect(f.completeReturn).not.toHaveBeenCalled();
  } finally { finish.resolve(); await Promise.allSettled([command]); }
});

it('does not manufacture restricted status on an ordinary service', async context => {
  const f = fixture(context);
  const ordinary = new WorkspaceManagementService({
    createEmpty: { create: f.unexpected }, importBackup: { import: f.unexpected },
    switchWorkspace: { switchTo: f.unexpected }, renameWorkspace: { rename: f.unexpected },
    registry: { read: f.registryRead }, maintenanceState: f.lease,
    operationGuard: { assertNoUnresolvedOperations: f.genericGuard, readRecoveryState: f.unexpected },
  });
  try {
    await expect(f.track(ordinary.getRecoveryManagementStatus())).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
    expect(f.registryRead).not.toHaveBeenCalled(); expect(f.readStatus).not.toHaveBeenCalled();
  } finally { await ordinary.shutdown(); }
});

it('constructs restricted status with no ordinary command, registry or runtime-return dependency', async context => {
  const f = fixture(context);
  const restricted = new WorkspaceManagementService({ recoveryManagement: f.recoveryManagement });
  try {
    const observed = await f.track(restricted.getRecoveryManagementStatus());
    observed.assertCurrent(); expect(observed.value.operationState).toBe('idle');
    await expect(f.track(restricted.getStatus())).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    await expect(f.track(restricted.createEmpty('Synthetic forbidden'))).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    expect(f.selected).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
    expect(f.registryRead).not.toHaveBeenCalled(); expect(f.genericGuard).not.toHaveBeenCalled();
  } finally { await restricted.shutdown(); }
});

it('holds the command busy projection without repeating obsolete selected reads', async context => {
  const f = fixture(context), entered = deferred(), finish = deferred(); f.releases.push(finish.resolve);
  f.prepare.mockImplementationOnce(async (_request, lifetime, owned) => {
    entered.resolve(); await finish.promise; lifetime.assertCurrent(); owned(); return 'cancelled';
  });
  const command = f.track(f.service.deleteWorkspace(request, f.caller));
  try {
    await entered.promise; context.signal.throwIfAborted();
    const before = f.selected.mock.calls.length;
    const observed = await f.track(f.service.getRecoveryManagementStatus());
    expect(observed.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
      maintenanceState: 'busy', operationState: 'busy' });
    expect(f.selected).toHaveBeenCalledTimes(before);
    finish.resolve(); await command;
    expect(observed.assertCurrent).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  } finally { finish.resolve(); await Promise.allSettled([command]); }
});

it('keeps a request-local status failure separate from the selected command owner', async context => {
  const f = fixture(context), first = new Error('SYNTHETIC_STATUS_READ_FAILURE');
  f.readStatus.mockRejectedValueOnce(first);
  await expect(f.track(f.service.getRecoveryManagementStatus())).rejects.toBe(first);
  const next = await f.track(f.service.getRecoveryManagementStatus()); next.assertCurrent();
  expect(await f.track(f.service.deleteWorkspace(request, f.caller))).toEqual({ formatVersion: 1, status: 'cancelled' });
});

it('rejects an idle target projection during an in-flight command even if its producer guard stays live', async context => {
  const f = fixture(context), entered = deferred(), finish = deferred(); f.releases.push(finish.resolve);
  const idle = await f.track(f.service.getRecoveryManagementStatus());
  f.prepare.mockImplementationOnce(async (_request, lifetime, owned) => {
    entered.resolve(); await finish.promise; lifetime.assertCurrent(); owned(); return 'cancelled';
  });
  const command = f.track(f.service.deleteWorkspace(request, f.caller));
  try {
    await entered.promise; context.signal.throwIfAborted();
    f.readStatus.mockResolvedValueOnce({ value: idle.value, assertCurrent: f.check });
    await expect(f.track(f.service.getRecoveryManagementStatus())).rejects.toBeInstanceOf(WorkspaceManagementError);
  } finally { finish.resolve(); await command; }
});

it('invalidates old publication after even a rejected command without poisoning a fresh read', async context => {
  const f = fixture(context), old = await f.track(f.service.getRecoveryManagementStatus());
  await expect(f.track(f.service.createEmpty('Synthetic blocked'))).rejects.toBeInstanceOf(WorkspaceManagementError);
  let first: unknown;
  try { old.assertCurrent(); } catch (error) { first = error; }
  expect(first).toBeInstanceOf(WorkspaceManagementError);
  expect(old.assertCurrent).toThrow(first as Error);
  const fresh = await f.track(f.service.getRecoveryManagementStatus()); fresh.assertCurrent();
});

it('joins held status work before shutdown and rejects its late publication', async context => {
  const f = fixture(context), entered = deferred(), finish = deferred(); f.releases.push(finish.resolve);
  const read = f.readStatus.getMockImplementation()!;
  f.readStatus.mockImplementationOnce(async phase => { entered.resolve(); await finish.promise; return read(phase); });
  const job = f.track(f.service.getRecoveryManagementStatus());
  const result = job.catch(error => error);
  let settled = false;
  try {
    await entered.promise; context.signal.throwIfAborted();
    const closing = f.track(f.service.shutdown()).then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    finish.resolve();
    expect(await result).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    await closing; expect(settled).toBe(true);
    await expect(f.service.getRecoveryManagementStatus()).rejects.toBeInstanceOf(WorkspaceManagementError);
  } finally { finish.resolve(); await result; }
});

it('rejects a wrong status target without falling back to repairing status or changing the fixed target', async context => {
  const f = fixture(context);
  const value = parseWorkspaceRecoveryManagementStatus({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
    maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: otherId,
    target: { workspaceId: otherId, workspaceLabel: 'Synthetic foreign target' } });
  f.readStatus.mockResolvedValueOnce({ value, assertCurrent: f.check });
  await expect(f.track(f.service.getRecoveryManagementStatus())).rejects.toBeInstanceOf(WorkspaceManagementError);
  expect(f.registryRead).not.toHaveBeenCalled();
  const fresh = await f.track(f.service.getRecoveryManagementStatus());
  expect(fresh.value.operationState === 'idle' && fresh.value.target.workspaceId).toBe(targetId);
});

it('captures admission callbacks and target before caller options are replaced', async context => {
  const f = fixture(context);
  Object.assign(f.recoveryManagement, { targetWorkspaceId: otherId, assertCurrent() {}, async assertSelected() {} });
  Object.assign(f.options, { recoveryManagement: undefined });
  f.state.ownerCurrent = false;
  await expect(f.track(f.service.deleteWorkspace(request, f.caller))).rejects.toMatchObject({ cause: f.first });
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.acquire).not.toHaveBeenCalled();
});

it('does not revive the captured preparation lifetime after owner loss and restoration', async context => {
  const f = fixture(context);
  await f.track(f.service.deleteWorkspace(request, f.caller));
  expect(f.capturedLifetime).toBeDefined();
  f.state.ownerCurrent = false;
  expect(f.capturedLifetime!.assertCurrent).toThrow(f.first);
  f.state.ownerCurrent = true;
  expect(f.capturedLifetime!.assertCurrent).toThrow(f.first);
  expect(f.completeReturn).not.toHaveBeenCalled();
});

it('preserves the durable service receipt and lease release without dispatching a business relaunch', async context => {
  const f = fixture(context); f.state.prepared = true;
  expect(await f.track(f.service.deleteWorkspace(request, f.caller))).toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
  expect(f.recordRemoved).toHaveBeenCalledOnce(); expect(f.continuation.resume).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle'); expect(f.completeReturn).not.toHaveBeenCalled();
});

it.for([{ name: 'cancel', prepared: false }, { name: 'terminal', prepared: true }])(
  'does not publish $name success after the delete lease release fails', async ({ prepared }, context) => {
    const f = fixture(context), first = new Error('SYNTHETIC_RESTRICTED_RELEASE_FAILURE'); f.state.prepared = prepared;
    const acquire = f.acquire.getMockImplementation()!;
    let original: Awaited<ReturnType<typeof f.lease.acquire>> | undefined;
    let wrapped: NonNullable<typeof original> | undefined;
    f.acquire.mockImplementationOnce(async purpose => {
      original = await acquire(purpose);
      const owned = original;
      wrapped = { async release() { await owned.release(); throw first; } };
      return wrapped;
    });
    f.captureLease.mockImplementationOnce((purposes, expected) => {
      expect(expected).toBe(wrapped); return f.lease.captureCurrentOwner(purposes, original);
    });
    const reports = vi.fn();
    await expect(f.track(f.service.deleteWorkspace(request, f.caller, reports))).rejects.toMatchObject({ cause: first });
    expect(reports).toHaveBeenCalledOnce(); expect(reports.mock.calls[0]![0].sideEffectState).toBe('unknown');
    expect(f.lease.readState()).toBe('idle'); expect(f.completeReturn).not.toHaveBeenCalled();
    expect(f.recordRemoved).toHaveBeenCalledTimes(prepared ? 1 : 0);
    const failure: unknown = await f.service.shutdown().catch(cause => cause);
    expect(failure).toMatchObject({ cause: first, errors: [first] });
    f.acknowledgeShutdown(failure);
  },
);
