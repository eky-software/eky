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

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const selectorRegistry: Readonly<LocalWorkspaceRegistry> = {
  ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null,
};

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
    activeWorkspaceLifecycle: lifecycle, appVersion: '0.3.0', buildRevision: 'a'.repeat(40),
    localUpdateRuntimePaths: update, maintenanceLease: lease, operationalLogger: { write: log },
    operationalIdentity: { appVersion: '0.3.0', buildRevision: 'a'.repeat(40), runtimeInstanceId: '99999999-9999-4999-8999-999999999999' },
    reservationOwner: { assertMainOwned: assertOwned, bindCandidate }, resourcesPath: resources,
    runtimeRelaunch: relaunch, userDataRoot: root });
  const profileRuntimeRoot = createDesktopProfilePaths(deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1).workspaceRoot).runtimeRoot;
  return { root, registryPath, registry, composition, lease, launch, assertOwned, log, bindCandidate, state,
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
