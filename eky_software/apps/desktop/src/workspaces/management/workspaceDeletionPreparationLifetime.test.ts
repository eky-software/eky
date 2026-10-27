import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { EmptyWorkspaceCreationError } from '../creation/emptyWorkspaceCreationError.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { WorkspaceRegistryMutationError } from '../registry/workspaceRegistryMutations.js';
import { createWorkspaceManagementCapability, type WorkspaceManagementCapability } from './workspaceManagementCapability.js';
import { createEmptyWorkspaceIpcChannel, workspaceManagementIpcChannels } from './workspaceManagementCapabilityProtocol.js';
import { WorkspaceManagementRecoveryRequiredError } from './workspaceManagementOperationGuard.js';
import { WorkspaceManagementService, type WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';
import { JsonLineDesktopOperationalLogger } from '../../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import type { WorkspaceDeletionPreparationLifetime, WorkspaceManagementObserver, WorkspaceManagementOperationEvent } from './workspaceManagementTypes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const request = { formatVersion: 1, workspaceId, typedLabel: 'Synthetic company',
  backupChoice: 'explicitDataLoss' as const };
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

  it('never registers deletion IPC while the real W7.4 consumer is absent', () => {
    const f = fixture();
    expect([...f.handlers.keys()]).toEqual([...workspaceManagementIpcChannels]);
    expect([...f.handlers.keys()].some(channel => channel.endsWith(':delete'))).toBe(false);
  });
});

function fixture(
  prepare: Prepare = async () => 'prepared',
  guard = async () => {},
  observer?: WorkspaceManagementObserver,
) {
  const events: Readonly<WorkspaceManagementOperationEvent>[] = [];
  const command = vi.fn(prepare);
  const unexpected = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_OPERATION'); };
  const create = vi.fn(unexpected);
  const service = new WorkspaceManagementService({
    createEmpty: { create }, importBackup: { import: unexpected },
    renameWorkspace: { rename: unexpected }, switchWorkspace: { switchTo: unexpected },
    maintenanceState: new InMemoryWorkspaceMaintenanceLease(),
    registry: { async read() { return { formatVersion: 2, activeWorkspaceId: null, workspaces: [] }; } },
    operationGuard: { assertNoUnresolvedOperations: guard, async readRecoveryState() { return 'clear'; } },
    observer: { record: event => { events.push(event); observer?.record(event); } },
    deletionPreparation: { prepare: command },
  });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const mainFrame = {};
  const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  const showSafeError = vi.fn();
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }, removeHandler: (channel: string) => handlers.delete(channel) } as never,
    mainWindow: mainWindow as never, passwordWindow: { requestPassword: unexpected },
    confirmActiveWorkspaceReplacement: unexpected, selectBackupSource: unexpected,
    selectReplacementBackupSource: unexpected, service, showSafeError,
  });
  const f = { capability, service, prepare: command, create, handlers, event, webContents,
    mainWindow, showSafeError, events, start: () => track(capability.prepareDeletion(event, request)) };
  fixtures.push(f);
  return f;
}
