import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { utilityProcess } from 'electron';
import { expect, it, vi, type TestContext } from 'vitest';

import { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceBackupContainerAdapter } from '../import/workspaceBackupContainerAdapter.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { NodeWorkspaceBackupReplacementRootStore } from '../replacement/workspaceBackupReplacementRootStore.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceManagementComposition, type WorkspaceDeletionPreparationCompositionOptions,
  type WorkspaceManagementComposition } from './workspaceManagementComposition.js';
import { MainOwnedWorkspaceManagementOperationGuard } from './mainOwnedWorkspaceManagementOperationGuard.js';
import { WorkspaceDeletionInventoryStore } from '../deletion/workspaceDeletionInventoryStore.js';
import { WorkspaceDeletionJournalStore } from '../deletion/workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionPublisher } from '../deletion/workspaceDeletionPublication.js';
import type { WorkspaceManagementServiceOptions } from './workspaceManagementService.js';
import { createWorkspaceDeletionCommand } from '../deletion/workspaceDeletionCommand.js';
import * as originalJournalSelectionFactory from '../deletion/workspaceDeletionOriginalJournalSelection.js';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));
const generation = '99999999-9999-4999-8999-999999999999';

it.for(['active', 'selector'] as const)('composes the real %s preparation without deleting or selecting another company', async (mode, test) => {
  const f = await fixture(test, mode);
  await expect(f.start()).resolves.toBe('prepared');
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.publish.mock.calls[0]![2]).toMatchObject({ workspaceId: TEST_TARGET_WORKSPACE_ID,
    previousActiveWorkspaceId: mode === 'active' ? TEST_SOURCE_WORKSPACE_ID : null });
  expect(f.stopBackend).toHaveBeenCalledTimes(mode === 'active' ? 1 : 0);
  expect(f.backup).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  expect(f.launch).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  for (const sentinel of f.sentinels) expect(await readFile(sentinel, 'utf8')).toBe('retained');
  const [guard, selection] = f.publish.mock.calls[0]!;
  expect(guard).toThrow();
  await expect(selection()).rejects.toThrow();
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it.for(['active', 'selector'] as const)('keeps the same delete lease through the %s return callback', async (mode, test) => {
  const f = await fixture(test, mode, { cancel: true, returnChoice: true });
  await expect(f.start()).resolves.toBe('returnRequested');
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
  expect(f.publish).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
});

it.for(['active', 'selector'] as const)('rejects %s reservation loss at the final composition callback', async (mode, test) => {
  const f = await fixture(test, mode, { cancel: true, returnChoice: true, loseAtCompletion: true });
  await expect(f.start()).rejects.toMatchObject({ cause: { message: 'SYNTHETIC_RESERVATION_LOST' } });
  f.runtimeRelaunch.complete();
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  expect(f.publish).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
});

it.for(['active', 'selector'] as const)('rejects final %s request revocation independently of reservation ownership', async (mode, test) => {
  const f = await fixture(test, mode, { cancel: true, returnChoice: true, revokeAtCompletion: true });
  await expect(f.start()).rejects.toMatchObject({ cause: { message: 'SYNTHETIC_REQUEST_REVOKED' } });
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  expect(f.publish).not.toHaveBeenCalled();
});

it.for(['active', 'selector'] as const)('does not fabricate a backup for another company in %s mode', async (mode, test) => {
  const f = await fixture(test, mode);
  await expect(f.start('createBackup')).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED',
    cause: { message: 'WORKSPACE_DELETE_BACKUP_OWNER_UNAVAILABLE' } });
  expect(f.backup).not.toHaveBeenCalled();
  expect(f.stopBackend).not.toHaveBeenCalled();
  expect(f.confirmLoss).not.toHaveBeenCalled();
  expect(f.confirmDeletion).not.toHaveBeenCalled();
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
});

it.for(['active', 'selector'] as const)('rejects %s preparation before side effects without a journal consumer', async (mode, test) => {
  const f = await fixture(test, mode, { disabled: true });
  await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
  expect(f.createRuntime).not.toHaveBeenCalled();
  expect(f.confirmLoss).not.toHaveBeenCalled();
  expect(f.stopBackend).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
});

it.for(['active', 'selector'] as const)('creates a fresh %s request after an effect-free cancellation', async (mode, test) => {
  const f = await fixture(test, mode);
  f.confirmLoss.mockResolvedValueOnce(false);
  await expect(f.start()).resolves.toBe('cancelled');
  await expect(f.start()).resolves.toBe('prepared');
  expect(f.createRuntime).toHaveBeenCalledTimes(2);
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
});

it('preserves the original preparation error through the real factory', async test => {
  const f = await fixture(test, 'active');
  const first = new Error('SYNTHETIC_NATIVE_FAILURE');
  f.confirmDeletion.mockRejectedValueOnce(first);
  await expect(f.start()).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_FAILED', cause: first });
  expect(f.stopBackend).toHaveBeenCalledOnce();
  expect(f.publish).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  expect(JSON.stringify(f.log.mock.calls)).not.toContain('SYNTHETIC_NATIVE_FAILURE');
});

it.for(['active', 'selector'] as const)('hands %s publication to a fresh reader of the real journal and inventory', async (mode, test) => {
  const stopped = new Error('SYNTHETIC_DURABLE_PROOF_STOP');
  const resume = vi.fn<NonNullable<WorkspaceManagementServiceOptions['deletionContinuation']>['resume']>(async (operationId, authority) => {
    f.revokeRequest();
    const observed = await new WorkspaceDeletionJournalStore(f.root).inspect(authority.assertCurrent);
    expect(observed.plan.mode).toBe('published');
    if (observed.plan.mode !== 'published') throw new Error('MISSING_DURABLE_PUBLICATION');
    const selected = observed.plan.selected;
    expect(selected.target.operationId).toBe(operationId);
    expect(selected.backupDisposition).toBe('explicitDataLoss');
    expect(selected.previousActiveWorkspaceId).toBe(mode === 'active' ? TEST_SOURCE_WORKSPACE_ID : null);
    expect(f.lease.readState()).toBe('busy');
    await new WorkspaceDeletionInventoryStore(f.root, operationId).inspect({ target: selected.target,
      inventory: selected.inventory, inventoryFileIdentity: selected.inventoryFileIdentity,
      operationRootIdentity: selected.operationRootIdentity, operationParentIdentity: selected.operationParentIdentity }, {
      assertAuthority: authority.assertCurrent, assertExternalSelection: authority.assertOwned,
    });
    // This checkpoint proves handoff, never fabricates a completed physical deletion.
    throw stopped;
  });
  const f = await fixture(test, mode, { continuation: { captureAuthority: () => ({
    assertCurrent() { f.assertCurrent(); }, async assertOwned() { await f.assertOwned(); },
    recordRemoved(): never { throw new Error('UNEXPECTED_PHYSICAL_COMPLETION'); },
  }), resume } });
  await publishRealDeletion(f);
  await expect(f.startDurable()).rejects.toMatchObject({ cause: stopped });
  expect(resume).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
  expect(f.launch).not.toHaveBeenCalled();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  for (const sentinel of f.sentinels) expect(await readFile(sentinel, 'utf8')).toBe('retained');
  const [guard] = f.publish.mock.calls[0]!;
  expect(guard).toThrow();
  expect((await new WorkspaceDeletionJournalStore(f.root).inspect(() => {})).plan.mode).toBe('published');
});

for (const managementMode of ['active', 'selector'] as const) it.for([managementMode])('preserves %s published slots without live handoff when final preparation loses its requester',
  managementMode === 'selector' ? { timeout: 10_000 } : {}, async (mode, test) => {
  const resume = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_DURABLE_WORK'); });
  const f = await fixture(test, mode, { continuation: { captureAuthority: () => ({
    assertCurrent() { f.assertCurrent(); }, async assertOwned() { await f.assertOwned(); },
    recordRemoved(): never { throw new Error('UNEXPECTED_PHYSICAL_COMPLETION'); },
  }), resume } });
  await publishRealDeletion(f, () => f.revokeRequest());
  await expect(f.startDurable()).rejects.toThrow();
  expect(resume).not.toHaveBeenCalled();
  const observed = await new WorkspaceDeletionJournalStore(f.root).inspect(() => {});
  expect(observed.plan.mode).toBe('published');
  expect(observed.slots.next).toBeUndefined();
  expect(f.lease.readState()).toBe('idle');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  for (const sentinel of f.sentinels) expect(await readFile(sentinel, 'utf8')).toBe('retained');
});

async function publishRealDeletion(f: Awaited<ReturnType<typeof fixture>>, afterPublish?: () => void) {
  const publish = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent });
  f.publish.mockImplementation(async (...args) => {
    const [, , target, context] = args;
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.target).toBe(target);
    expect(context.backupDisposition).toBe('explicitDataLoss');
    await publish(...args);
    afterPublish?.();
  });
}

it('publishes replacement binding after its own capability disposal and returns without a released-lease guard', async test => {
  const f = await replacementFixture(test);
  const result = await f.replace().catch(error => error as unknown);
  expect(errorCauses(result)).toContain(f.stageFailure);
  expect(f.publishBinding).toHaveBeenCalledOnce();
  expect(f.stage).toHaveBeenCalledOnce();
  expect(f.discard).toHaveBeenCalledOnce();
  expect(f.invalidate).not.toHaveBeenCalled();
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
  expect(await readFile(f.bindingPaths().currentPath)).not.toHaveLength(0);
  expect(await readFile(f.runtimePaths.activeDatabasePath, 'utf8')).toBe('old database');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});

it.for([false, true])('blocks queued and late replacement completion with deletion preparation disabled=%s', async (disabled, test) => {
  const f = await replacementFixture(test, { disabled, deferCompletion: true });
  await f.service.rename(TEST_TARGET_WORKSPACE_ID, 'Kohde');
  f.runtimeRelaunch.request();
  const first = new Error('SYNTHETIC_BINDING_ACK_LOST');
  f.publishBinding.mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
    await f.originalPublish.call(this, value, authority);
    throw first;
  });
  const result = await f.replace().catch(error => error as unknown);
  expect(errorCauses(result)).toContain(first);
  expect(f.invalidate).toHaveBeenCalledOnce();
  expect(f.stage).not.toHaveBeenCalled();
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.lease.readState()).toBe('idle');
  const retained = await readFile(f.bindingPaths().currentPath);
  const nextLease = await f.lease.acquire('replace');
  try {
    expect(() => f.completeDeferred()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    f.runtimeRelaunch.request();
    await expect(f.service.rename(TEST_TARGET_WORKSPACE_ID, 'Later')).rejects.toThrow();
    f.completeDeferred();
    expect(f.launch).not.toHaveBeenCalled();
    expect(await readFile(f.bindingPaths().currentPath)).toEqual(retained);
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  } finally { await nextLease.release(); }
});

it('retains the binding and registry side slot when replacement recovery loses selection', async test => {
  const f = await replacementFixture(test);
  f.stage.mockImplementation(async () => {
    await writeFile(`${f.registryPath}.next`, f.registryBytes);
    throw f.stageFailure;
  });
  const result = await f.replace().catch(error => error as unknown);
  expect(errorCauses(result)).toContain(f.stageFailure);
  expect(f.publishBinding).toHaveBeenCalledOnce();
  expect(f.invalidate).toHaveBeenCalledOnce();
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
  expect(await readFile(`${f.registryPath}.next`)).toEqual(f.registryBytes);
  expect(await readFile(f.bindingPaths().currentPath)).not.toHaveLength(0);
});

it('pins all replacement owner callbacks before composition awaits', async test => {
  const f = await replacementFixture(test, { replaceOwnerCallbacks: true });
  const first = new Error('SYNTHETIC_BINDING_ACK_LOST');
  f.publishBinding.mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
    await f.originalPublish.call(this, value, authority);
    throw first;
  });
  const result = await f.replace().catch(error => error as unknown);
  expect(errorCauses(result)).toContain(first);
  expect(f.assertOwned).toHaveBeenCalled();
  expect(f.invalidate).toHaveBeenCalledOnce();
  expect(f.foreignOwner).not.toHaveBeenCalled();
  expect(f.stage).not.toHaveBeenCalled();
});

it('latches replacement uncertainty before every close and preserves all close failures', async test => {
  const f = await replacementFixture(test, { deferCompletion: true });
  await f.service.rename(TEST_TARGET_WORKSPACE_ID, 'Kohde');
  const first = new Error('SYNTHETIC_BINDING_ACK_LOST');
  const admissionFailure = new Error('SYNTHETIC_ADMISSION_CLOSE_FAILED');
  const guardFailure = new Error('SYNTHETIC_GUARD_CLOSE_FAILED');
  const ownerFailure = new Error('SYNTHETIC_OWNER_INVALIDATE_FAILED');
  const closeAdmission = f.service.closeAdmission.bind(f.service);
  const disposeGuard = MainOwnedWorkspaceManagementOperationGuard.prototype.dispose;
  f.publishBinding.mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
    await f.originalPublish.call(this, value, authority);
    vi.spyOn(f.service, 'closeAdmission').mockImplementation(closeAdmission).mockImplementationOnce(() => {
      closeAdmission();
      f.runtimeRelaunch.request();
      expect(() => f.completeDeferred()).toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      throw admissionFailure;
    });
    vi.spyOn(MainOwnedWorkspaceManagementOperationGuard.prototype, 'dispose').mockImplementation(function (this: MainOwnedWorkspaceManagementOperationGuard) {
      disposeGuard.call(this); throw guardFailure;
    });
    f.invalidate.mockImplementation(() => { throw ownerFailure; });
    throw first;
  });
  try {
    const result = await f.replace().catch(error => error as unknown);
    const causes = errorCauses(result);
    for (const failure of [first, admissionFailure, guardFailure, ownerFailure]) expect(causes).toContain(failure);
    expect(causes.indexOf(first)).toBeLessThan(causes.indexOf(admissionFailure));
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.discard).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  } finally { vi.restoreAllMocks(); }
});

it('joins original replacement ownership work before releasing the lease after revocation', async test => {
  const f = await replacementFixture(test);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.assertOwned.mockImplementationOnce(async () => { entered(); await gate; });
  let settled = false;
  const result = f.replace().catch(error => error as unknown).finally(() => { settled = true; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('OWNER_WORK_NOT_STARTED'); })]);
    f.revokeOwner();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.lease.readState()).toBe('busy');
    expect(f.invalidate).not.toHaveBeenCalled();
  } finally { release(); await result; }
  expect(errorCauses(await result).some(error => error instanceof Error && error.message === 'SYNTHETIC_RESERVATION_LOST')).toBe(true);
  expect(f.invalidate).toHaveBeenCalledOnce();
  expect(f.lease.readState()).toBe('idle');
  expect(f.stage).not.toHaveBeenCalled();
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
});

function errorCauses(error: unknown): unknown[] {
  if (!(error instanceof Error)) return [error];
  return [error, ...(error instanceof AggregateError ? error.errors.flatMap(errorCauses) : []),
    ...('cause' in error ? errorCauses(error.cause) : [])];
}

async function replacementFixture(test: TestContext, options: {
  disabled?: boolean; deferCompletion?: boolean; replaceOwnerCallbacks?: boolean;
} = {}) {
  const f = await fixture(test, 'active', { ...options, replacement: true });
  const originalPublish = WorkspaceRemnantBindingStore.prototype.publish;
  const publishBinding = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish');
  const stageFailure = new Error('SYNTHETIC_BACKUP_STAGE_FAILED');
  vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'inspect').mockResolvedValue({ appVersion: '0.3.0',
    containerSha256: 'c'.repeat(64), migrationChainIdentity: 'd'.repeat(64), profileId: 'a'.repeat(64) });
  const stage = vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'stage').mockRejectedValue(stageFailure);
  const discard = vi.spyOn(NodeWorkspaceBackupReplacementRootStore.prototype, 'discardBeforeActivation');
  return { ...f, originalPublish, publishBinding, stageFailure, stage, discard,
    bindingPaths() {
      const binding = captureWorkspaceRemnantBinding(publishBinding.mock.calls[0]![0]);
      return createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
    },
  };
}

async function fixture(test: TestContext, mode: 'active' | 'selector', options: {
  cancel?: boolean; returnChoice?: boolean; loseAtCompletion?: boolean; revokeAtCompletion?: boolean; disabled?: boolean;
  replacement?: boolean; deferCompletion?: boolean; replaceOwnerCallbacks?: boolean;
  continuation?: WorkspaceManagementServiceOptions['deletionContinuation'];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-composition-'));
  let composition: Omit<WorkspaceManagementComposition, 'readActiveWorkspaceLabel'> | undefined;
  const pending: Promise<unknown>[] = [];
  const expectedCompletionFailures: unknown[] = [];
  test.onTestFinished(async () => {
    await Promise.allSettled(pending);
    if (expectedCompletionFailures.length === 0) await composition?.shutdown();
    else await expect(composition!.shutdown()).rejects.toMatchObject({
      message: 'WORKSPACE_MANAGEMENT_COMPLETION_FAILED', errors: expectedCompletionFailures,
    });
    vi.restoreAllMocks();
    vi.mocked(utilityProcess.fork).mockClear();
    if (test.task.result?.state === 'pass') await rm(root, { force: true, recursive: true });
  });
  const resources = join(root, 'resources');
  await mkdir(join(resources, 'backend', 'dist', 'database', 'migrations'), { recursive: true });
  await mkdir(join(resources, 'desktop-runtime', 'runtime'), { recursive: true });
  await writeFile(join(resources, 'desktop-runtime', 'runtime', 'workspaceCandidateRunner.js'), '// Synthetic path fixture; never executed.');
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const initial = { ...createSwitchRegistry(), formatVersion: 2 as const,
    activeWorkspaceId: mode === 'active' ? TEST_SOURCE_WORKSPACE_ID : null };
  await registry.write(initial);
  const registryBytes = await readFile(registryPath);
  const sentinels: string[] = [];
  for (const workspace of initial.workspaces) {
    const workspacePaths = deriveWorkspaceRoot(root, workspace.workspaceId, workspace.layoutVersion);
    const workspaceRoot = workspacePaths.workspaceRoot;
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    await expect(inspectWorkspaceRoot(workspacePaths)).resolves.toBe(workspacePaths);
    const sentinel = join(workspaceRoot, 'sentinel');
    await writeFile(sentinel, 'retained'); sentinels.push(sentinel);
  }
  const lease = new InMemoryWorkspaceMaintenanceLease();
  let current = true;
  let requestCurrent = true;
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!current) throw new Error('SYNTHETIC_RESERVATION_LOST'); };
  const assertRequest = () => { if (!requestCurrent) throw new Error('SYNTHETIC_REQUEST_REVOKED'); };
  const assertOwned = vi.fn(async () => { assertCurrent(); });
  const invalidate = vi.fn(() => { current = false; });
  const replacementOwner = { assertCurrent, assertOwned, invalidate };
  const foreignOwner = vi.fn(() => { throw new Error('UNEXPECTED_REPLACEMENT_OWNER'); });
  const launch = vi.fn(() => { assertCurrent(); expect(lease.readState()).toBe(options.replacement ? 'idle' : 'busy'); });
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(launch);
  let deferredGuard: (() => void) | undefined;
  const runtimePaths = deriveWorkspaceBackupReplacementRuntimePaths(root, TEST_SOURCE_WORKSPACE_ID);
  if (options.replacement) {
    await mkdir(dirname(runtimePaths.activeDatabasePath), { recursive: true, mode: 0o700 });
    await mkdir(runtimePaths.activeArtifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(runtimePaths.activeDatabasePath, 'old database');
    await writeFile(join(runtimePaths.activeArtifactRoot, 'old.pdf'), 'old pdf');
  }
  const stopBackend = vi.fn(async () => {});
  const active = new MainOwnedActiveWorkspaceLifecycle(TEST_SOURCE_WORKSPACE_ID, new BackendRequestQuiescence(), {
    async closeBrokers() {}, async disposeCapabilities() { if (options.replacement) composition!.dispose(); }, async markCleanShutdown() {},
    async sealAndDrainSecrets() {}, async stopRecoveryPointScheduler() {},
    async stopBackend() { if (options.replacement) return 'exited'; throw new Error('UNEXPECTED_ORDINARY_STOP'); },
    async stopBackendForUpdate() { throw new Error('UNEXPECTED_UPDATE_STOP'); },
    deletion: { async sealAndDrainArchive() {}, stopBackend },
  }, runtimeRelaunch);
  const selector = new MainOwnedSelectorWorkspaceLifecycle({ assertSelectorCurrent: assertCurrent,
    reservation: { assertMainCurrent: assertCurrent, assertMainOwned: assertOwned },
    maintenanceLease: lease, runtimeRelaunch });
  const backup = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_BACKUP'); });
  const createRuntime = vi.fn<WorkspaceDeletionPreparationCompositionOptions['createRuntime']>(() => mode === 'selector'
    ? { kind: 'selector', lifecycle: selector }
    : { kind: 'active', workspaceId: TEST_SOURCE_WORKSPACE_ID, lifecycle: active,
        broker: { async beginDeleteMaintenance() { return 'busy' as const; }, async assertDeleteMaintenance() { return 'busy' as const; }, captureInspectionAuthority: () => assertCurrent },
        createBackup: backup, recheckExport: backup });
  const confirmLoss = vi.fn(async () => true);
  const confirmDeletion = vi.fn(async () => !options.cancel);
  const publish = vi.fn<WorkspaceDeletionPreparationCompositionOptions['publish']>(async (guard, selection) => {
    await selection(); guard();
  });
  const log = vi.fn();
  const shared = {
    importOwner: { assertCurrent, assertMainCurrent: assertCurrent, assertMainOwned: assertOwned,
      invalidate() { current = false; } },
    appVersion: '0.3.0', buildRevision: 'a'.repeat(40),
    localUpdateRuntimePaths: createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: join(root, 'runtime') }),
    maintenanceLease: lease, operationalLogger: { write: log },
    operationalIdentity: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), runtimeInstanceId: generation },
    reservationOwner: { assertMainOwned: assertOwned, bindCandidate() { throw new Error('UNEXPECTED_CANDIDATE'); } },
    resourcesPath: resources, userDataRoot: root,
    runtimeRelaunch: { request: () => runtimeRelaunch.request(), complete(guard?: () => void) {
      deferredGuard = guard;
      if (options.deferCompletion) return;
      if (options.loseAtCompletion) current = false;
      if (options.revokeAtCompletion) requestCurrent = false;
      try { runtimeRelaunch.complete(guard); }
      catch (error) { expectedCompletionFailures.push(error); throw error; }
    } },
    ...(options.disabled ? {} : { deletionPreparation: {
      runtimeGeneration: generation, createRuntime,
      assertMainReservation: assertOwned, assertMainReservationCurrent: assertCurrent,
      confirmDataLoss: confirmLoss, confirmDeletion,
      async confirmReturn() { return options.returnChoice ?? false; }, publish,
    } }),
    ...(options.continuation === undefined ? {} : { deletionContinuation: options.continuation }),
  };
  const compositionTask = mode === 'selector'
    ? createWorkspaceManagementComposition({ ...shared, mode, activeWorkspaceLifecycle: selector, assertCurrent })
    : createWorkspaceManagementComposition({ ...shared, activeWorkspaceId: TEST_SOURCE_WORKSPACE_ID,
        activeWorkspaceLifecycle: active, profileRestoreActivationJournalPath: join(root, 'restore-journal'),
        replacementOwner,
        recoveryPointService: { async createPreRestore() {
          if (!options.replacement) throw new Error('UNEXPECTED_RECOVERY_POINT');
          return { artifactId: generation, byteSize: 1, createdAt: '2026-10-29T00:00:00.000Z',
            kind: 'preRestore', state: 'validatedGood', validatedAt: '2026-10-29T00:00:00.000Z' };
        } } });
  if (options.replaceOwnerCallbacks) {
    Object.assign(replacementOwner, { assertCurrent: foreignOwner, assertOwned: foreignOwner, invalidate: foreignOwner });
  }
  composition = await compositionTask;
  const service = composition.service;
  const start = (durable: boolean, backupChoice: 'explicitDataLoss' | 'createBackup' = 'explicitDataLoss') => {
    const work = service[durable ? 'deleteWorkspace' : 'prepareDeletion']({ formatVersion: 1, workspaceId: TEST_TARGET_WORKSPACE_ID,
      typedLabel: initial.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!.workspaceLabel, backupChoice },
    { assertCurrent: assertRequest, closeAdmissionForOwnStop: () => service.closeAdmission() });
    pending.push(work); void work.catch(() => undefined); return work;
  };
  return { start: (backupChoice?: 'explicitDataLoss' | 'createBackup') => start(false, backupChoice),
    startDurable: () => start(true), replace() {
    const work = service.replaceActiveFromBackup({ targetWorkspaceId: TEST_SOURCE_WORKSPACE_ID,
      containerPath: join(root, 'synthetic.ekybackup'), password: 'synthetic-only' });
    pending.push(work); void work.catch(() => undefined); return work;
  }, completeDeferred() { runtimeRelaunch.complete(deferredGuard); }, revokeOwner() { current = false; },
    revokeRequest() { requestCurrent = false; },
    async assertWritersAbsent() {
      await assertOwned();
      await (mode === 'active' ? active : selector).assertNoActiveWorkspaceRuntime();
      assertCurrent();
    },
    service, root, runtimePaths, replacementOwner, assertCurrent, assertOwned, invalidate, foreignOwner,
    lease, launch, stopBackend, backup, createRuntime, confirmLoss, confirmDeletion, publish, runtimeRelaunch,
    log, registry, registryPath, registryBytes, sentinels };
}

it.for(['active', 'selector'] as const)('forwards the real %s composition read proof only to original selection', async (mode, test) => {
  const f = await fixture(test, mode);
  const capture = originalJournalSelectionFactory.captureWorkspaceDeletionOriginalJournals;
  const originalCalls = vi.spyOn(originalJournalSelectionFactory, 'captureWorkspaceDeletionOriginalJournals');
  originalCalls.mockImplementation((...args) => capture(...args));
  const command = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry: f.registry, assertWritersAbsent: f.assertWritersAbsent });
  let read!: () => Promise<void>;
  f.publish.mockImplementation(async (...args) => {
    expect(args).toHaveLength(6); expect(args[5]).toBeTypeOf('function'); read = args[5]!;
    expect(f.lease.readState()).toBe('busy');
    await command.publish(...args);
  });
  expect(await f.start()).toBe('prepared');
  expect(originalCalls).toHaveBeenCalledTimes(1);
  expect(originalCalls.mock.calls[0]![3]).toBe(read);
  const before = f.assertOwned.mock.calls.length;
  await expect(read()).rejects.toThrow('WORKSPACE_DELETE_AUTHORITY_INVALID');
  expect(f.assertOwned).toHaveBeenCalledTimes(before);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  for (const sentinel of f.sentinels) expect(await readFile(sentinel, 'utf8')).toBe('retained');
  expect(utilityProcess.fork).not.toHaveBeenCalled();
});
