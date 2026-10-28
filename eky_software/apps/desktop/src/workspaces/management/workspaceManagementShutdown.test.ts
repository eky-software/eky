import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmptyWorkspaceCreationCoordinator } from '../creation/emptyWorkspaceCreationCoordinator.js';
import {
  createTestBootstrapResult, MemoryWorkspaceCreationJournal, MemoryWorkspaceCreationRootStore,
  MemoryWorkspaceRegistry, TEST_CREATED_AT, TEST_OPERATION_ID, TEST_USER_DATA_ROOT, TEST_WORKSPACE_ID,
} from '../creation/emptyWorkspaceCreationTestSupport.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { createWorkspaceManagementCapability } from './workspaceManagementCapability.js';
import { createEmptyWorkspaceIpcChannel } from './workspaceManagementCapabilityProtocol.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';

const capabilities: ReturnType<typeof createWorkspaceManagementCapability>[] = [];
afterEach(() => { for (const capability of capabilities.splice(0)) capability.dispose(); });

describe('workspace management settlement through the existing IPC and service owners', () => {
  it('keeps actual coordinator work and its lease until admission-only closure settles', async () => {
    const f = fixture();
    const operation = f.create();
    try {
      await f.bootstrapEntered.promise;
      f.capability.closeAdmission();
      f.service.closeAdmission();
      expect(f.lease.readState()).toBe('busy');
      expect(f.events).not.toContain('reservation.close');
      f.bootstrapFinish.resolve();
      await expect(operation).resolves.toEqual({ formatVersion: 1, status: 'relaunching' });
      expect(f.lease.readState()).toBe('idle');
      expect(f.journal.current).toBeUndefined();
      await f.shutdown();
      expect(f.events.at(-1)).toBe('reservation.close');
    } finally { f.bootstrapFinish.resolve(); await operation; await f.shutdown(); }
  });

  it.each(['success', 'failure'] as const)(
    'waits for creation, cleanup and lease release while preserving %s', async outcome => {
      const f = fixture();
      const operation = f.create();
      const assertion = outcome === 'success'
        ? expect(operation).resolves.toEqual({ formatVersion: 1, status: 'relaunching' })
        : expect(operation).rejects.toThrow('WORKSPACE_MANAGEMENT_CREATE_FAILED');
      await f.bootstrapEntered.promise;
      const closing = f.shutdown();
      let closed = false;
      void closing.then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(f.lease.readState()).toBe('busy');
      expect(f.journal.current?.state).toBe('candidateRootCreated');
      expect(f.registry.writes).toHaveLength(0);
      if (outcome === 'success') f.bootstrapFinish.resolve();
      else f.bootstrapFinish.reject(new Error('synthetic bootstrap failure'));
      await assertion;
      await closing;
      expect(f.journal.current).toBeUndefined();
      expect(f.registry.value?.activeWorkspaceId).toBeNull();
      expect(f.registry.value?.formatVersion).toBe(2);
      expect(f.registry.writes).toHaveLength(outcome === 'success' ? 1 : 0);
      expect(f.roots.candidateExists).toBe(false);
      expect(f.roots.finalExists).toBe(outcome === 'success');
      expect(f.lease.readState()).toBe('idle');
      expect(f.relaunch).toHaveBeenCalledOnce();
      expect(f.events.at(-1)).toBe('reservation.close');
      const cleanupEvent = outcome === 'success' ? 'journal.remove' : 'journal.discard';
      expect(f.events).toContain(cleanupEvent);
      expect(f.events.indexOf(cleanupEvent)).toBeLessThan(f.events.indexOf('reservation.close'));
      expect(f.showSafeError).not.toHaveBeenCalled();
    },
  );

  it('does not turn settled work into native absence or delete uncertain recovery evidence', async () => {
    const f = fixture();
    const operation = f.create();
    const failed = expect(operation).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    await f.bootstrapEntered.promise;
    f.loseReservation();
    const closing = f.shutdown();
    const closeFailed = expect(closing).rejects.toThrow('WORKSPACE_RUNTIME_STILL_ACTIVE');
    f.bootstrapFinish.resolve();
    await failed;
    await closeFailed;
    expect(f.journal.current?.state).toBe('candidateRootCreated');
    expect(f.roots.candidateExists).toBe(true);
    expect(f.registry.writes).toHaveLength(0);
    expect(f.relaunch).not.toHaveBeenCalled();
    expect(f.events).not.toContain('reservation.close');
  });

  it('allows deferred relaunch to request shutdown without waiting on its own command', async () => {
    const f = fixture();
    let closing: Promise<void> | undefined;
    f.relaunch.mockImplementationOnce(() => { closing = f.shutdown(); });
    const operation = f.create();
    await f.bootstrapEntered.promise;
    f.bootstrapFinish.resolve();
    await expect(operation).resolves.toMatchObject({ status: 'relaunching' });
    expect(closing).toBeDefined();
    await closing;
    expect(f.events.at(-1)).toBe('reservation.close');
    expect(f.journal.current).toBeUndefined();
  });
});

function fixture() {
  const events: string[] = [];
  const registry = new MemoryWorkspaceRegistry(events, { formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
  const journal = new MemoryWorkspaceCreationJournal(events);
  const roots = new MemoryWorkspaceCreationRootStore(events);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const relaunch = vi.fn();
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  let selectorCurrent = true;
  let reservationCurrent = true;
  const assertMainCurrent = () => {
    if (!reservationCurrent) throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
  };
  const reservation = { assertMainCurrent, async assertMainOwned() { assertMainCurrent(); } };
  const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({
    assertSelectorCurrent() { if (!selectorCurrent) throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID'); },
    maintenanceLease: lease, reservation, runtimeRelaunch,
  });
  const bootstrapEntered = deferred<void>();
  const bootstrapFinish = deferred<void>();
  const coordinator = new EmptyWorkspaceCreationCoordinator({
    activeWorkspaceLifecycle: lifecycle, workspaceRuntimeAbsence: lifecycle,
    bootstrap: { async bootstrap() {
      bootstrapEntered.resolve();
      await bootstrapFinish.promise;
      return createTestBootstrapResult();
    } },
    creationJournal: journal, generateOperationId: () => TEST_OPERATION_ID,
    generateWorkspaceId: () => TEST_WORKSPACE_ID, now: () => new Date(TEST_CREATED_AT),
    maintenanceLease: lease, registry, rootStore: roots, userDataRoot: TEST_USER_DATA_ROOT,
  });
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected fixture operation'); };
  const service = new WorkspaceManagementService({
    createEmpty: coordinator, importBackup: { import: unexpected }, replaceActive: { replace: unexpected },
    switchWorkspace: { switchTo: unexpected }, renameWorkspace: { rename: unexpected },
    maintenanceState: lease, registry, runtimeRelaunchCompletion: runtimeRelaunch,
    operationGuard: { async assertNoUnresolvedOperations() {}, async readRecoveryState() { return 'clear'; } },
  });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const mainFrame = {};
  const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const showSafeError = vi.fn();
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }, removeHandler: (channel: string) => handlers.delete(channel) } as never,
    mainWindow: mainWindow as never,
    passwordWindow: { requestPassword: unexpected }, confirmActiveWorkspaceReplacement: unexpected,
    selectBackupSource: unexpected, selectReplacementBackupSource: unexpected, service, showSafeError,
  });
  capabilities.push(capability);
  let shutdownTask: Promise<void> | undefined;
  return {
    events, registry, journal, roots, lease, relaunch, bootstrapEntered, bootstrapFinish, showSafeError,
    capability, service,
    loseReservation() { reservationCurrent = false; },
    create() {
      return handlers.get(createEmptyWorkspaceIpcChannel)!(
        { sender: webContents, senderFrame: mainFrame }, { workspaceLabel: 'Synthetic company' });
    },
    shutdown() {
      const capabilitySettlement = capability.shutdown();
      const serviceSettlement = service.shutdown();
      shutdownTask ??= Promise.all([capabilitySettlement, serviceSettlement]).then(async () => {
        await reservation.assertMainOwned();
        assertMainCurrent();
        selectorCurrent = false;
        events.push('reservation.close');
      });
      return shutdownTask;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
