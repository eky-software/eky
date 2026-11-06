import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { utilityProcess } from 'electron';
import { expect, it, vi, type TestContext } from 'vitest';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { EmptyWorkspaceCreationCoordinator } from '../creation/emptyWorkspaceCreationCoordinator.js';
import { WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../creation/workspaceCreationJournalPaths.js';
import { WorkspaceBackupImportCoordinator } from '../import/workspaceBackupImportCoordinator.js';
import { WorkspaceBackupContainerAdapter } from '../import/workspaceBackupContainerAdapter.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../import/privateWorkspaceBackupCandidateAdapter.js';
import { createTestImportPreflight, createTestImportReadiness } from '../import/workspaceBackupImportTestSupport.js';
import { importBindingGate } from '../import/workspaceBackupImportBindingTestSupport.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import * as readOnlySlots from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import * as registryFileSystem from '../registry/workspaceRegistryFileSystem.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceBackupReplacementCoordinator } from '../replacement/workspaceBackupReplacementCoordinator.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { createWorkspaceSwitchJournalPaths, WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';
import { createWorkspaceManagementComposition } from './workspaceManagementComposition.js';
import { MainOwnedWorkspaceManagementOperationGuard } from './mainOwnedWorkspaceManagementOperationGuard.js';
import * as backupObserver from './workspaceBackupOperationalObserver.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { readSupportBundleDesktopData } from '../../supportBundle/supportBundleDesktopData.js';
import { createDesktopOperationalEvent } from '../../observability/createDesktopOperationalEvent.js';
import { createDesktopOnlySupportBundleCapability } from '../../supportBundle/supportBundleCapability.js';
import { writeSupportBundleAtomically } from '../../supportBundle/supportBundleFileStore.js';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const selectorRegistry: Readonly<LocalWorkspaceRegistry> = {
  ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null,
};

it('captures only the settled current operation through the real observer even when logging fails', async test => {
  const f = await fixture(test);
  const initial = f.composition.captureOperationObservation();
  expect(initial.readObservation()).toEqual({ scope: 'currentOperation', status: 'unavailable' });
  f.log.mockImplementation(() => { throw new Error('SYNTHETIC_LOGGING_FAILURE'); });
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, selectorRegistry.workspaces[0]!.workspaceLabel))
    .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' });
  expect(() => initial.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const selected = f.composition.captureOperationObservation();
  const observation = selected.readObservation();
  expect(observation).toMatchObject({ scope: 'currentOperation', status: 'available', cleanupError: null,
    firstError: { eventName: 'workspaceManagement.operationFailed', operationId: 'workspace.rename',
      errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' } });
  if (observation.status !== 'available') throw new Error('MISSING_CURRENT_OBSERVATION');
  expect(observation.firstError).toBe(f.log.mock.calls[0]![0]);
  expect(Object.isFrozen(observation)).toBe(true);
  expect(Object.isFrozen(observation.firstError)).toBe(true);
  await f.composition.service.getStatus();
  expect(selected.readObservation()).toEqual(observation);
  await f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'New successful operation');
  expect(() => selected.readObservation()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.composition.captureOperationObservation().readObservation()).toEqual({
    scope: 'currentOperation', status: 'unavailable',
  });
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it('allows a fresh observation after admission closure but never after composition disposal', async test => {
  const f = await fixture(test);
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, selectorRegistry.workspaces[0]!.workspaceLabel))
    .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' });
  const old = f.composition.captureOperationObservation();
  f.composition.service.closeAdmission();
  expect(() => old.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  const fresh = f.composition.captureOperationObservation();
  expect(fresh.readObservation()).toMatchObject({ status: 'available' });
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Forbidden')).rejects.toMatchObject({
    code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
  });
  f.composition.dispose();
  expect(() => fresh.readObservation()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(() => f.composition.captureOperationObservation()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
});

it('retains both safe import roles across its own admission closure before failing logger writes', async test => {
  const f = await fixture(test);
  const failure = new WorkspaceBackupImportError('WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation', {
    cause: new AggregateError([new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED'), new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED')]),
  });
  vi.spyOn(WorkspaceBackupImportCoordinator.prototype, 'import').mockImplementation(async () => {
    f.composition.service.closeAdmission();
    throw failure;
  });
  f.log.mockImplementation(() => { throw new Error('SYNTHETIC_LOGGING_FAILURE'); });
  await expect(f.composition.service.importBackupAsNew({ workspaceLabel: 'Synthetic', password: 'synthetic',
    containerPath: join(f.root, 'synthetic.ekybackup') })).rejects.toMatchObject({
    code: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED', cause: failure,
  });
  const selected = f.composition.captureOperationObservation();
  const observation = selected.readObservation();
  expect(observation).toMatchObject({ status: 'available',
    firstError: { eventName: 'workspaceBackup.operationFailed', errorCode: 'PROFILE_INSPECTION_LIMIT_EXCEEDED' },
    cleanupError: { eventName: 'workspaceBackup.cleanupFailed', errorCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' },
  });
  const validated = readSupportBundleDesktopData({ observation,
    system: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), electronVersion: '43.8.1', platform: 'win32', architecture: 'x64' },
    availability: { backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
  });
  expect(validated.observation).toEqual(observation);
  expect(f.log).toHaveBeenCalledTimes(2);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
  const support = createSelectorSupportExport(f, test);
  await expect(support.create()).resolves.toBe('created');
  const inspector = await import(new URL('../../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
  const inspected = inspector.inspectSupportBundle(support.targetPath);
  expect(inspected.summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly', observationStatus: 'available',
    backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' });
  expect(inspected.document.observation).toEqual(observation);
  expect(support.loadDesktopData).toHaveBeenCalledOnce();
  expect(support.writeArchive).toHaveBeenCalledOnce();
  expect(utilityProcess.fork).not.toHaveBeenCalled();
  await f.composition.shutdown();
  expect(() => selected.readObservation()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
});

it.for(['confirmation', 'target'] as const)(
  'binds the real settled selector generation before the %s dialog', async (heldAt, test) => {
    const f = await fixture(test);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const hold = async () => { enter(); await pending; };
    const support = createSelectorSupportExport(f, test, {
      async confirmCreation() { if (heldAt === 'confirmation') await hold(); return true; },
      async selectTargetPath() { if (heldAt === 'target') await hold(); return join(f.root, 'support.json.gz'); },
    });
    const first = support.create().catch((cause: unknown) => cause);
    try {
      await entered;
      test.signal.throwIfAborted();
      await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, selectorRegistry.workspaces[0]!.workspaceLabel))
        .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' });
      expect((await f.composition.service.getStatus()).operationState).toBe('idle');
      release();
      expect(await first).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
      expect(support.loadDesktopData).not.toHaveBeenCalled();
      expect(support.writeArchive).not.toHaveBeenCalled();
      expect(support.showSafeError).not.toHaveBeenCalled();
      expect(existsSync(support.targetPath)).toBe(false);
      await expect(support.create()).resolves.toBe('created');
      const inspector = await import(new URL('../../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
      expect(inspector.inspectSupportBundle(support.targetPath).document.observation)
        .toEqual(f.composition.captureOperationObservation().readObservation());
      expect(support.loadDesktopData).toHaveBeenCalledOnce();
      expect(support.writeArchive).toHaveBeenCalledOnce();
      expect(utilityProcess.fork).not.toHaveBeenCalled();
      expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(selectorRegistry)));
    } finally { release(); await first; support.capability.dispose(); }
  },
);

it('rejects foreign and late projected events without replacing the first current failure', async test => {
  const createObserver = backupObserver.createWorkspaceBackupOperationalObserver;
  let receive: Parameters<typeof createObserver>[0]['observeProjectedEvent'];
  vi.spyOn(backupObserver, 'createWorkspaceBackupOperationalObserver').mockImplementation(options => {
    receive = options.observeProjectedEvent;
    return createObserver({ ...options, observeProjectedEvent(event) {
      if (event.eventName !== 'workspaceManagement.operationFailed') return;
      receive!({ ...event, correlationId: '11111111-1111-4111-8111-111111111111' });
      receive!({ ...event, runtimeInstanceId: '11111111-1111-4111-8111-111111111111' });
      receive!({ ...event, operationId: 'workspace.create' });
      receive!({ ...event, appVersion: '0.1.0' });
      receive!({ ...event, buildRevision: 'b'.repeat(40) });
      receive!(event);
    } });
  });
  const f = await fixture(test);
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, selectorRegistry.workspaces[0]!.workspaceLabel))
    .rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' });
  const selected = f.composition.captureOperationObservation();
  const first = selected.readObservation();
  expect(first).toMatchObject({ status: 'available', firstError: { errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' } });
  if (first.status !== 'available') throw new Error('MISSING_CURRENT_OBSERVATION');
  expect(first.firstError).toBe(f.log.mock.calls[0]![0]);
  receive!(f.log.mock.calls[0]![0]);
  expect(selected.readObservation()).toEqual(first);
  expect(f.log).toHaveBeenCalledOnce();
});

it('rejects a matching late cleanup event while the current cleanup role is still empty', async test => {
  const createObserver = backupObserver.createWorkspaceBackupOperationalObserver;
  let receive: Parameters<typeof createObserver>[0]['observeProjectedEvent'];
  vi.spyOn(backupObserver, 'createWorkspaceBackupOperationalObserver').mockImplementation(options => {
    receive = options.observeProjectedEvent;
    return createObserver(options);
  });
  const f = await fixture(test);
  vi.spyOn(WorkspaceBackupImportCoordinator.prototype, 'import').mockRejectedValueOnce(
    new WorkspaceBackupImportError('WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation', {
      cause: new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED'),
    }),
  );
  await expect(f.composition.service.importBackupAsNew({ workspaceLabel: 'Synthetic', password: 'synthetic',
    containerPath: join(f.root, 'synthetic.ekybackup') })).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED' });
  const selected = f.composition.captureOperationObservation();
  const observation = selected.readObservation();
  if (observation.status !== 'available' || observation.firstError === null) throw new Error('MISSING_CURRENT_OBSERVATION');
  expect(observation.cleanupError).toBeNull();
  const first = observation.firstError;
  receive!(createDesktopOperationalEvent({ eventName: 'workspaceBackup.cleanupFailed',
    correlationId: first.correlationId, durationMs: 1, errorCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
    retryable: false, sideEffectState: 'unknown', stage: 'import',
  }, { appVersion: first.appVersion, buildRevision: first.buildRevision, runtimeInstanceId: first.runtimeInstanceId }));
  expect(selected.readObservation()).toEqual(observation);
});

it.for([false, true])('ignores an ineligible delete cleanup projection without blocking genuine cleanup (present: %s)', async (includeCleanup, test) => {
  const createObserver = backupObserver.createWorkspaceBackupOperationalObserver;
  let receive: Parameters<typeof createObserver>[0]['observeProjectedEvent'];
  let actualDeleteFailure: { correlationId: string; operationId: string } | undefined;
  let genuineCleanup: ReturnType<typeof createDesktopOperationalEvent> | undefined;
  const projected: ReturnType<typeof createDesktopOperationalEvent>[] = [];
  vi.spyOn(backupObserver, 'createWorkspaceBackupOperationalObserver').mockImplementation(options => {
    receive = options.observeProjectedEvent;
    return createObserver({ ...options, observeProjectedEvent(event) {
      if (event.eventName !== 'workspaceManagement.operationFailed' || event.operationId !== 'workspace.delete') {
        receive!(event); return;
      }
      actualDeleteFailure = event;
      const fields = { eventName: 'workspaceManagement.operationFailed', correlationId: event.correlationId,
        durationMs: 1, retryable: false, sideEffectState: 'unknown', stage: 'deleteCleanup', operationId: 'workspace.delete' } as const;
      const identity = { appVersion: event.appVersion, buildRevision: event.buildRevision, runtimeInstanceId: event.runtimeInstanceId };
      const ineligible = createDesktopOperationalEvent({ ...fields, errorCode: 'WORKSPACE_DELETE_FAILED' }, identity);
      genuineCleanup = createDesktopOperationalEvent({ ...fields, errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED' }, identity);
      projected.push(ineligible); receive!(ineligible);
      if (includeCleanup) { projected.push(genuineCleanup); receive!(genuineCleanup); }
    } });
  });
  const f = await fixture(test);
  // Enter the real delete operation without enabling destructive preparation; only projections are controlled.
  await expect(f.composition.service.prepareDeletion({ formatVersion: 1, workspaceId: TEST_TARGET_WORKSPACE_ID,
    typedLabel: selectorRegistry.workspaces[1]!.workspaceLabel, backupChoice: 'explicitDataLoss' }, {
    assertCurrent() { if (!f.state.current) throw new Error('SELECTOR_EXPIRED'); }, closeAdmissionForOwnStop() {},
  })).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
  expect(actualDeleteFailure).toMatchObject({ operationId: 'workspace.delete', correlationId: expect.any(String) });
  expect(f.log).toHaveBeenCalledOnce(); expect(f.log.mock.calls[0]![0]).toBe(actualDeleteFailure);
  expect(projected).toHaveLength(includeCleanup ? 2 : 1);
  expect(genuineCleanup).toMatchObject({ operationId: 'workspace.delete', correlationId: actualDeleteFailure!.correlationId });
  const selected = f.composition.captureOperationObservation();
  const observation = selected.readObservation();
  if (includeCleanup) {
    expect(observation).toEqual({ scope: 'currentOperation', status: 'available', firstError: null, cleanupError: genuineCleanup });
    if (observation.status !== 'available') throw new Error('MISSING_CURRENT_OBSERVATION');
    expect(observation.cleanupError).toBe(genuineCleanup);
  } else {
    expect(observation).toEqual({ scope: 'currentOperation', status: 'unavailable' });
  }
  const validated = readSupportBundleDesktopData({ observation,
    system: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), electronVersion: '43.8.1', platform: 'win32', architecture: 'x64' },
    availability: { backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
  });
  expect(validated.observation).toEqual(observation);
  receive!(genuineCleanup!); expect(selected.readObservation()).toEqual(observation);
  expect(f.lease.readState()).toBe('idle'); expect(utilityProcess.fork).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(selectorRegistry)));
});

it.for(['ready', 'empty', 'recoveryOnly'] as const)(
  'reads %s selector status without creating a runtime or active context', async (kind, test) => {
    const registry = kind === 'empty' ? { ...selectorRegistry, workspaces: [] }
      : kind === 'recoveryOnly' ? { ...selectorRegistry, workspaces: selectorRegistry.workspaces.map(
        entry => ({ ...entry, lifecycleState: 'recoveryRequired' as const }),
      ) } : selectorRegistry;
    const f = await fixture(test, registry);
    const legacyRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
    const status = await f.composition.service.getStatus();
    expect(status.activeWorkspaceId).toBeNull();
    expect(status.operationState).toBe('idle');
    expect(status.workspaces).toHaveLength(registry.workspaces.length);
    expect(status.workspaces.every(entry => !entry.isActive)).toBe(true);
    expect(status.workspaces.every(entry => entry.availability ===
      (kind === 'recoveryOnly' ? 'recoveryRequired' : 'ready'))).toBe(true);
    expect(f.composition).not.toHaveProperty('readActiveWorkspaceLabel');
    expect(legacyRead).not.toHaveBeenCalled();
    expect(f.bindCandidate).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
    expect(utilityProcess.fork).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toContain('lineage');
    expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(registry)));
  },
);

it('renames through the existing command and keeps null selection and name uniqueness', async test => {
  const f = await fixture(test);
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Renamed workspace')).resolves.toMatchObject({ changed: true });
  const current = await f.registry.inspect();
  expect(current).toMatchObject({ formatVersion: 2, activeWorkspaceId: null });
  expect(current?.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)?.workspaceLabel).toBe('Renamed workspace');
  const write = vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected');
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Renamed workspace')).resolves.toMatchObject({ changed: false });
  expect(write).not.toHaveBeenCalled();
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, selectorRegistry.workspaces[0]!.workspaceLabel))
    .rejects.toThrow();
  expect(await f.registry.inspect()).toEqual(current);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
});

it('does not turn overlapping status and command admission into false recovery', async test => {
  const f = await fixture(test);
  const sentinel = new Error('controlled admitted command');
  const create = vi.spyOn(EmptyWorkspaceCreationCoordinator.prototype, 'create').mockRejectedValue(sentinel);
  const inspect = WorkspaceRegistryStore.prototype.inspectSlots;
  let started = false;
  let command: Promise<unknown> | undefined;
  vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots').mockImplementation(function (this: WorkspaceRegistryStore) {
    const reading = inspect.call(this);
    if (!started) {
      started = true;
      // The real store has entered its exclusive read, before the async I/O settles.
      command = f.composition.service.createEmpty('Concurrent command').then(
        () => undefined, error => error,
      );
    }
    return reading;
  });
  await f.composition.service.getStatus();
  expect(started).toBe(true);
  expect(await command).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_CREATE_FAILED', cause: sentinel });
  expect(create).toHaveBeenCalledExactlyOnceWith('Concurrent command');
});

it('rejects selector expiry during the admitted rename read without changing registry bytes', async test => {
  const f = await fixture(test);
  const before = await readFile(f.registryPath);
  let armed = false;
  let expired = false;
  const guard = MainOwnedWorkspaceManagementOperationGuard.prototype.assertNoUnresolvedOperations;
  vi.spyOn(MainOwnedWorkspaceManagementOperationGuard.prototype, 'assertNoUnresolvedOperations').mockImplementation(async function (this: MainOwnedWorkspaceManagementOperationGuard) {
    await guard.call(this);
    if (f.lease.readState() === 'busy') armed = true;
  });
  const expire = () => {
    if (armed && !expired) { expired = true; f.state.current = false; }
  };
  const read = WorkspaceRegistryStore.prototype.read;
  const inspect = WorkspaceRegistryStore.prototype.inspectSlots;
  vi.spyOn(WorkspaceRegistryStore.prototype, 'read').mockImplementation(async function (this: WorkspaceRegistryStore) {
    const value = await read.call(this); expire(); return value;
  });
  vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots').mockImplementation(async function (this: WorkspaceRegistryStore) {
    const value = await inspect.call(this); expire(); return value;
  });
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not publish')).rejects.toThrow();
  expect(expired).toBe(true);
  expect(await readFile(f.registryPath)).toEqual(before);
  expect(f.lease.readState()).toBe('idle');
});

it('rejects selector expiry inside the rename writer and preserves the original registry', async test => {
  let expire = () => {};
  const original = registryFileSystem.createNodeWorkspaceRegistryFileSystem;
  vi.spyOn(registryFileSystem, 'createNodeWorkspaceRegistryFileSystem').mockImplementation(paths => {
    const fileSystem = original(paths);
    const createNextWriter = fileSystem.createNextWriter.bind(fileSystem);
    vi.spyOn(fileSystem, 'createNextWriter').mockImplementation(async guard => {
      const writer = await createNextWriter(guard);
      const sync = writer.sync.bind(writer);
      vi.spyOn(writer, 'sync').mockImplementation(async () => { await sync(); expire(); });
      return writer;
    });
    return fileSystem;
  });
  const f = await fixture(test);
  const before = await readFile(f.registryPath);
  let expired = false;
  expire = () => { expired = true; f.state.current = false; };
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not publish')).rejects.toThrow();
  expect(expired).toBe(true);
  expect(await readFile(f.registryPath)).toEqual(before);
  expect(await readFile(f.registryPath + '.next', 'utf8')).toContain('Must not publish');
  expect(f.lease.readState()).toBe('idle');
});

it.for(['bytes', 'identity'] as const)('rejects replaced registry %s at the rename publication boundary', async (kind, test) => {
  const f = await fixture(test);
  const before = await readFile(f.registryPath);
  const selectedWrite = WorkspaceRegistryStore.prototype.writeSelected;
  let replacement: Buffer | undefined;
  vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected').mockImplementation(async function (this: WorkspaceRegistryStore, value, selection) {
    if (kind === 'identity') {
      await rename(f.registryPath, f.registryPath + '.preserved');
      replacement = before;
    } else replacement = Buffer.from(serializeWorkspaceRegistry({ ...selectorRegistry,
      workspaces: selectorRegistry.workspaces.map(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID
        ? { ...entry, workspaceLabel: 'External change' } : entry),
    }));
    await writeFile(f.registryPath, replacement);
    return selectedWrite.call(this, value, selection);
  });
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not overwrite')).rejects.toThrow();
  expect(replacement).toBeDefined();
  expect(await readFile(f.registryPath)).toEqual(replacement);
  expect(f.lease.readState()).toBe('idle');
});

it('does not adopt or release a successor rename lease before publication', async test => {
  const f = await fixture(test);
  const acquire = f.lease.acquire.bind(f.lease);
  let current: Awaited<ReturnType<typeof acquire>> | undefined;
  let successor: Awaited<ReturnType<typeof acquire>> | undefined;
  vi.spyOn(f.lease, 'acquire').mockImplementation(async purpose => {
    current = await acquire(purpose); return current;
  });
  const selectedWrite = WorkspaceRegistryStore.prototype.writeSelected;
  vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected').mockImplementation(async function (this: WorkspaceRegistryStore, value, selection) {
    await current!.release();
    successor = await acquire('rename');
    return selectedWrite.call(this, value, selection);
  });
  try {
    await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not publish')).rejects.toThrow();
    expect(successor).toBeDefined();
    expect(f.lease.readState()).toBe('busy');
    expect(await f.registry.inspect()).toEqual(selectorRegistry);
  } finally { await successor?.release(); }
});

it('does not retry or roll back a rename after the selected writer loses its acknowledgement', async test => {
  const f = await fixture(test);
  const selectedWrite = WorkspaceRegistryStore.prototype.writeSelected;
  const failure = new Error('synthetic lost rename reply');
  const write = vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected').mockImplementation(async function (this: WorkspaceRegistryStore, value, selection) {
    await selectedWrite.call(this, value, selection);
    throw failure;
  });
  await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Durable name')).rejects.toMatchObject({
    code: 'WORKSPACE_MANAGEMENT_RENAME_FAILED', cause: failure,
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect((await f.registry.inspect())?.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)?.workspaceLabel).toBe('Durable name');
  expect(f.lease.readState()).toBe('idle');
  expect(f.launch).not.toHaveBeenCalled();
});

it('does not adopt a successor rename lease while awaiting operation admission', async test => {
  const f = await fixture(test);
  const before = await readFile(f.registryPath);
  const acquire = f.lease.acquire.bind(f.lease);
  let current: Awaited<ReturnType<typeof acquire>> | undefined;
  let successor: Awaited<ReturnType<typeof acquire>> | undefined;
  vi.spyOn(f.lease, 'acquire').mockImplementation(async purpose => {
    current = await acquire(purpose); return current;
  });
  const guard = MainOwnedWorkspaceManagementOperationGuard.prototype.assertNoUnresolvedOperations;
  vi.spyOn(MainOwnedWorkspaceManagementOperationGuard.prototype, 'assertNoUnresolvedOperations')
    .mockImplementation(async function (this: MainOwnedWorkspaceManagementOperationGuard) {
      await guard.call(this);
      if (current !== undefined && successor === undefined) {
        await current.release();
        successor = await acquire('rename');
      }
    });
  const write = vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected');
  try {
    await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not publish')).rejects.toThrow();
    expect(successor).toBeDefined();
    expect(f.lease.readState()).toBe('busy');
    expect(write).not.toHaveBeenCalled();
    expect(await readFile(f.registryPath)).toEqual(before);
  } finally { await successor?.release(); }
});

it.for(['authority', 'bytes', 'identity'] as const)(
  'rejects changed %s during a no-op rename readback', async (kind, test) => {
    const f = await fixture(test);
    const before = await readFile(f.registryPath);
    let expected = before;
    let admitted = false;
    let reads = 0;
    const guard = MainOwnedWorkspaceManagementOperationGuard.prototype.assertNoUnresolvedOperations;
    vi.spyOn(MainOwnedWorkspaceManagementOperationGuard.prototype, 'assertNoUnresolvedOperations')
      .mockImplementation(async function (this: MainOwnedWorkspaceManagementOperationGuard) {
        await guard.call(this);
        if (f.lease.readState() === 'busy') admitted = true;
      });
    const inspect = WorkspaceRegistryStore.prototype.inspectSlots;
    vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots')
      .mockImplementation(async function (this: WorkspaceRegistryStore) {
        if (admitted && ++reads === 2) {
          if (kind === 'authority') f.state.current = false;
          else {
            if (kind === 'identity') await rename(f.registryPath, f.registryPath + '.preserved');
            else expected = Buffer.from(serializeWorkspaceRegistry({
              ...selectorRegistry, activeWorkspaceId: TEST_TARGET_WORKSPACE_ID,
            }));
            await writeFile(f.registryPath, expected);
          }
        }
        return inspect.call(this);
      });
    const write = vi.spyOn(WorkspaceRegistryStore.prototype, 'writeSelected');
    const label = selectorRegistry.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!.workspaceLabel;
    await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, label)).rejects.toThrow();
    expect(reads).toBe(2);
    expect(write).not.toHaveBeenCalled();
    expect(await readFile(f.registryPath)).toEqual(expected);
    expect(f.lease.readState()).toBe('idle');
  },
);

it('uses the source-null switch command and releases the lease before relaunch', async test => {
  const f = await fixture(test);
  await f.composition.service.switchTo(TEST_TARGET_WORKSPACE_ID);
  expect(await f.registry.inspect()).toMatchObject({ formatVersion: 2, activeWorkspaceId: TEST_TARGET_WORKSPACE_ID });
  expect((await new WorkspaceSwitchJournalStore(f.root).inspectSlots()).current?.value).toMatchObject({
    formatVersion: 2, sourceWorkspaceId: null, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, state: 'targetSelected',
  });
  expect(f.assertOwned).toHaveBeenCalled();
  expect(f.launch).toHaveBeenCalledExactlyOnceWith();
  expect(f.lease.readState()).toBe('idle');
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it('does not offer active replacement without an active workspace', async test => {
  const f = await fixture(test);
  const replace = vi.spyOn(WorkspaceBackupReplacementCoordinator.prototype, 'replace');
  const before = await readFile(f.registryPath);
  await expect(f.composition.service.replaceActiveFromBackup({
    containerPath: join(f.root, 'synthetic.ekybackup'), password: 'synthetic password', targetWorkspaceId: TEST_TARGET_WORKSPACE_ID,
  })).rejects.toThrow('WORKSPACE_MANAGEMENT_INVALID');
  expect(replace).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(before);
  expect(f.log).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'workspaceManagement.operationFailed' }));
  expect(JSON.stringify(f.log.mock.calls)).not.toContain('synthetic password');
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.root);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it('routes create and import to their existing commands without an active replacement path', async test => {
  const f = await fixture(test);
  const failure = new Error('controlled command boundary');
  const create = vi.spyOn(EmptyWorkspaceCreationCoordinator.prototype, 'create').mockRejectedValue(failure);
  const importBackup = vi.spyOn(WorkspaceBackupImportCoordinator.prototype, 'import').mockRejectedValue(failure);
  await expect(f.composition.service.createEmpty('Synthetic company')).rejects.toThrow();
  const input = { containerPath: join(f.root, 'synthetic.ekybackup'), password: 'synthetic password', workspaceLabel: 'Imported' };
  await expect(f.composition.service.importBackupAsNew(input)).rejects.toThrow();
  expect(create).toHaveBeenCalledExactlyOnceWith('Synthetic company');
  expect(importBackup).toHaveBeenCalledExactlyOnceWith(input);
  expect(await f.registry.inspect()).toEqual(selectorRegistry);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it('keeps the captured import alive through its own capability disposal and launches after release', async test => {
  const f = await importFixture(test);
  const stop = f.lifecycle.stopAndProveHandlesClosed.bind(f.lifecycle);
  vi.spyOn(f.lifecycle, 'stopAndProveHandlesClosed').mockImplementation(async previous => {
    const result = await stop(previous); f.composition.dispose(); return result;
  });
  await expect(f.composition.service.importBackupAsNew(f.input)).resolves.toHaveProperty('workspaceId');
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
  expect((await f.registry.inspect())?.workspaces).toHaveLength(1);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it('joins started import work during shutdown and retains its real evidence without relaunch', async test => {
  const f = await importFixture(test);
  const entered = importBindingGate(); const finish = importBindingGate();
  vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'stage').mockImplementation(async value => {
    await mkdir(value.importStagingRoot); entered.resolve(); await finish.promise; return createTestImportPreflight();
  });
  const pending = f.composition.service.importBackupAsNew(f.input).then(() => undefined, error => error as unknown);
  let stopped = false;
  let shutdown: Promise<void> | undefined;
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error('IMPORT_STAGE_NOT_ENTERED'); })]);
    shutdown = f.composition.shutdown().then(() => { stopped = true; });
    await expect(f.composition.service.getStatus()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(stopped).toBe(false); expect(f.lease.readState()).toBe('busy');
  } finally { finish.resolve(); await pending; await shutdown; }
  expect(stopped).toBe(true);
  expect(await pending).toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
    cause: { errors: [{ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' }, expect.any(Error)] } });
  expect((await readFile(join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME))).byteLength).toBeGreaterThan(0);
  expect(f.launch).not.toHaveBeenCalled();
  expect((await f.registry.inspect())?.workspaces).toHaveLength(0);
  expect(f.lease.readState()).toBe('idle');
});

it('keeps a late import-return failure sticky after the released lease and terminal callback', async test => {
  const f = await importFixture(test);
  const run = WorkspaceBackupImportCoordinator.prototype.import;
  vi.spyOn(WorkspaceBackupImportCoordinator.prototype, 'import').mockImplementation(async function (this: WorkspaceBackupImportCoordinator, value) {
    const result = await run.call(this, value); f.state.current = false; return result;
  });
  await expect(f.composition.service.importBackupAsNew(f.input)).rejects.toThrow();
  expect(f.launch).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
  expect((await f.registry.inspect())?.workspaces).toHaveLength(1);
  f.state.current = true;
  await expect(f.composition.service.getStatus()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.launch).not.toHaveBeenCalled();
});

it.for(['adoption', 'creation', 'import', 'switch', 'firstStart', 'legacyProfile', 'profile', 'replacement',
  'directSetup', 'update', 'legacyUpdate'] as const)(
  'preserves an unresolved %s slot and blocks management changes', async (owner, test) => {
    const f = await fixture(test);
    const path = f.pendingPaths[owner];
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'opaque unresolved evidence');
    const registryBefore = await readFile(f.registryPath);
    await expect(f.composition.service.getStatus()).resolves.toMatchObject({ operationState: 'recoveryRequired' });
    await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Must not publish'))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readFile(path, 'utf8')).toBe('opaque unresolved evidence');
    expect(await readFile(f.registryPath)).toEqual(registryBefore);
    expect(f.assertOwned).not.toHaveBeenCalled();
    expect(utilityProcess.fork).not.toHaveBeenCalled();
  },
);

it.for(['next', 'backup', 'selected', 'legacy', 'missing'] as const)(
  'rejects %s registry admission without repairing the registry', async (kind, test) => {
    const f = await fixture(test);
    const create = vi.spyOn(EmptyWorkspaceCreationCoordinator.prototype, 'create');
    const legacyRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
    if (kind === 'missing') await rm(f.registryPath);
    else if (kind === 'legacy') await writeFile(f.registryPath, serializeWorkspaceRegistry(createSwitchRegistry()));
    else if (kind === 'selected') await writeFile(f.registryPath, serializeWorkspaceRegistry({
      ...selectorRegistry, activeWorkspaceId: TEST_TARGET_WORKSPACE_ID,
    }));
    else await writeFile(f.registryPath + '.' + kind, serializeWorkspaceRegistry(selectorRegistry));
    await expect(f.composition.service.createEmpty('Blocked')).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(create).not.toHaveBeenCalled();
    expect(legacyRead).not.toHaveBeenCalled();
    expect(utilityProcess.fork).not.toHaveBeenCalled();
  },
);

it.for(['generation', 'bytes', 'identity'] as const)(
  'rejects %s changes while reading unresolved-operation slots', async (kind, test) => {
    const f = await fixture(test);
    const original = readOnlySlots.hasTerminalJournalConflict;
    let changed = false;
    vi.spyOn(readOnlySlots, 'hasTerminalJournalConflict').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!changed) {
        changed = true;
        if (kind === 'generation') f.state.current = false;
        else if (kind === 'bytes') await writeFile(f.registryPath, serializeWorkspaceRegistry({
          ...selectorRegistry, activeWorkspaceId: TEST_TARGET_WORKSPACE_ID,
        }));
        else {
          const bytes = await readFile(f.registryPath);
          await rename(f.registryPath, f.registryPath + '.preserved');
          await writeFile(f.registryPath, bytes);
        }
      }
      return result;
    });
    const create = vi.spyOn(EmptyWorkspaceCreationCoordinator.prototype, 'create');
    await expect(f.composition.service.createEmpty('Blocked')).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(changed).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(utilityProcess.fork).not.toHaveBeenCalled();
  },
);

it('closes admission immediately and waits for a started selector slot read', async test => {
  const f = await fixture(test);
  const original = readOnlySlots.hasTerminalJournalConflict;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(readOnlySlots, 'hasTerminalJournalConflict').mockImplementation(async (...args) => {
    enter();
    await pending;
    return original(...args);
  });
  const status = f.composition.service.getStatus();
  const failedStatus = expect(status).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  await entered;
  let settled = false;
  const shutdown = f.composition.shutdown().then(() => { settled = true; });
  try {
    await expect(f.composition.service.getStatus()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    await expect(f.composition.service.rename(TEST_TARGET_WORKSPACE_ID, 'Blocked')).rejects.toThrow();
    expect(settled).toBe(false);
  } finally {
    release();
    await failedStatus;
    await shutdown;
  }
  expect(settled).toBe(true);
  expect(await f.registry.inspect()).toEqual(selectorRegistry);
});

function createSelectorSupportExport(f: Awaited<ReturnType<typeof fixture>>, test: TestContext,
  dialogs: Partial<Pick<Parameters<typeof createDesktopOnlySupportBundleCapability>[0], 'confirmCreation' | 'selectTargetPath'>> = {},
) {
  const targetPath = join(f.root, 'support.json.gz');
  mkdirSync(join(f.root, 'runtime'), { recursive: true, mode: 0o700 });
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: {} });
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents });
  let invoke!: (event: unknown) => Promise<unknown>;
  let firstFailure: { error: unknown } | undefined;
  test.onTestFailed(async () => {
    const observed = firstFailure;
    if (observed === undefined) return;
    try {
      const { createRunnerFailureSink } = await import('../../../../../test-reporters/runnerFailureEvidence.mjs');
      const sink = createRunnerFailureSink();
      const task = test.task;
      const retryCount = task.result?.retryCount ?? 0;
      const repeatCount = task.result?.repeatCount ?? 0;
      sink.record({ runner: 'vitest', phase: 'supportBundleCreationCatch', error: observed.error,
        testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
        ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
      await sink.flush();
    } catch { /* Evidence must not replace the original test failure. */ }
  });
  const loadDesktopData = vi.fn((readObservation: () => unknown) => readSupportBundleDesktopData({
    system: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), electronVersion: '43.8.1', platform: 'win32', architecture: 'x64' },
    availability: { backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
    observation: readObservation(),
  }));
  const writeArchive = vi.fn(writeSupportBundleAtomically);
  const showSafeError = vi.fn();
  const capability = createDesktopOnlySupportBundleCapability({
    ipcMain: { handle(_channel, handler) { invoke = handler as never; }, removeHandler: vi.fn() }, mainWindow: mainWindow as never,
    assertCurrent() { if (!f.state.current) throw new Error('SELECTOR_EXPIRED'); },
    captureRequest() {
      const selected = f.composition.captureOperationObservation();
      return { assertCurrent: selected.assertCurrent, loadDesktopData: () => loadDesktopData(selected.readObservation) };
    },
    confirmCreation: dialogs.confirmCreation ?? (async () => true),
    selectTargetPath: dialogs.selectTargetPath ?? (async () => targetPath),
    runtimeRoot: join(f.root, 'runtime'), writeArchive, showSafeError,
    observeFailure(error) { firstFailure ??= { error }; },
    operationalIdentity: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), runtimeInstanceId: '99999999-9999-4999-8999-999999999999' },
    operationalLogger: { write: f.log },
  });
  test.onTestFinished(() => capability.dispose());
  return { capability, targetPath, loadDesktopData, writeArchive, showSafeError,
    create() { firstFailure = undefined; return invoke({ sender: webContents, senderFrame: webContents.mainFrame }); } };
}

async function fixture(test: TestContext, value = selectorRegistry) {
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-composition-'));
  let composition: Awaited<ReturnType<typeof createWorkspaceManagementComposition>> | undefined;
  test.onTestFinished(async () => {
    await composition?.shutdown();
    vi.restoreAllMocks();
    vi.mocked(utilityProcess.fork).mockClear();
    if (test.task.result?.state === 'pass') await rm(root, { force: true, recursive: true });
  });
  const resources = join(root, 'resources');
  await mkdir(join(resources, 'backend', 'dist', 'database', 'migrations'), { recursive: true });
  await mkdir(join(resources, 'desktop-runtime', 'runtime'), { recursive: true });
  await writeFile(join(resources, 'desktop-runtime', 'runtime', 'workspaceCandidateRunner.js'), '// Synthetic path fixture; never executed.');
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  await writeFile(registryPath, serializeWorkspaceRegistry(value));
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const state = { current: true };
  const assertCurrent = () => { if (!state.current) throw new Error('SELECTOR_EXPIRED'); };
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const launch = vi.fn(() => { expect(lease.readState()).toBe('idle'); });
  const relaunch = new DeferredWorkspaceRuntimeRelaunch(launch);
  const assertOwned = vi.fn(async () => assertCurrent());
  const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ assertSelectorCurrent: assertCurrent,
    reservation: { assertMainCurrent: assertCurrent, assertMainOwned: assertOwned }, maintenanceLease: lease, runtimeRelaunch: relaunch });
  const log = vi.fn();
  const bindCandidate = vi.fn(() => { throw new Error('UNEXPECTED_CANDIDATE_RUNTIME'); });
  const legacyRuntimeRoot = createDesktopProfilePaths(root).runtimeRoot;
  const update = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot });
  composition = await createWorkspaceManagementComposition({ mode: 'selector', assertCurrent,
    importOwner: { assertCurrent, assertMainCurrent: assertCurrent, assertMainOwned: assertOwned,
      invalidate() { state.current = false; } },
    activeWorkspaceLifecycle: lifecycle, appVersion: '0.3.0', buildRevision: 'a'.repeat(40),
    localUpdateRuntimePaths: update, maintenanceLease: lease, operationalLogger: { write: log },
    operationalIdentity: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), runtimeInstanceId: '99999999-9999-4999-8999-999999999999' },
    reservationOwner: { assertMainOwned: assertOwned, bindCandidate }, resourcesPath: resources,
    runtimeRelaunch: relaunch, userDataRoot: root });
  const profileRuntimeRoot = createDesktopProfilePaths(deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1).workspaceRoot).runtimeRoot;
  return { root, registryPath, registry, composition, lease, launch, assertOwned, log, bindCandidate, state, lifecycle,
    pendingPaths: {
      adoption: createWorkspaceLegacyAdoptionJournalPaths(root).backupPath,
      creation: join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME) + '.next',
      import: join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) + '.backup',
      switch: createWorkspaceSwitchJournalPaths(root).currentPath,
      firstStart: createWorkspaceFirstStartMigrationJournalPaths(root).nextPath,
      legacyProfile: createProfileSnapshotRuntimePaths(legacyRuntimeRoot).restoreActivationJournalPath,
      profile: createProfileSnapshotRuntimePaths(profileRuntimeRoot).restoreActivationJournalPath,
      replacement: deriveWorkspaceBackupReplacementRuntimePaths(root, TEST_TARGET_WORKSPACE_ID).activationJournalPath,
      directSetup: update.directSetupMigrationRecoveryPath,
      update: update.journalPath,
      legacyUpdate: update.legacyJournalPath,
    },
  };
}

async function importFixture(test: TestContext) {
  const f = await fixture(test, { ...selectorRegistry, workspaces: [] });
  vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'inspect').mockResolvedValue(createTestImportPreflight());
  vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'stage').mockImplementation(async value => {
    await mkdir(value.importStagingRoot, { mode: 0o700 }); return createTestImportPreflight();
  });
  vi.spyOn(PrivateWorkspaceBackupCandidateAdapter.prototype, 'migrate').mockImplementation(async value => {
    await writeFile(value.databaseFilePath, 'synthetic database bytes', { flag: 'wx' });
    return { handlesClosed: true, profileId: createTestImportPreflight().profileId,
      migrationChainIdentity: createTestImportReadiness().migrationChainIdentity };
  });
  vi.spyOn(PrivateWorkspaceBackupCandidateAdapter.prototype, 'validateAndMaterialize').mockResolvedValue(createTestImportReadiness());
  return { ...f, input: { workspaceLabel: 'Imported synthetic', password: 'synthetic password', containerPath: join(f.root, 'synthetic.ekybackup') } };
}
