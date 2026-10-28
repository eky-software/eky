import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { utilityProcess } from 'electron';
import { expect, it, vi, type TestContext } from 'vitest';

import { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceManagementComposition, type WorkspaceDeletionPreparationCompositionOptions,
  type WorkspaceManagementComposition } from './workspaceManagementComposition.js';

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

async function fixture(test: TestContext, mode: 'active' | 'selector', options: {
  cancel?: boolean; returnChoice?: boolean; loseAtCompletion?: boolean; revokeAtCompletion?: boolean; disabled?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-composition-'));
  let composition: Omit<WorkspaceManagementComposition, 'readActiveWorkspaceLabel'> | undefined;
  const pending: Promise<unknown>[] = [];
  test.onTestFinished(async () => {
    await Promise.allSettled(pending);
    await composition?.shutdown();
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
  const assertCurrent = () => { if (!current) throw new Error('SYNTHETIC_RESERVATION_LOST'); };
  const assertRequest = () => { if (!requestCurrent) throw new Error('SYNTHETIC_REQUEST_REVOKED'); };
  const assertOwned = vi.fn(async () => { assertCurrent(); });
  const launch = vi.fn(() => { assertCurrent(); expect(lease.readState()).toBe('busy'); });
  const runtimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(launch);
  const stopBackend = vi.fn(async () => {});
  const active = new MainOwnedActiveWorkspaceLifecycle(TEST_SOURCE_WORKSPACE_ID, new BackendRequestQuiescence(), {
    async closeBrokers() {}, async disposeCapabilities() {}, async markCleanShutdown() {},
    async sealAndDrainSecrets() {}, async stopRecoveryPointScheduler() {},
    async stopBackend() { throw new Error('UNEXPECTED_ORDINARY_STOP'); },
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
    appVersion: '0.3.0', buildRevision: 'a'.repeat(40),
    localUpdateRuntimePaths: createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: join(root, 'runtime') }),
    maintenanceLease: lease, operationalLogger: { write: log },
    operationalIdentity: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), runtimeInstanceId: generation },
    reservationOwner: { assertMainOwned: assertOwned, bindCandidate() { throw new Error('UNEXPECTED_CANDIDATE'); } },
    resourcesPath: resources, userDataRoot: root,
    runtimeRelaunch: { request: () => runtimeRelaunch.request(), complete(guard?: () => void) {
      if (options.loseAtCompletion) current = false;
      if (options.revokeAtCompletion) requestCurrent = false;
      runtimeRelaunch.complete(guard);
    } },
    ...(options.disabled ? {} : { deletionPreparation: {
      runtimeGeneration: generation, createRuntime,
      assertMainReservation: assertOwned, assertMainReservationCurrent: assertCurrent,
      confirmDataLoss: confirmLoss, confirmDeletion,
      async confirmReturn() { return options.returnChoice ?? false; }, publish,
    } }),
  };
  composition = mode === 'selector'
    ? await createWorkspaceManagementComposition({ ...shared, mode, activeWorkspaceLifecycle: selector, assertCurrent })
    : await createWorkspaceManagementComposition({ ...shared, activeWorkspaceId: TEST_SOURCE_WORKSPACE_ID,
        activeWorkspaceLifecycle: active, profileRestoreActivationJournalPath: join(root, 'restore-journal'),
        recoveryPointService: { async createPreRestore() { throw new Error('UNEXPECTED_RECOVERY_POINT'); } } });
  const service = composition.service;
  return { start(backupChoice: 'explicitDataLoss' | 'createBackup' = 'explicitDataLoss') {
    const work = service.prepareDeletion({ formatVersion: 1, workspaceId: TEST_TARGET_WORKSPACE_ID,
      typedLabel: initial.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!.workspaceLabel, backupChoice },
    { assertCurrent: assertRequest, closeAdmissionForOwnStop: () => service.closeAdmission() });
    pending.push(work); void work.catch(() => undefined); return work;
  }, lease, launch, stopBackend, backup, createRuntime, confirmLoss, confirmDeletion, publish, runtimeRelaunch,
    log, registryPath, registryBytes, sentinels };
}
