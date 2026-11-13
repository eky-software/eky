import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { EmptyWorkspaceCreationError } from '../creation/emptyWorkspaceCreationError.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { WorkspaceRegistryMutationError } from '../registry/workspaceRegistryMutations.js';
import { createWorkspaceManagementCapability, type WorkspaceDeletionResultRuntime,
  type WorkspaceManagementCapability } from './workspaceManagementCapability.js';
import { createEmptyWorkspaceIpcChannel, deleteWorkspaceIpcChannel,
  workspaceManagementIpcChannels } from './workspaceManagementCapabilityProtocol.js';
import { WorkspaceManagementRecoveryRequiredError } from './workspaceManagementOperationGuard.js';
import { WorkspaceManagementService, type WorkspaceDeletionFailureOutcomeHandler,
  type WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';
import { JsonLineDesktopOperationalLogger } from '../../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import type { WorkspaceDeletionPreparationLifetime, WorkspaceManagementObserver, WorkspaceManagementOperationEvent } from './workspaceManagementTypes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const request = { formatVersion: 1, workspaceId, typedLabel: 'Synthetic company',
  backupChoice: 'explicitDataLoss' as const };
const unknownDeletionResult = Object.freeze({ formatVersion: 1, status: 'recoveryRequired',
  errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'restartRequired' } as const);
type Prepare = NonNullable<WorkspaceManagementServiceOptions['deletionPreparation']>['prepare'];
const fixtures: Array<{ capability: WorkspaceManagementCapability; service: WorkspaceManagementService }> = [];
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];

function track<T>(work: Promise<T>): Promise<T> {
  pending.push(work);
  void work.catch(() => undefined);
  return work;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { promise, release };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const f of fixtures) f.capability.dispose();
  await Promise.allSettled(pending.splice(0));
  await Promise.all(fixtures.splice(0).map(f => f.service.shutdown()));
});

describe('workspace deletion preparation request lifetime', () => {
  it.each(['prepared', 'cancelled', 'returnRequested'] as const)(
    'keeps %s separate from completed deletion and revokes retained callbacks', async outcome => {
      let retained!: WorkspaceDeletionPreparationLifetime;
      const f = fixture(async (captured, lifetime) => {
        expect(captured).toEqual(request);
        expect(Object.isFrozen(captured)).toBe(true);
        retained = lifetime;
        lifetime.assertCurrent();
        lifetime.closeAdmissionForOwnStop();
        lifetime.assertCurrent();
        return outcome;
      });
      await expect(f.start()).resolves.toBe(outcome);
      expect(() => retained.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
      expect(() => retained.closeAdmissionForOwnStop()).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
      expect(f.events).toEqual([]);
      expect(f.handlers.size).toBe(0);
      expect(f.showSafeError).not.toHaveBeenCalled();
    },
  );

  it('closes admission for its own stop without awaiting its own admitted request', async () => {
    const entered = gate();
    const finishStop = gate();
    const f = fixture(async (_captured, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      f.service.closeAdmission();
      entered.release();
      await finishStop.promise;
      lifetime.assertCurrent();
      return 'prepared';
    });
    const create = f.handlers.get(createEmptyWorkspaceIpcChannel)!;
    const operation = f.start();
    try {
      await entered.promise;
      expect(f.handlers.size).toBe(0);
      await expect(create(f.event, { workspaceLabel: 'Other' }))
        .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
      await expect(f.service.createEmpty('Other'))
        .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(f.create).not.toHaveBeenCalled();
      finishStop.release();
      await expect(operation).resolves.toBe('prepared');
    } finally { finishStop.release(); await operation; }
  });

  it.each(['navigation', 'loading', 'rendererExit', 'webContentsDestroyed', 'windowClose',
    'dispose', 'externalAdmissionClose', 'externalShutdown'] as const)(
    'does not revive its own-stop authority after %s', async invalidation => {
      const entered = gate();
      const finish = gate();
      let retained!: WorkspaceDeletionPreparationLifetime;
      const f = fixture(async (_captured, lifetime) => {
        retained = lifetime;
        lifetime.closeAdmissionForOwnStop();
        entered.release();
        await finish.promise;
        return 'prepared';
      });
      const operation = f.start();
      let closing: Promise<void> | undefined;
      try {
        await entered.promise;
        if (invalidation === 'navigation') f.webContents.emit('did-start-navigation', { isMainFrame: true });
        else if (invalidation === 'loading') f.webContents.emit('did-start-loading');
        else if (invalidation === 'rendererExit') f.webContents.emit('render-process-gone');
        else if (invalidation === 'webContentsDestroyed') f.webContents.emit('destroyed');
        else if (invalidation === 'windowClose') f.mainWindow.emit('close');
        else if (invalidation === 'dispose') f.capability.dispose();
        else if (invalidation === 'externalAdmissionClose') f.capability.closeAdmission();
        else closing = track(f.capability.shutdown());
        expect(() => retained.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
        finish.release();
        await expect(operation).rejects.toThrow('WORKSPACE_DELETE_FAILED');
        await closing;
        expect(() => retained.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
        expect(f.events).toEqual([expect.objectContaining({
          operationKind: 'delete', stage: 'deletePreparation',
          errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown',
        })]);
        expect(f.showSafeError).not.toHaveBeenCalled();
      } finally { finish.release(); await Promise.allSettled([operation, ...(closing ? [closing] : [])]); }
    },
  );

  it('joins an external shutdown without releasing the still-running command', async () => {
    const entered = gate();
    const finish = gate();
    const f = fixture(async (_captured, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      entered.release();
      await finish.promise;
      return 'prepared';
    });
    const operation = f.start();
    let closed = false;
    let closing: Promise<void> | undefined;
    try {
      await entered.promise;
      closing = track(Promise.all([f.capability.shutdown(), f.service.shutdown()]).then(() => { closed = true; }));
      await Promise.resolve();
      expect(closed).toBe(false);
      finish.release();
      await expect(operation).rejects.toThrow('WORKSPACE_DELETE_FAILED');
      await closing;
      expect(closed).toBe(true);
    } finally { finish.release(); await Promise.allSettled([operation, ...(closing ? [closing] : [])]); }
  });

  it('takes the existing mutation gate before synchronous re-entry', async () => {
    const entered = gate();
    const finish = gate();
    const f = fixture(async () => { entered.release(); await finish.promise; return 'prepared'; });
    const first = f.start();
    const second = f.start();
    try {
      await expect(second).rejects.toThrow('WORKSPACE_MANAGEMENT_BUSY');
      await entered.promise;
      expect(f.prepare).toHaveBeenCalledOnce();
      finish.release();
      await expect(first).resolves.toBe('prepared');
    } finally { finish.release(); await Promise.allSettled([first, second]); }
  });

  it('rejects a document change during the service admission read before command effects', async () => {
    const entered = gate();
    const finish = gate();
    const f = fixture(undefined, async () => { entered.release(); await finish.promise; });
    const operation = f.start();
    try {
      await entered.promise;
      f.webContents.emit('did-start-loading');
      finish.release();
      await expect(operation).rejects.toThrow('WORKSPACE_DELETE_FAILED');
      expect(f.prepare).not.toHaveBeenCalled();
    } finally { finish.release(); await Promise.allSettled([operation]); }
  });

  it('rejects an unresolved operation without opening a deletion-specific bypass', async () => {
    const f = fixture(undefined, async () => { throw new WorkspaceManagementRecoveryRequiredError(); });
    await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.events).toEqual([expect.objectContaining({ operationKind: 'delete',
      stage: 'admission', sideEffectState: 'none', errorCode: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' })]);
  });

  it('refuses unexpected preparation success values rather than claiming a deleted company', async () => {
    const f = fixture(async () => 'completed' as never);
    await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_FAILED');
    expect(f.events).toEqual([expect.objectContaining({ outcome: 'failed', sideEffectState: 'unknown' })]);
  });

  it('keeps the safe mapped failure and its original cause', async () => {
    const original = new Error('Synthetic original preparation failure');
    const f = fixture(async () => { throw original; });
    const lifetime = { assertCurrent() {}, closeAdmissionForOwnStop() {} };
    await expect(f.service.prepareDeletion(request, lifetime)).rejects.toMatchObject({
      code: 'WORKSPACE_DELETE_FAILED', cause: original,
    });
    expect(f.events).toEqual([expect.objectContaining({ stage: 'deletePreparation',
      errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', retryable: false })]);
  });

  it('preserves the original exception through the main-only capability boundary', async () => {
    const original = new Error('Synthetic original preparation failure');
    const f = fixture(async () => { throw original; });
    await expect(f.start()).rejects.toMatchObject({ message: 'WORKSPACE_DELETE_FAILED',
      cause: { code: 'WORKSPACE_DELETE_FAILED', cause: original } });
    expect(JSON.stringify(f.events)).not.toMatch(/Synthetic|message|stack|workspaceId|typedLabel/);
  });

  it.each([
    ['unknown', () => new Error('Synthetic original preparation failure')],
    ['registry label conflict', () => new WorkspaceRegistryMutationError('workspaceLabelExists')],
    ['creation label conflict', () => new EmptyWorkspaceCreationError('WORKSPACE_CREATION_LABEL_EXISTS', 'inputValidation')],
    ['import label conflict', () => new WorkspaceBackupImportError('WORKSPACE_IMPORT_LABEL_EXISTS', 'registryRead')],
  ] as const)('writes the real %s preparation failure to safe JSONL without losing its private exception', async (_kind, createFailure) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-deletion-preparation-log-'));
    onTestFinished(async ({ task }) => {
      if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
    });
    const failureSink = { recordFailure: vi.fn() };
    const observer = createWorkspaceBackupOperationalObserver({
      operationalIdentity: { appVersion: '0.2.81', buildRevision: 'development', runtimeInstanceId: workspaceId },
      operationalLogger: new JsonLineDesktopOperationalLogger({ logsRoot: root, failureSink }),
    });
    const original = createFailure();
    const f = fixture(async () => { throw original; }, undefined, observer);
    await expect(f.start()).rejects.toMatchObject({ message: 'WORKSPACE_DELETE_FAILED',
      cause: { code: 'WORKSPACE_DELETE_FAILED', cause: original } });
    expect(failureSink.recordFailure).not.toHaveBeenCalled();
    const files = await readdir(join(root, 'desktop'));
    expect(files).toHaveLength(1);
    const raw = await readFile(join(root, 'desktop', files[0]!), 'utf8');
    const events = raw.trim().split('\n').map(line => JSON.parse(line));
    expect(events).toEqual([expect.objectContaining({ eventName: 'workspaceManagement.operationFailed',
      operationId: 'workspace.delete', stage: 'deletePreparation', errorCode: 'WORKSPACE_DELETE_FAILED',
      sideEffectState: 'unknown', retryable: false })]);
    expect(raw).not.toMatch(/Synthetic|typedLabel|workspaceId|workspaceLabel|password|stack|cause|message/);
  });

  it('does not replace the first failure when the existing observer also throws', async () => {
    const original = new Error('Synthetic original preparation failure');
    const f = fixture(async () => { throw original; }, undefined, {
      record() { throw new Error('Synthetic observer failure'); },
    });
    await expect(f.start()).rejects.toMatchObject({ message: 'WORKSPACE_DELETE_FAILED',
      cause: { code: 'WORKSPACE_DELETE_FAILED', cause: original } });
  });

  it.each([
    ['WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN'],
    ['WORKSPACE_MANAGEMENT_CREATE_FAILED', 'WORKSPACE_DELETE_FAILED'],
  ] as const)('maps a nested %s to the deletion contract without discarding its cause', async (code, expected) => {
    const original = new WorkspaceManagementError(code, 'create');
    const f = fixture(async () => { throw original; });
    await expect(f.service.prepareDeletion(request, { assertCurrent() {}, closeAdmissionForOwnStop() {} }))
      .rejects.toMatchObject({ code: expected, operationKind: 'delete', cause: original });
    expect(f.events).toEqual([expect.objectContaining({ errorCode: expected, operationKind: 'delete' })]);
  });

  it('rejects a forged sender and extra arguments before invoking preparation', async () => {
    const f = fixture();
    await expect(f.capability.prepareDeletion({ ...f.event, sender: {} } as IpcMainInvokeEvent, request))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    await expect(f.capability.prepareDeletion(f.event, request, 'extra'))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });

  it('registers only the final deletion command, never the preparation method', () => {
    const f = fixture();
    expect([...f.handlers.keys()]).toEqual([...workspaceManagementIpcChannels]);
    expect(f.handlers.has(deleteWorkspaceIpcChannel)).toBe(true);
    expect([...f.handlers.keys()].some(channel => channel.endsWith(':prepare-deletion'))).toBe(false);
  });
});

describe('workspace deletion public IPC', () => {
  it.each(['cancelled', 'completed'] as const)('uses the actual capability and service for %s', async outcome => {
    const continuation = deletionContinuationFixture();
    const f = fixture(async () => outcome === 'cancelled' ? 'cancelled' : 'prepared',
      undefined, undefined, continuation.port);
    const invoke = f.handlers.get(deleteWorkspaceIpcChannel)!;
    await expect(track(invoke(f.event, request))).resolves.toEqual(outcome === 'cancelled'
      ? { formatVersion: 1, status: 'cancelled', nextAction: 'continue' } : continuation.completion);
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.runtime.complete).toHaveBeenCalledTimes(outcome === 'completed' ? 1 : 0);
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it.each(['sender', 'frame', 'arity', 'payload'] as const)('rejects invalid %s before preparation', async invalid => {
    const f = fixture();
    const event = { ...f.event, ...(invalid === 'sender' ? { sender: {} } : {}),
      ...(invalid === 'frame' ? { senderFrame: {} } : {}) };
    const args = invalid === 'arity' ? [request, 'extra'] : [invalid === 'payload' ? { ...request, path: 'excluded' } : request];
    await expect(track(f.handlers.get(deleteWorkspaceIpcChannel)!(event, ...args))).rejects.toThrow(
      invalid === 'payload' ? 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' : 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('strips the private cause at the public boundary but keeps it at the main projection owner', async () => {
    const original = new Error('SYNTHETIC_PUBLIC_DELETE_ORIGINAL', { cause: new Error('SYNTHETIC_PRIVATE_CAUSE') });
    const projection = new Error('SYNTHETIC_PUBLIC_DELETE_PROJECTION');
    const f = fixture(undefined, undefined, undefined, undefined, { projectFailure() { throw projection; } });
    vi.spyOn(f.service, 'deleteWorkspace').mockRejectedValueOnce(original);
    const error = await track(f.handlers.get(deleteWorkspaceIpcChannel)!(f.event, request)).catch(cause => cause);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('EXPECTED_SAFE_PUBLIC_DELETION_ERROR');
    expect(error.message).toBe('WORKSPACE_DELETE_FAILED');
    expect(error.cause).toBeUndefined();
    expect(String(error.stack)).not.toContain('SYNTHETIC_');
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: original, sideEffectState: 'unknown' });
  });

  it('removes the public channel and rejects a retained handler after admission closes', async () => {
    const f = fixture(), invoke = f.handlers.get(deleteWorkspaceIpcChannel)!;
    f.capability.closeAdmission();
    expect(f.handlers.has(deleteWorkspaceIpcChannel)).toBe(false);
    await expect(track(invoke(f.event, request))).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('does not publish an unrecognized inner error code from a runtime follow-up', async () => {
    const original = new WorkspaceManagementError('SYNTHETIC_PRIVATE_CODE' as never, 'delete');
    const f = fixture(async () => 'cancelled', undefined, undefined, deletionContinuationFixture().port, {
      readNextAction() { throw original; },
    });
    const failure = await track(f.handlers.get(deleteWorkspaceIpcChannel)!(f.event, request)).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error('EXPECTED_SAFE_PUBLIC_DELETION_ERROR');
    expect(failure.message).toBe('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
    expect(failure.cause).toBeUndefined();
    expect(String(failure.stack)).not.toContain(original.code);
  });
});

describe('workspace deletion main-only completion response', () => {
  it('projects internal cancellation from the separate runtime follow-up owner', async () => {
    const continuation = deletionContinuationFixture();
    const f = fixture(async () => 'cancelled', undefined, undefined, continuation.port);
    await expect(f.startDurable()).resolves.toEqual({ formatVersion: 1, status: 'cancelled', nextAction: 'continue' });
    expect(f.runtime.readNextAction).toHaveBeenCalledOnce();
    expect(f.runtime.complete).not.toHaveBeenCalled();
    expect(continuation.captureAuthority).not.toHaveBeenCalled();
    expect(continuation.resume).not.toHaveBeenCalled();
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it.each(['continue', 'relaunching', 'restartRequired'] as const)(
    'does not infer %s from the internal cancellation receipt', async nextAction => {
      const continuation = deletionContinuationFixture();
      const f = fixture(async () => 'cancelled', undefined, undefined, continuation.port, {
        readNextAction: () => nextAction,
        async complete() { throw new Error('UNEXPECTED_COMPLETION_AFTER_CANCELLATION'); },
      });
      await expect(f.startDurable()).resolves.toEqual({ formatVersion: 1, status: 'cancelled', nextAction });
      expect(f.runtime.readNextAction).toHaveBeenCalledOnce();
      expect(f.runtime.complete).not.toHaveBeenCalled();
      expect(continuation.resume).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-contract runtime action without leaking it or starting a relaunch', async () => {
    const f = fixture(async () => 'cancelled', undefined, undefined, deletionContinuationFixture().port, {
      readNextAction: () => 'synthetic-private-runtime-value' as never,
      async complete() { throw new Error('UNEXPECTED_COMPLETION_AFTER_CANCELLATION'); },
    });
    await expect(f.startDurable()).rejects.toMatchObject({ message: 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' });
    expect(f.runtime.complete).not.toHaveBeenCalled();
    expect(f.showSafeError).not.toHaveBeenCalled();
  });

  it('keeps main completion pending after service settlement and lease release', async () => {
    const entered = gate();
    const finish = gate();
    const continuation = deletionContinuationFixture();
    const f = fixture(undefined, undefined, undefined, continuation.port, {
      readNextAction: () => 'restartRequired',
      async complete(result) {
        expect(result).toEqual(continuation.completion);
        expect(f.maintenanceLease.readState()).toBe('idle');
        entered.release(); await finish.promise;
      },
    });
    const operation = observeSettlement(f.startDurable());
    await entered.promise;
    await expectUnsettled(operation);
    const serviceClosing = observeSettlement(track(f.service.shutdown()));
    await serviceClosing.result;
    expect(serviceClosing.isSettled()).toBe(true);
    const capabilityClosing = observeSettlement(track(f.capability.shutdown()));
    await expectUnsettled(capabilityClosing);
    finish.release();
    await expect(operation.result).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    await capabilityClosing.result;
    expect(continuation.recordRemoved).toHaveBeenCalledOnce();
    expect(f.runtime.complete).toHaveBeenCalledOnce();
  });

  it('preserves a main completion failure instead of returning completed deletion', async () => {
    const original = new Error('Synthetic original return failure');
    const continuation = deletionContinuationFixture();
    const f = fixture(undefined, undefined, undefined, continuation.port, {
      readNextAction: () => 'restartRequired',
      async complete() { throw original; },
    });
    await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: original, sideEffectState: 'unknown' });
    expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toBe(original);
    expect(continuation.recordRemoved).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('idle');
    expect(f.runtime.complete).toHaveBeenCalledOnce();
  });

  it('admits only one durable mutation while preparation remains held', async () => {
    const entered = gate();
    const finish = gate();
    const continuation = deletionContinuationFixture();
    const f = fixture(async () => {
      entered.release();
      await finish.promise;
      return 'prepared';
    }, undefined, undefined, continuation.port);
    const first = f.startDurable();
    const second = f.startDurable();
    await expect(second).rejects.toThrow('WORKSPACE_MANAGEMENT_BUSY');
    await entered.promise;
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(continuation.resume).not.toHaveBeenCalled();
    finish.release();
    await expect(first).resolves.toEqual(continuation.completion);
    expect(continuation.resume).toHaveBeenCalledOnce();
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it('uses the same own-stop lifetime without registering a renderer deletion channel', async () => {
    const continuation = deletionContinuationFixture();
    const f = fixture(async (_request, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      return 'prepared';
    }, undefined, undefined, continuation.port);
    expect([...f.handlers.keys()]).toEqual([...workspaceManagementIpcChannels]);
    await expect(f.startDurable()).resolves.toEqual(continuation.completion);
    expect(continuation.captureAuthority).toHaveBeenCalledOnce();
    expect(continuation.recordRemoved).toHaveBeenCalledExactlyOnceWith(continuation.receipt);
    expect(f.maintenanceLease.readState()).toBe('idle');
    expect(f.handlers.size).toBe(0);
    expect(f.showSafeError).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'loading', 'rendererExit', 'windowClose', 'dispose', 'admissionClose'] as const)(
    'discards a stale %s response without revoking the already handed-off command', async invalidation => {
      const entered = gate();
      const finish = gate();
      const continuation = deletionContinuationFixture(async (_operationId, authority) => {
        entered.release();
        await finish.promise;
        await authority.assertOwned();
        authority.recordRemoved(continuation.receipt);
        return continuation.completion;
      });
      const f = fixture(async (_request, lifetime) => {
        lifetime.closeAdmissionForOwnStop();
        return 'prepared';
      }, undefined, undefined, continuation.port);
      const operation = f.startDurable();
      await entered.promise;
      if (invalidation === 'navigation') f.webContents.emit('did-start-navigation', { isMainFrame: true });
      else if (invalidation === 'loading') f.webContents.emit('did-start-loading');
      else if (invalidation === 'rendererExit') f.webContents.emit('render-process-gone');
      else if (invalidation === 'windowClose') f.mainWindow.emit('close');
      else if (invalidation === 'dispose') f.capability.dispose();
      else f.capability.closeAdmission();
      finish.release();
      await expect(operation).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
      expect(continuation.recordRemoved).toHaveBeenCalledExactlyOnceWith(continuation.receipt);
      expect(f.runtime.complete).toHaveBeenCalledExactlyOnceWith(continuation.completion);
      expect(f.maintenanceLease.readState()).toBe('idle');
      expect(f.events).toEqual([]);
      expect(f.showSafeError).not.toHaveBeenCalled();
    },
  );

  it('rejects a stale preparation before capturing the durable owner', async () => {
    const entered = gate();
    const finish = gate();
    const continuation = deletionContinuationFixture();
    const f = fixture(async (_request, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      entered.release();
      await finish.promise;
      return 'prepared';
    }, undefined, undefined, continuation.port);
    const operation = f.startDurable();
    await entered.promise;
    f.webContents.emit('did-start-loading');
    finish.release();
    await expect(operation).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
    expect(continuation.captureAuthority).not.toHaveBeenCalled();
    expect(continuation.resume).not.toHaveBeenCalled();
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it('waits for a held service command during an external capability and service shutdown', async () => {
    const entered = gate();
    const finish = gate();
    const continuation = deletionContinuationFixture(async (_operationId, authority) => {
      entered.release();
      await finish.promise;
      await authority.assertOwned();
      authority.recordRemoved(continuation.receipt);
      return continuation.completion;
    });
    const f = fixture(async (_request, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      return 'prepared';
    }, undefined, undefined, continuation.port);
    const operation = f.startDurable();
    await entered.promise;
    const capabilityClosing = observeSettlement(track(f.capability.shutdown()));
    const serviceClosing = observeSettlement(track(f.service.shutdown()));
    await expectUnsettled(capabilityClosing);
    await expectUnsettled(serviceClosing);
    expect(f.maintenanceLease.readState()).toBe('busy');
    finish.release();
    await expect(operation).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
    await Promise.all([capabilityClosing.result, serviceClosing.result]);
    expect(capabilityClosing.isSettled()).toBe(true);
    expect(serviceClosing.isSettled()).toBe(true);
    expect(continuation.recordRemoved).not.toHaveBeenCalled();
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it('detects premature capability shutdown even when service shutdown is still pending', async () => {
    const entered = gate();
    const finish = gate();
    const continuation = deletionContinuationFixture(async (_operationId, authority) => {
      entered.release();
      await finish.promise;
      await authority.assertOwned();
      authority.recordRemoved(continuation.receipt);
      return continuation.completion;
    });
    const f = fixture(async (_request, lifetime) => {
      lifetime.closeAdmissionForOwnStop();
      return 'prepared';
    }, undefined, undefined, continuation.port);
    const realShutdown = f.capability.shutdown.bind(f.capability);
    const brokenCapability = { ...f.capability,
      shutdown: () => Promise.all([]).then(() => undefined) };
    const operation = f.startDurable();
    try {
      await entered.promise;
      const capabilityClosing = observeSettlement(track(brokenCapability.shutdown()));
      const serviceClosing = observeSettlement(track(f.service.shutdown()));
      await expect(expectUnsettled(capabilityClosing)).rejects.toThrow();
      expect(capabilityClosing.isSettled()).toBe(true);
      await expectUnsettled(serviceClosing);
      expect(f.maintenanceLease.readState()).toBe('busy');
      finish.release();
      await expect(operation).resolves.toEqual(unknownDeletionResult);
      expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      await Promise.all([capabilityClosing.result, serviceClosing.result]);
      expect(continuation.recordRemoved).not.toHaveBeenCalled();
      expect(f.maintenanceLease.readState()).toBe('idle');
    } finally {
      finish.release();
      await Promise.allSettled([operation, track(realShutdown()), track(f.service.shutdown())]);
    }
  });

  it.each(['sender', 'frame', 'extraArgument'] as const)('rejects an untrusted %s before the durable service', async variant => {
    const continuation = deletionContinuationFixture();
    const f = fixture(undefined, undefined, undefined, continuation.port);
    const event = variant === 'sender' ? { ...f.event, sender: {} }
      : variant === 'frame' ? { ...f.event, senderFrame: {} } : f.event;
    await expect(f.capability.deleteWorkspace(event as IpcMainInvokeEvent, request,
      ...(variant === 'extraArgument' ? ['extra'] : [])))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(continuation.captureAuthority).not.toHaveBeenCalled();
  });

  it('delivers the original durable exception to main before returning a safe failure result', async () => {
    const original = new Error('Synthetic original durable failure');
    const continuation = deletionContinuationFixture(async () => { throw original; });
    const f = fixture(undefined, undefined, undefined, continuation.port);
    await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({
      cause: expect.objectContaining({ code: 'WORKSPACE_DELETE_FAILED', cause: original }), sideEffectState: 'unknown',
    });
    expect((f.runtime.projectFailure.mock.calls[0]![0].cause as Error).cause).toBe(original);
    expect(JSON.stringify(f.events)).not.toMatch(/Synthetic|message|cause|stack|workspaceId|typedLabel/);
    expect(f.maintenanceLease.readState()).toBe('idle');
  });

  it.each([
    { formatVersion: 1, status: 'prepared' },
    { formatVersion: 1, status: 'completed' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue' },
    { formatVersion: 1, status: 'completed', navigation: 'selector', private: 'untrusted' },
  ])('never upgrades a malformed internal service result to success at case %#', async value => {
    const f = fixture();
    vi.spyOn(f.service, 'deleteWorkspace').mockResolvedValueOnce(value as never);
    await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
    expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toMatchObject({ message: 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' });
    expect(f.runtime.complete).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it('uses a real pre-admission outcome rather than the observer as its no-effect proof', async () => {
    const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    const expected = { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_MANAGEMENT_BUSY',
      sideEffectState: 'none', nextAction: 'continue' } as const;
    const f = fixture(undefined, async () => { throw original; }, {
      record() { throw new Error('SYNTHETIC_LOGGER_UNAVAILABLE'); },
    }, undefined, { projectFailure: () => expected });
    await expect(f.startDurable()).resolves.toEqual(expected);
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: original, sideEffectState: 'none' });
    expect(f.runtime.projectFailure.mock.calls[0]![0].cause).toBe(original);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.runtime.complete).not.toHaveBeenCalled();
  });

  it.each(['matched', 'missing', 'differentCause', 'duplicate', 'unknown', 'accessor', 'extraField'] as const)(
    'keeps failure proof scoped to this exact rejection: %s', async variant => {
      const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
      const f = fixture();
      const getter = vi.fn(() => original);
      vi.spyOn(f.service, 'deleteWorkspace').mockImplementationOnce(async (_request, _lifetime, report) => {
        if (variant === 'accessor') report!(Object.defineProperty({ sideEffectState: 'none' }, 'cause',
          { get: getter, enumerable: true }) as never);
        else if (variant === 'extraField') report!({ cause: original, sideEffectState: 'none', unexpected: true } as never);
        else if (variant !== 'missing') {
          const value = { cause: variant === 'differentCause' ? new Error('SYNTHETIC_OTHER_FAILURE') : original,
            sideEffectState: variant === 'unknown' ? 'unknown' as const : 'none' as const };
          report!(value);
          if (variant === 'duplicate') report!(value);
        }
        throw original;
      });
      await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
      expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: original,
        sideEffectState: variant === 'matched' ? 'none' : 'unknown' });
      expect(getter).not.toHaveBeenCalled();
      expect(f.prepare).not.toHaveBeenCalled();
    },
  );

  it('cannot reuse a late service proof for a later main-completion error', async () => {
    const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    let retained: WorkspaceDeletionFailureOutcomeHandler | undefined;
    const completion = deletionContinuationFixture().completion;
    const f = fixture(undefined, undefined, undefined, undefined, {
      async complete() {
        retained!({ cause: original, sideEffectState: 'none' });
        throw original;
      },
    });
    vi.spyOn(f.service, 'deleteWorkspace').mockImplementationOnce(async (_request, _lifetime, report) => {
      retained = report; return completion;
    });
    await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: original, sideEffectState: 'unknown' });
    expect(f.runtime.complete).toHaveBeenCalledOnce();
  });

  it('leaves malformed proof unavailable even when the rejection value itself is undefined', async () => {
    const f = fixture();
    vi.spyOn(f.service, 'deleteWorkspace').mockImplementationOnce(async (_request, _lifetime, report) => {
      report!({ unexpected: true } as never);
      throw undefined;
    });
    await expect(f.startDurable()).resolves.toEqual(unknownDeletionResult);
    expect(f.runtime.projectFailure).toHaveBeenCalledExactlyOnceWith({ cause: undefined, sideEffectState: 'unknown' });
  });

  it.each([
    { formatVersion: 1, status: 'completed', navigation: 'selector' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_MANAGEMENT_BUSY', sideEffectState: 'none', nextAction: 'continue' },
  ] as const)('rejects an unsafe failure projection without losing its first cause at case %#', async value => {
    const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    const f = fixture(undefined, undefined, undefined, undefined, { projectFailure: () => value });
    vi.spyOn(f.service, 'deleteWorkspace').mockRejectedValueOnce(original);
    const failure = await f.startDurable().catch(error => error);
    expect(failure).toMatchObject({ message: original.code });
    const aggregate = (failure.cause as Error).cause as AggregateError;
    expect(aggregate.cause).toBe(original);
    expect(aggregate.errors[0]).toBe(original);
    expect(aggregate.errors[1]).toMatchObject({ message: 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' });
    expect(f.runtime.complete).not.toHaveBeenCalled();
  });
});

function observeSettlement<T>(result: Promise<T>) {
  let settled = false;
  void result.then(() => { settled = true; }, () => { settled = true; });
  return { result, isSettled: () => settled };
}

async function expectUnsettled(work: { isSettled(): boolean }) {
  await setImmediate();
  expect(work.isSettled()).toBe(false);
}

function deletionContinuationFixture(resume?: NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']) {
  const completion = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const });
  const receipt = Object.freeze({ synthetic: 'removalReceipt' });
  const recordRemoved = vi.fn((value: unknown) => { expect(value).toBe(receipt); return completion; });
  const captureAuthority = vi.fn((_operationId: string, assertLease: () => void) => ({
    assertCurrent: assertLease, async assertOwned() { assertLease(); }, recordRemoved,
  }));
  const command = vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>(
    resume ?? (async (_operationId, authority) => {
      await authority.assertOwned(); authority.recordRemoved(receipt); return completion;
    }),
  );
  return { completion, receipt, recordRemoved, captureAuthority, resume: command,
    port: { captureAuthority, resume: command } };
}

function fixture(
  prepare: Prepare = async () => 'prepared',
  guard = async () => {},
  observer?: WorkspaceManagementObserver,
  continuation?: WorkspaceManagementServiceOptions['deletionContinuation'],
  resultRuntime?: Partial<WorkspaceDeletionResultRuntime>,
) {
  const events: Readonly<WorkspaceManagementOperationEvent>[] = [];
  const command = vi.fn(prepare);
  const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_OPERATION'); };
  const create = vi.fn(unexpected);
  const maintenanceLease = new InMemoryWorkspaceMaintenanceLease();
  const service = new WorkspaceManagementService({
    createEmpty: { create }, importBackup: { import: unexpected },
    renameWorkspace: { rename: unexpected }, switchWorkspace: { switchTo: unexpected },
    maintenanceState: maintenanceLease,
    registry: { async read() { return { formatVersion: 2, activeWorkspaceId: null, workspaces: [] }; } },
    operationGuard: { assertNoUnresolvedOperations: guard, async readRecoveryState() { return 'clear'; } },
    observer: { record: event => { events.push(event); observer?.record(event); } },
    deletionPreparation: { maintenanceLease, prepare: command },
    ...(continuation === undefined ? {} : { deletionContinuation: continuation }),
  });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const mainFrame = {};
  const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  const showSafeError = vi.fn();
  const runtime = {
    readNextAction: vi.fn(resultRuntime?.readNextAction ?? (() => 'continue' as const)),
    complete: vi.fn(resultRuntime?.complete ?? (async () => undefined)),
    projectFailure: vi.fn<WorkspaceDeletionResultRuntime['projectFailure']>(
      resultRuntime?.projectFailure ?? (() => unknownDeletionResult),
    ),
  };
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }, removeHandler: (channel: string) => handlers.delete(channel) } as never,
    mainWindow: mainWindow as never, passwordWindow: { requestPassword: unexpected },
    confirmActiveWorkspaceReplacement: unexpected, selectBackupSource: unexpected,
    selectReplacementBackupSource: unexpected, service, showSafeError, deletionRuntime: runtime,
  });
  const f = { capability, service, prepare: command, create, handlers, event, webContents,
    mainWindow, showSafeError, events, maintenanceLease, runtime,
    start: () => track(capability.prepareDeletion(event, request)),
    startDurable: () => track(capability.deleteWorkspace(event, request)) };
  fixtures.push(f);
  return f;
}
