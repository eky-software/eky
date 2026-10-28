import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type { WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import type { WorkspaceDeletionPreparationOutcome } from './workspaceManagementTypes.js';

const services: WorkspaceManagementService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.shutdown()));
});

describe('workspace management completion', () => {
  it('preserves the command failure when deferred completion also throws', async () => {
    const first = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_CREATE_FAILED', 'create', {
      cause: new Error('SYNTHETIC_CREATE_FAILURE'),
    });
    const later = new Error('SYNTHETIC_RETURN_FAILURE');
    const deferredReturn = new DeferredWorkspaceRuntimeRelaunch(() => { throw later; });
    const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_COMMAND'); };
    const service = new WorkspaceManagementService({
      createEmpty: { async create() { deferredReturn.request(); throw first; } },
      importBackup: { import: unexpected }, renameWorkspace: { rename: unexpected },
      switchWorkspace: { switchTo: unexpected }, maintenanceState: new InMemoryWorkspaceMaintenanceLease(),
      registry: { async read() { return { formatVersion: 2, activeWorkspaceId: null, workspaces: [] }; } },
      operationGuard: { async assertNoUnresolvedOperations() {}, async readRecoveryState() { return 'clear'; } },
      runtimeRelaunchCompletion: deferredReturn,
    });
    try {
      const error = await service.createEmpty('Synthetic').catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(WorkspaceManagementError);
      expect(error).toMatchObject({ code: first.code, cause: { cause: first, errors: [first, later] } });
    } finally { await service.shutdown(); }
  });

  it('keeps the exact lease until guarded return, despite its own admission close', async () => {
    const f = fixture({ prepare: async input => {
      input.service.closeAdmission();
      input.deferredReturn.request();
      return 'returnRequested';
    } });
    await expect(f.start()).resolves.toBe('returnRequested');
    expect(f.events).toEqual(['prepare', 'completion', 'lifetime', 'return', 'release']);
    expect(f.relaunch).toHaveBeenCalledTimes(1);
    expect(f.lease.readState()).toBe('idle');
    expect(f.observer.record).not.toHaveBeenCalled();
  });

  it('joins asynchronous release and a shutdown requested inside the return callback', async () => {
    const releasing = deferred();
    const finish = deferred();
    let closing: Promise<void> | undefined;
    let closed = false;
    const f = fixture({ afterReturn: service => { closing = service.shutdown().then(() => { closed = true; }); },
      release: async () => { releasing.resolve(); await finish.promise; } });
    const work = f.start();
    let settled = false;
    void work.then(() => { settled = true; }, () => { settled = true; });
    try {
      await Promise.race([releasing.promise, work.then(() => { throw new Error('RELEASE_NOT_ENTERED'); })]);
      expect(settled).toBe(false);
      expect(closed).toBe(false);
      expect(f.lease.readState()).toBe('busy');
      finish.resolve();
      await expect(work).resolves.toBe('returnRequested');
      await closing;
      expect(closed).toBe(true);
      expect(f.lease.readState()).toBe('idle');
    } finally { finish.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
  });

  it('rejects re-entrant commands during both return and release', async () => {
    const attempts: Promise<unknown>[] = [];
    const attempt = (service: WorkspaceManagementService) => {
      attempts.push(service.createEmpty('Synthetic').catch((error: unknown) => error));
    };
    const f = fixture({ afterReturn: attempt, release: attempt });
    await f.start();
    for (const error of await Promise.all(attempts)) {
      expect(error).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
    }
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each(['prepared', 'cancelled'] as const)('does not return for %s', async outcome => {
    const f = fixture({ prepare: async () => outcome });
    await expect(f.start()).resolves.toBe(outcome);
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it.each(['prepared', 'cancelled'] as const)('burns an unexpected queued return for %s', async outcome => {
    const f = fixture({ prepare: async input => { input.deferredReturn.request(); return outcome; } });
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
    f.deferredReturn.complete();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('keeps preparation failure first when a queued return is rejected and release fails', async () => {
    const first = new Error('SYNTHETIC_PREPARATION_SECRET');
    const releaseFailure = new Error('SYNTHETIC_RELEASE_SECRET');
    const f = fixture({ prepare: async input => { input.deferredReturn.request(); throw first; },
      release: () => { throw releaseFailure; } });
    const error = await f.start().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: {
      cause: first, errors: [first, expect.objectContaining({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' }), releaseFailure],
    } });
    f.deferredReturn.complete();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
    expect(f.observer.record).toHaveBeenCalledTimes(1);
    expect(f.observer.record).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'WORKSPACE_DELETE_FAILED', outcome: 'failed', sideEffectState: 'unknown', stage: 'deletePreparation',
    }));
    expect(JSON.stringify(f.observer.record.mock.calls)).not.toMatch(/SYNTHETIC|SECRET|stack|errors/);
    await expect(f.service.createEmpty('Synthetic')).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
  });

  it('preserves a thrown undefined as the original failure', async () => {
    const later = new Error('SYNTHETIC_RELEASE');
    const f = fixture({ prepare: async () => { throw undefined; }, release: () => { throw later; } });
    const error = await f.start().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: { cause: undefined, errors: [undefined, later] } });
  });

  it('fails a prepared command if its exact lease cannot be released', async () => {
    const failure = new Error('SYNTHETIC_RELEASE');
    const f = fixture({ prepare: async () => 'prepared', release: () => { throw failure; } });
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: failure });
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.observer.record).toHaveBeenCalledTimes(1);
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  });

  it('retains return and release failures without publishing successful completion', async () => {
    const first = new Error('SYNTHETIC_RETURN');
    const later = new Error('SYNTHETIC_RELEASE');
    const f = fixture({ afterReturn: () => { throw first; }, release: () => { throw later; } });
    const error = await f.start().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: { cause: first, errors: [first, later] } });
    expect(f.events.at(-1)).toBe('release');
    expect(f.observer.record).toHaveBeenCalledTimes(1);
    expect(f.observer.record.mock.calls[0]?.[0]).toMatchObject({ outcome: 'failed' });
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  });

  it('rejects revocation at the final return boundary and still releases the lease', async () => {
    const f = fixture({ beforeCompletion: input => { input.revoke(); } });
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
    f.deferredReturn.complete();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('does not mistake a replacement same-purpose lease for its captured owner', async () => {
    const f = fixture({ prepare: async input => {
      await input.releaseOriginal();
      const replacement = await input.lease.acquire('delete');
      input.cleanups.push(() => replacement.release());
      input.deferredReturn.request();
      return 'returnRequested';
    } });
    try {
      await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
      expect(f.relaunch).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
      expect(f.observer.record.mock.calls[0]?.[0]).toMatchObject({ retryable: false });
    } finally { for (const cleanup of f.cleanups) await cleanup(); }
  });

  it('does not release a lease owned by another operation when acquisition fails', async () => {
    const f = fixture();
    const other = await f.lease.acquire('backup');
    try {
      await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
      expect(f.lease.readState()).toBe('busy');
      expect(f.events).not.toContain('prepare');
      expect(f.events).not.toContain('release');
    } finally { await other.release(); }
  });

  it('releases a late acquisition after external shutdown without starting preparation', async () => {
    const acquired = deferred();
    const finish = deferred();
    const f = fixture({ afterAcquire: async () => { acquired.resolve(); await finish.promise; } });
    const work = f.start().catch((error: unknown) => error);
    let closing: Promise<void> | undefined;
    try {
      await Promise.race([acquired.promise, work.then(() => { throw new Error('ACQUIRE_NOT_ENTERED'); })]);
      closing = f.service.shutdown();
      finish.resolve();
      expect(await work).toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      await closing;
      expect(f.events).not.toContain('prepare');
      expect(f.lease.readState()).toBe('idle');
    } finally { finish.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
  });

  it.each(['lifetime', 'lease'] as const)('rejects an asynchronous %s guard at completion', async guard => {
    const f = fixture({ asyncFinalGuard: guard });
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
    f.deferredReturn.complete();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });
});

type PreparationInput = {
  service: WorkspaceManagementService;
  deferredReturn: DeferredWorkspaceRuntimeRelaunch;
  lease: InMemoryWorkspaceMaintenanceLease;
  releaseOriginal(): Promise<void>;
  cleanups: Array<() => Promise<void>>;
};
function fixture(options: {
  prepare?(input: PreparationInput): Promise<WorkspaceDeletionPreparationOutcome>;
  afterAcquire?(): Promise<void>;
  beforeCompletion?(input: { revoke(): void }): void;
  afterReturn?(service: WorkspaceManagementService): void;
  release?(service: WorkspaceManagementService): void | Promise<void>;
  asyncFinalGuard?: 'lifetime' | 'lease';
} = {}) {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const events: string[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  let current = true;
  let releaseOriginal = async () => {};
  let service!: WorkspaceManagementService;
  const relaunch = vi.fn(() => {
    expect(lease.readState()).toBe('busy');
    events.push('return');
    options.afterReturn?.(service);
  });
  const deferredReturn = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_COMMAND'); };
  const create = vi.fn(unexpected);
  const observer = { record: vi.fn<NonNullable<WorkspaceManagementServiceOptions['observer']>['record']>() };
  service = new WorkspaceManagementService({
    createEmpty: { create }, importBackup: { import: unexpected }, renameWorkspace: { rename: unexpected },
    switchWorkspace: { switchTo: unexpected }, maintenanceState: lease, observer,
    registry: { async read() { return { formatVersion: 2, activeWorkspaceId: null, workspaces: [] }; } },
    operationGuard: { async assertNoUnresolvedOperations() {}, async readRecoveryState() { return 'clear'; } },
    runtimeRelaunchCompletion: { complete(assertCurrent) {
      events.push('completion');
      options.beforeCompletion?.({ revoke() { current = false; } });
      deferredReturn.complete(assertCurrent);
    } },
    deletionPreparation: {
      maintenanceLease: {
        async acquire(purpose) {
          const handle = await lease.acquire(purpose);
          releaseOriginal = () => handle.release();
          await options.afterAcquire?.();
          return { async release() {
            events.push('release');
            try { await options.release?.(service); } finally { await handle.release(); }
          } };
        },
        captureCurrentOwner: purposes => {
          const guard = lease.captureCurrentOwner(purposes);
          return () => {
            guard();
            if (options.asyncFinalGuard === 'lease' && events.includes('completion')) {
              return Promise.reject(new Error('SYNTHETIC_ASYNC_LEASE'));
            }
          };
        },
      },
      async prepare(_request, _lifetime, assertLease) {
        assertLease(); events.push('prepare');
        if (options.prepare) return options.prepare({ service, deferredReturn, lease, releaseOriginal, cleanups });
        deferredReturn.request(); return 'returnRequested';
      },
    },
  });
  services.push(service);
  return { service, lease, deferredReturn, relaunch, events, observer, create, cleanups,
    start: () => service.prepareDeletion({ formatVersion: 1,
      workspaceId: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
      typedLabel: 'Synthetic', backupChoice: 'explicitDataLoss',
    }, { assertCurrent() {
      if (!current) throw new Error('SYNTHETIC_LIFETIME_REVOKED');
      if (events.at(-1) === 'completion') events.push('lifetime');
      if (options.asyncFinalGuard === 'lifetime' && events.includes('completion')) {
        return Promise.reject(new Error('SYNTHETIC_ASYNC_LIFETIME'));
      }
    }, closeAdmissionForOwnStop() { service.closeAdmission(); } }),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
