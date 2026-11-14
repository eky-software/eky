import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type { WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import type { WorkspaceDeletionPreparationOutcome } from './workspaceManagementTypes.js';

const services: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(shutdown => shutdown()));
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
    expectPreparationAndCleanupFailure(f.observer);
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
    expectPreparationAndCleanupFailure(f.observer);
    await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  });

  it('retains return and release failures without publishing successful completion', async () => {
    const first = new Error('SYNTHETIC_RETURN');
    const later = new Error('SYNTHETIC_RELEASE');
    const f = fixture({ afterReturn: () => { throw first; }, release: () => { throw later; } });
    const error = await f.start().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: { cause: first, errors: [first, later] } });
    expect(f.events.at(-1)).toBe('release');
    expectPreparationAndCleanupFailure(f.observer);
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

  it('hands one operation and lease to the durable consumer without retaining the requester', async () => {
    let preparedId: string | undefined;
    let retained: Parameters<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>[1] | undefined;
    const f = fixture({ prepare: async input => {
      preparedId = input.operationId;
      input.service.closeAdmission();
      return 'prepared';
    }, continuation: {
      captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
      async resume(operationId, authority) {
        expect(operationId).toBe(preparedId);
        expect(f.lease.readState()).toBe('busy');
        retained = authority;
        f.revokeRequest();
        await authority.assertOwned();
        authority.recordRemoved({ status: 'removed' });
        return { formatVersion: 1, status: 'completed', navigation: 'selector' };
      },
    } });
    await expect(f.startDurable()).resolves.toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
    expect(preparedId).toMatch(/^[a-f0-9-]{36}$/);
    expect(retained!.assertCurrent).toThrow();
    expect(f.lease.readState()).toBe('idle');
    const next = await f.lease.acquire('delete');
    try { expect(retained!.assertCurrent).toThrow(); } finally { await next.release(); }
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it.each(['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup'] as const)(
    'reports the command %s failure stage without changing its original cause', async stage => {
      const first = new Error('SYNTHETIC_DELETION_STAGE_FAILURE');
      const f = fixture({ prepare: async () => 'prepared', continuation: {
        captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
        async resume(_id, _authority, observeStage) {
          observeStage?.(stage);
          throw first;
        },
      } });
      await expect(f.startDurable()).rejects.toMatchObject({ cause: first });
      expect(f.observer.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        operationKind: 'delete', errorCode: 'WORKSPACE_DELETE_FAILED',
        sideEffectState: 'unknown', stage,
      }));
      expect(f.lease.readState()).toBe('idle');
      expect(JSON.stringify(f.observer.record.mock.calls)).not.toContain('SYNTHETIC_DELETION_STAGE_FAILURE');
    });

  it('reports authorization when authority capture fails before command observation starts', async () => {
    const first = new Error('SYNTHETIC_AUTHORITY_CAPTURE');
    const resume = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_RESUME'); });
    const f = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority() { throw first; }, resume,
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: first });
    expect(resume).not.toHaveBeenCalled();
    expect(f.observer.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stage: 'deleteAuthorization' }));
    expect(f.lease.readState()).toBe('idle');
  });

  it('freezes the first command stage before completion and a held failing release', async () => {
    const first = new Error('SYNTHETIC_PURGE_FAILURE'), later = new Error('SYNTHETIC_RELEASE_FAILURE');
    const entered = deferred(), finish = deferred();
    let observe: NonNullable<Parameters<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>[2]> | undefined;
    const f = fixture({ prepare: async () => 'prepared',
      beforeCompletion() { observe!('deleteRegistry'); },
      async release() { entered.resolve(); await finish.promise; observe!('deleteCleanup'); throw later; },
      continuation: {
        captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
        async resume(_id, _owner, observeStage) {
          observe = observeStage; observe!('deletePurge'); throw first;
        },
      },
    });
    const work = f.startDurable().catch((cause: unknown) => cause);
    try {
      await Promise.race([entered.promise, work.then(() => { throw new Error('RELEASE_NOT_ENTERED'); })]);
      expect(f.lease.readState()).toBe('busy');
      expect(f.observer.record).not.toHaveBeenCalled();
      observe!('deleteAuthorization');
      finish.resolve();
      expect(await work).toMatchObject({ cause: { cause: first, errors: [first, later] } });
      const events = f.observer.record.mock.calls.map(([event]) => event);
      expect(events).toEqual([
        expect.objectContaining({ stage: 'deletePurge', errorCode: 'WORKSPACE_DELETE_FAILED' }),
        expect.objectContaining({ stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED' }),
      ]);
      expect(events[0]!.correlationId).toBe(events[1]!.correlationId);
      observe!('deleteRegistry');
      expect(f.observer.record).toHaveBeenCalledTimes(2);
      expect(f.lease.readState()).toBe('idle');
      expect(JSON.stringify(events)).not.toMatch(/SYNTHETIC|stack|errors/);
    } finally { finish.resolve(); await work; }
  });

  it('ignores a previous command stage callback during the next deletion', async () => {
    let previous: NonNullable<Parameters<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>[2]> | undefined;
    let attempts = 0;
    const first = new Error('SYNTHETIC_FIRST_STAGE'), next = new Error('SYNTHETIC_NEXT_STAGE');
    const f = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
      async resume(_id, _owner, observeStage) {
        if (attempts++ === 0) {
          previous = observeStage; previous!('deletePurge'); throw first;
        }
        observeStage!('deleteRegistry'); previous!('deleteCleanup'); throw next;
      },
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: first });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: next });
    const events = f.observer.record.mock.calls.map(([event]) => event);
    expect(events).toEqual([
      expect.objectContaining({ stage: 'deletePurge' }), expect.objectContaining({ stage: 'deleteRegistry' }),
    ]);
    expect(events[0]!.correlationId).not.toBe(events[1]!.correlationId);
    expect(f.lease.readState()).toBe('idle');
  });

  it('accepts only execution stages from the current command observer', async () => {
    const first = new Error('SYNTHETIC_INVALID_STAGE');
    const f = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
      async resume(_id, _owner, observeStage) {
        observeStage!('deletePurge');
        for (const value of ['admission', 'deletePreparation', 'SYNTHETIC_PRIVATE_STAGE', undefined, {}]) {
          observeStage!(value as never);
        }
        throw first;
      },
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: first });
    expect(f.observer.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stage: 'deletePurge' }));
  });

  it('keeps the lease and consumer closed until preparation settlement', async () => {
    const entered = deferred();
    const finish = deferred();
    const resume = vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>(async (_id, authority) => {
      authority.recordRemoved({ status: 'removed' });
      return { formatVersion: 1, status: 'completed', navigation: 'selector' };
    });
    const f = fixture({ prepare: async () => { entered.resolve(); await finish.promise; return 'prepared'; },
      continuation: { captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }), resume } });
    const work = f.startDurable();
    try {
      await Promise.race([entered.promise, work.then(() => { throw new Error('PREPARATION_NOT_ENTERED'); })]);
      expect(resume).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
    } finally { finish.resolve(); await work; }
    expect(resume).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'duplicate', 'mutationAfterReceipt', 'navigationMismatch'] as const)(
    'rejects an invalid durable completion (%s)', async scenario => {
      const mutation = vi.fn();
      let retained: (() => void) | undefined;
      const f = fixture({ prepare: async () => 'prepared', continuation: {
        captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
        async resume(_id, authority) {
          retained = () => authority.recordRemoved({ status: 'removed' });
          if (scenario !== 'missing') retained();
          if (scenario === 'duplicate') retained();
          if (scenario === 'mutationAfterReceipt') { authority.assertCurrent(); mutation(); }
          return { formatVersion: 1, status: 'completed',
            navigation: scenario === 'navigationMismatch' ? 'reopenPrevious' : 'selector' };
        },
      } });
      await expect(f.startDurable()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
      expect(retained).toBeDefined();
      expect(retained!).toThrow();
      expect(mutation).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('idle');
      await expect(f.service.shutdown()).resolves.toBeUndefined();
    });

  it('joins durable I/O before release when external shutdown revokes its next mutation', async () => {
    const entered = deferred();
    const finish = deferred();
    const effects = vi.fn();
    const f = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }),
      async resume(_operationId, authority) {
        entered.resolve(); await finish.promise;
        authority.assertCurrent(); effects();
        return { formatVersion: 1, status: 'completed', navigation: 'selector' };
      },
    } });
    const work = f.startDurable().catch(error => error as unknown);
    let closing: Promise<void> | undefined;
    let closed = false;
    try {
      await Promise.race([entered.promise, work.then(() => { throw new Error('CONSUMER_NOT_ENTERED'); })]);
      closing = f.service.shutdown().then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(f.lease.readState()).toBe('busy');
      finish.resolve();
      expect(await work).toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      await closing;
      expect(closed).toBe(true);
      expect(effects).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('idle');
    } finally { finish.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
  });

  it('does not enter durable work after failed preparation or final requester revocation', async () => {
    const first = new Error('SYNTHETIC_PREPARATION_SETTLEMENT');
    const resume = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_RESUME'); });
    const f = fixture({ prepare: async () => { throw first; }, continuation: {
      captureAuthority: () => ({ assertCurrent() {}, async assertOwned() {} }), resume,
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: first });
    expect(resume).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
    const revoked = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority() { revoked.revokeRequest(); return { assertCurrent() {}, async assertOwned() {} }; }, resume,
    } });
    await expect(revoked.startDurable()).rejects.toMatchObject({ cause: { message: 'SYNTHETIC_LIFETIME_REVOKED' } });
    expect(resume).not.toHaveBeenCalled();
  });

  it('preserves durable ownership failure before release failure and burns the authority', async () => {
    const first = new Error('SYNTHETIC_DURABLE_OWNER');
    const later = new Error('SYNTHETIC_DURABLE_RELEASE');
    let retained: (() => void) | undefined;
    const f = fixture({ prepare: async () => 'prepared', release: () => { throw later; }, continuation: {
      captureAuthority: () => ({ assertCurrent() { throw first; }, async assertOwned() {} }),
      async resume(_id, authority) { retained = authority.assertCurrent; throw new Error('UNEXPECTED_RESUME'); },
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ cause: { cause: first, errors: [first, later] } });
    expect(retained).toBeUndefined();
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(JSON.stringify(f.observer.record.mock.calls)).not.toContain('SYNTHETIC_DURABLE');
  });

  it('rejects a missing durable consumer before lease acquisition or preparation', async () => {
    const f = fixture();
    await expect(f.startDurable()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
    expect(f.events).not.toContain('prepare');
    expect(f.events).not.toContain('release');
    expect(f.lease.readState()).toBe('idle');
  });

  it('rejects a main guard that re-enters external shutdown before the next mutation', async () => {
    let armed = false;
    const mutate = vi.fn();
    const f = fixture({ prepare: async () => 'prepared', continuation: {
      captureAuthority: () => ({ assertCurrent() { if (armed) void f.service.shutdown(); }, async assertOwned() {} }),
      async resume(_id, authority) {
        armed = true;
        authority.assertCurrent(); mutate();
        return { formatVersion: 1, status: 'completed', navigation: 'selector' };
      },
    } });
    await expect(f.startDurable()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
    expect(mutate).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('pins the continuation callbacks before preparation can replace either method', async () => {
    const capture = vi.fn(() => ({ assertCurrent() {}, async assertOwned() {} }));
    const resume = vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>(async (_id, authority) => {
      authority.recordRemoved({ status: 'removed' });
      return { formatVersion: 1, status: 'completed', navigation: 'selector' };
    });
    const foreign = vi.fn((): never => { throw new Error('FOREIGN_DURABLE_CALLBACK'); });
    const continuation = { captureAuthority: capture, resume };
    const f = fixture({ prepare: async () => {
      continuation.captureAuthority = foreign;
      continuation.resume = foreign;
      return 'prepared';
    }, continuation });
    await expect(f.startDurable()).resolves.toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
    expect(capture).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(foreign).not.toHaveBeenCalled();
  });

  it('rejects a substituted same-purpose lease before preparation starts', async () => {
    const f = fixture({ async afterAcquire(handle) {
      await handle.release();
      const replacement = await f.lease.acquire('delete');
      f.cleanups.push(() => replacement.release());
    } });
    try {
      await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
      expect(f.events).not.toContain('prepare');
      expect(f.lease.readState()).toBe('busy');
    } finally { for (const cleanup of f.cleanups) await cleanup(); }
  });
});

function expectPreparationAndCleanupFailure(observer: ReturnType<typeof fixture>['observer']): void {
  const events = observer.record.mock.calls.map(([event]) => event);
  expect(events).toEqual([
    expect.objectContaining({
      errorCode: 'WORKSPACE_DELETE_FAILED', operationKind: 'delete', outcome: 'failed',
      retryable: false, sideEffectState: 'unknown', stage: 'deletePreparation',
    }),
    expect.objectContaining({
      errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', operationKind: 'delete', outcome: 'failed',
      retryable: false, sideEffectState: 'unknown', stage: 'deleteCleanup',
    }),
  ]);
  expect(events[0]?.correlationId).toBeTruthy();
  expect(events[1]?.correlationId).toBe(events[0]?.correlationId);
  expect(JSON.stringify(events)).not.toMatch(/SYNTHETIC|SECRET|stack|errors/);
}

type PreparationInput = {
  service: WorkspaceManagementService;
  deferredReturn: DeferredWorkspaceRuntimeRelaunch;
  lease: InMemoryWorkspaceMaintenanceLease;
  releaseOriginal(): Promise<void>;
  cleanups: Array<() => Promise<void>>;
  operationId: string;
};
function fixture(options: {
  prepare?(input: PreparationInput): Promise<WorkspaceDeletionPreparationOutcome>;
  afterAcquire?(handle: WorkspaceMaintenanceLeaseHandle): Promise<void>;
  beforeCompletion?(input: { revoke(): void }): void;
  afterReturn?(service: WorkspaceManagementService): void;
  release?(service: WorkspaceManagementService): void | Promise<void>;
  asyncFinalGuard?: 'lifetime' | 'lease';
  continuation?: {
    captureAuthority: (...args: Parameters<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['captureAuthority']>) =>
      Pick<ReturnType<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['captureAuthority']>, 'assertCurrent' | 'assertOwned'>;
    resume: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume'];
  };
} = {}) {
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const leaseHandles = new WeakMap<WorkspaceMaintenanceLeaseHandle, WorkspaceMaintenanceLeaseHandle>();
  const events: string[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  let current = true;
  let releaseOriginal = async () => {};
  let service!: WorkspaceManagementService;
  const completionFailures: unknown[] = [];
  const captureTestAuthority = options.continuation?.captureAuthority.bind(options.continuation);
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
      try { deferredReturn.complete(assertCurrent); }
      catch (error) { completionFailures.push(error); throw error; }
    } },
    deletionPreparation: {
      maintenanceLease: {
        async acquire(purpose) {
          const handle = await lease.acquire(purpose);
          releaseOriginal = () => handle.release();
          await options.afterAcquire?.(handle);
          const wrapped = { async release() {
            events.push('release');
            try { await options.release?.(service); }
            catch (error) { completionFailures.push(error); throw error; }
            finally { await handle.release(); }
          } };
          leaseHandles.set(wrapped, handle);
          return wrapped;
        },
        captureCurrentOwner: (purposes, expected) => {
          const guard = lease.captureCurrentOwner(purposes,
            expected === undefined ? undefined : leaseHandles.get(expected) ?? expected);
          return () => {
            guard();
            if (options.asyncFinalGuard === 'lease' && events.includes('completion')) {
              return Promise.reject(new Error('SYNTHETIC_ASYNC_LEASE'));
            }
          };
        },
      },
      async prepare(_request, _lifetime, assertLease, operationId) {
        assertLease(); events.push('prepare');
        if (options.prepare) return options.prepare({ service, deferredReturn, lease, releaseOriginal, cleanups, operationId });
        deferredReturn.request(); return 'returnRequested';
      },
    },
    ...(options.continuation === undefined ? {} : { deletionContinuation: {
      captureAuthority: (...args) => ({ ...captureTestAuthority!(...args),
        recordRemoved: () => ({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const }),
      }),
      resume: options.continuation.resume.bind(options.continuation),
    } }),
  });
  services.push(async () => {
    if (completionFailures.length === 0) await service.shutdown();
    else await expect(service.shutdown()).rejects.toMatchObject({
      message: 'WORKSPACE_MANAGEMENT_COMPLETION_FAILED', errors: completionFailures,
    });
  });
  const request = { formatVersion: 1,
      workspaceId: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
      typedLabel: 'Synthetic', backupChoice: 'explicitDataLoss' };
  const lifetime = { assertCurrent() {
      if (!current) throw new Error('SYNTHETIC_LIFETIME_REVOKED');
      if (events.at(-1) === 'completion') events.push('lifetime');
      if (options.asyncFinalGuard === 'lifetime' && events.includes('completion')) {
        return Promise.reject(new Error('SYNTHETIC_ASYNC_LIFETIME'));
      }
    }, closeAdmissionForOwnStop() { service.closeAdmission(); } };
  return { service, lease, deferredReturn, relaunch, events, observer, create, cleanups,
    revokeRequest() { current = false; },
    start: () => service.prepareDeletion(request, lifetime),
    startDurable: () => service.deleteWorkspace(request, lifetime),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
