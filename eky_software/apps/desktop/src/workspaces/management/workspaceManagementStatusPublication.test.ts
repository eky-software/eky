import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService, type WorkspaceManagementOrdinaryServiceOptions } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { createWorkspaceManagementCapability } from './workspaceManagementCapability.js';
import * as protocol from './workspaceManagementCapabilityProtocol.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';

function gate() {
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, pending, wait() { enter(); return pending; } };
}

function fixture(context: TestContext, options: {
  enabled?: boolean;
  admission?: () => Promise<void>;
  readRegistry?: WorkspaceManagementOrdinaryServiceOptions['registry']['read'];
  publicationAssertion?: () => void;
} = {}) {
  const lease = new InMemoryWorkspaceMaintenanceLease(), resume = gate();
  const releases: (() => void)[] = [resume.release];
  const jobs: Promise<unknown>[] = [], manualLeases: Awaited<ReturnType<typeof lease.acquire>>[] = [];
  let ownerCurrent = true;
  const ownerFailure = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
  const assertOwner = () => { if (!ownerCurrent) throw ownerFailure; };
  const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
  const completion = { formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const };
  const receipt = Object.freeze({ synthetic: 'removed' });
  const removed = vi.fn(() => completion);
  const registry = { formatVersion: 2 as const, activeWorkspaceId: workspaceId, workspaces: [{
    workspaceId, workspaceLabel: 'Synthetic company', layoutVersion: 1 as const,
    lifecycleState: 'ready' as const, createdAt: '2026-11-06T00:00:00.000Z',
    lineageIdentity: { formatVersion: 1 as const, profileId: 'a'.repeat(64) },
  }] };
  const unexpected = async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_COMMAND'); };
  const service = new WorkspaceManagementService({
    createEmpty: { create: unexpected }, importBackup: { import: unexpected },
    renameWorkspace: { rename: unexpected }, switchWorkspace: { switchTo: unexpected },
    registry: { read: options.readRegistry ?? (async () => registry) }, maintenanceState: lease,
    operationGuard: { assertNoUnresolvedOperations: options.admission ?? (async () => undefined),
      readRecoveryState: async () => 'clear' },
    deletionPreparation: { maintenanceLease: lease, async prepare(_request, lifetime, assertLease) {
      lifetime.assertCurrent(); assertLease(); assertOwner(); return 'prepared';
    } },
    deletionContinuation: {
      captureAuthority(_id, assertLease) {
        const assertCurrent = () => { assertLease(); assertOwner(); };
        return { assertCurrent, async assertOwned() { assertCurrent(); },
          recordRemoved(value) { expect(value).toBe(receipt); return removed(); } };
      },
      async resume(_id, authority) {
        await resume.wait(); await authority.assertOwned();
        authority.recordRemoved(receipt); return completion;
      },
    },
  });
  const readFailures: unknown[] = [];
  context.onTestFailed(async () => {
    if (readFailures.length === 0) return;
    try {
      const { createRunnerFailureSink } = await import('../../../../../test-reporters/runnerFailureEvidence.mjs');
      const sink = createRunnerFailureSink(), task = context.task;
      const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
      sink.record({ runner: 'vitest', phase: 'workspaceManagementStatusCatch', error: readFailures[0],
        testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
        ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
      await sink.flush();
    } catch { /* Evidence must not replace the failed test outcome. */ }
  });
  const readStatus = service.getStatus.bind(service);
  vi.spyOn(service, 'getStatus').mockImplementation(() => readStatus().catch(error => { readFailures.push(error); throw error; }));
  const publicationValidation = vi.fn();
  const capture = vi.fn(() => {
    const phase = service.captureStatusReadContext(), maintenance = lease.captureStatusObservation();
    let failure: { cause: unknown } | undefined;
    const observation = Object.freeze({ assertCurrent() {
      publicationValidation();
      if (failure !== undefined) throw failure.cause;
      try { phase.assertCurrent(); maintenance.assertCurrent(); assertOwner(); }
      catch (cause) {
        failure = { cause: cause instanceof WorkspaceManagementError ? cause
          : new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status', { cause }) };
        throw failure.cause;
      }
    } });
    observation.assertCurrent();
    return options.publicationAssertion === undefined ? observation
      : Object.freeze({ assertCurrent: options.publicationAssertion });
  });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const mainFrame = {}, webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const safeError = vi.fn();
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler),
      removeHandler: (name: string) => handlers.delete(name) } as never,
    mainWindow: window as never, service, passwordWindow: { requestPassword: async () => null },
    selectBackupSource: async () => null, selectReplacementBackupSource: async () => null,
    confirmActiveWorkspaceReplacement: async () => false, showSafeError: safeError,
    ...(options.enabled === false ? {} : { captureStatusPublication: capture }),
  });
  const track = <T>(job: Promise<T>) => { jobs.push(job); void job.catch(() => undefined); return job; };
  context.onTestFinished(async () => {
    for (const release of releases) release();
    await Promise.allSettled(jobs);
    capability.dispose(); await capability.shutdown(); await service.shutdown();
    for (const handle of manualLeases) await handle.release();
    vi.restoreAllMocks();
  });
  return { service, lease, capability, capture, publicationValidation, safeError, removed, completion, resume, webContents, mainFrame, window, readFailures,
    releaseOnClose: (release: () => void) => releases.push(release),
    async acquire() { const handle = await lease.acquire('backup'); manualLeases.push(handle); return handle; },
    loseOwner() { ownerCurrent = false; },
    restoreOwner() { ownerCurrent = true; },
    start() { return track(service.deleteWorkspace({ formatVersion: 1, workspaceId, typedLabel: 'Synthetic company',
      backupChoice: 'explicitDataLoss' }, { assertCurrent() {}, closeAdmissionForOwnStop() {} })); },
    invoke(event: unknown = { sender: webContents, senderFrame: mainFrame }) {
      const handler = handlers.get(protocol.getWorkspaceManagementStatusIpcChannel);
      if (handler === undefined) throw new Error('SYNTHETIC_STATUS_HANDLER_MISSING');
      return track(handler(event));
    },
  };
}

it('invalidates idle and busy observations without reviving old scope after release', async context => {
  const f = fixture(context);
  const idle = f.lease.captureStatusObservation(); expect(idle.state).toBe('idle'); idle.assertCurrent();
  const first = await f.acquire();
  expect(() => idle.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  const busy = f.lease.captureStatusObservation(); expect(busy.state).toBe('busy');
  await first.release();
  expect(() => busy.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(() => idle.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(() => f.lease.captureStatusObservation().assertCurrent()).not.toThrow();
});

it('detects busy-to-busy owner replacement but ignores a stale handle release and rejected acquisition', async context => {
  const f = fixture(context), first = await f.acquire();
  const old = f.lease.captureStatusObservation();
  await first.release(); const second = await f.acquire();
  expect(old.state).toBe(f.lease.readState());
  expect(() => old.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  const current = f.lease.captureStatusObservation();
  await first.release(); await expect(f.lease.acquire('backup')).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
  expect(() => current.assertCurrent()).not.toThrow();
  expect(() => f.lease.captureCurrentOwner(['backup'], second)()).not.toThrow();
});

it('separates command phase from lease acquisition before the first command await', async context => {
  const admission = gate(), f = fixture(context, { admission: () => admission.wait() });
  f.releaseOnClose(admission.release);
  const before = f.service.captureStatusReadContext(), work = f.start();
  await admission.entered;
  expect(() => before.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const phase = f.service.captureStatusReadContext(), maintenance = f.lease.captureStatusObservation();
  expect(phase.operationState).toBe('busy'); expect(maintenance.state).toBe('idle');
  admission.release(); await f.resume.entered;
  expect(() => phase.assertCurrent()).not.toThrow();
  expect(() => maintenance.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  f.resume.release(); await expect(work).resolves.toEqual(f.completion);
  expect(() => phase.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.service.captureStatusReadContext().operationState).toBe('idle');
});

it('keeps a lost publication owner closed even when its external flag later returns', async context => {
  const f = fixture(context), selected = f.capture();
  f.loseOwner(); expect(() => selected.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  f.restoreOwner(); expect(() => selected.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(() => f.capture().assertCurrent()).not.toThrow();
});

it('expires status scope on admission close without cancelling an admitted durable command', async context => {
  const f = fixture(context);
  const command = f.start();
  await f.resume.entered;
  const phase = f.service.captureStatusReadContext();
  expect(phase.operationState).toBe('busy');
  f.service.closeAdmission();
  expect(() => phase.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(() => phase.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(() => f.service.captureStatusReadContext()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  f.resume.release();
  await expect(command).resolves.toEqual(f.completion);
  expect(f.removed).toHaveBeenCalledOnce();
});

it.for(['commandStart', 'commandEnd', 'leaseAcquire', 'leaseRelease', 'leaseABA', 'ownerLoss', 'windowClose', 'capabilityClose'] as const)(
  'checks %s after the outer dispatcher await without cancelling a valid durable command', async (change, context) => {
    const f = fixture(context), held = gate(); f.releaseOnClose(held.release);
    let command: ReturnType<typeof f.start> | undefined;
    if (change === 'commandEnd' || change === 'ownerLoss') { command = f.start(); await f.resume.entered; }
    const first = change === 'leaseRelease' || change === 'leaseABA' ? await f.acquire() : undefined;
    const originalParse = protocol.parseWorkspaceStatusResult;
    vi.spyOn(protocol, 'parseWorkspaceStatusResult').mockImplementation(value => {
      const parsed = originalParse(value);
      // Hold the already validated callback outcome, not the DTO or app I/O.
      return { then(resolve: (result: typeof parsed) => void) { void held.wait().then(() => resolve(parsed)); } } as never;
    });
    const publication = f.invoke(); await held.entered;
    if (change === 'commandStart') { command = f.start(); await f.resume.entered; }
    if (change === 'commandEnd') { f.resume.release(); await command; }
    if (change === 'leaseAcquire') await f.acquire();
    if (change === 'leaseRelease' || change === 'leaseABA') await first!.release();
    if (change === 'leaseABA') { await f.acquire(); expect(f.lease.readState()).toBe('busy'); }
    if (change === 'ownerLoss') f.loseOwner();
    if (change === 'windowClose') f.window.emit('close');
    if (change === 'capabilityClose') f.capability.closeAdmission();
    held.release();
    await expect(publication).rejects.toThrow(change === 'windowClose' || change === 'capabilityClose'
      ? 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN' : 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(f.safeError).not.toHaveBeenCalled();
    if (command !== undefined && change !== 'commandEnd') {
      f.resume.release();
      if (change === 'ownerLoss') {
        await expect(command).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
        expect(f.removed).not.toHaveBeenCalled();
      } else await expect(command).resolves.toEqual(f.completion);
    }
  },
);

it('proves the late-boundary control fails without the publication guard', async context => {
  const f = fixture(context, { enabled: false }), held = gate(); f.releaseOnClose(held.release);
  const first = await f.acquire(), old = f.lease.captureStatusObservation();
  const originalParse = protocol.parseWorkspaceStatusResult;
  vi.spyOn(protocol, 'parseWorkspaceStatusResult').mockImplementation(value => {
    const parsed = originalParse(value);
    return { then(resolve: (result: typeof parsed) => void) { void held.wait().then(() => resolve(parsed)); } } as never;
  });
  const publication = f.invoke(); await held.entered;
  await first.release(); await f.acquire();
  expect(() => old.assertCurrent()).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  held.release(); await expect(publication).resolves.toMatchObject({ formatVersion: 1, operationState: 'busy' });
  expect(f.capture).not.toHaveBeenCalled();
});

it('rejects a foreign frame before capturing any publication or service read', async context => {
  const f = fixture(context);
  await expect(f.invoke({ sender: f.webContents, senderFrame: {} })).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
  expect(f.capture).not.toHaveBeenCalled(); expect(f.service.getStatus).not.toHaveBeenCalled();
});

it('retains a real status read failure instead of replacing it with late phase expiry', async context => {
  const held = gate(), cause = new Error('SYNTHETIC_ORIGINAL_STATUS_READ', {
    cause: new Error('SYNTHETIC_ORIGINAL_STATUS_CAUSE'),
  });
  const f = fixture(context, { async readRegistry(): Promise<never> { await held.wait(); throw cause; } });
  f.releaseOnClose(held.release);
  const publication = f.invoke(); await held.entered;
  const command = f.start(); await f.resume.entered;
  held.release(); await expect(publication).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.readFailures).toEqual([expect.objectContaining({ cause })]);
  expect(f.publicationValidation).toHaveBeenCalledOnce();
  f.resume.release(); await expect(command).resolves.toEqual(f.completion);
  expect(f.safeError).not.toHaveBeenCalled();
});

it('keeps capability shutdown pending while the validated callback outcome is still held', async context => {
  const f = fixture(context), held = gate(); f.releaseOnClose(held.release);
  const originalParse = protocol.parseWorkspaceStatusResult;
  vi.spyOn(protocol, 'parseWorkspaceStatusResult').mockImplementation(value => {
    const parsed = originalParse(value);
    return { then(resolve: (result: typeof parsed) => void) { void held.wait().then(() => resolve(parsed)); } } as never;
  });
  const publication = f.invoke(); await held.entered;
  let settled = false;
  const closing = f.capability.shutdown().then(() => { settled = true; });
  try {
    await nextTurn();
    expect(settled).toBe(false);
    expect(f.publicationValidation).toHaveBeenCalledOnce();
    held.release();
    await expect(publication).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    await expect(closing).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(f.safeError).not.toHaveBeenCalled();
  } finally { held.release(); await Promise.allSettled([publication, closing]); }
});

it.for(['resolved', 'rejected'] as const)('rejects a %s asynchronous publication assertion instead of ignoring it', async (outcome, context) => {
  const f = fixture(context, { async publicationAssertion() {
    if (outcome === 'rejected') throw new Error('SYNTHETIC_ASYNC_STATUS_GUARD');
  } });
  await expect(f.invoke()).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
  expect(f.safeError).toHaveBeenCalledOnce();
});
