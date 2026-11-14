import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { acquireWorkspaceProcessReservation } from '../../runtime/workspaceProcessReservation.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceBackupImportBinding } from './workspaceBackupImportBinding.js';
import { WorkspaceBackupImportCoordinator } from './workspaceBackupImportCoordinator.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import { createWorkspaceBackupImportCoordinatorFixture, TEST_IMPORT_CREATED_AT, TEST_IMPORT_OPERATION_ID,
  TEST_IMPORT_WORKSPACE_ID, TEST_IMPORT_CONTAINER_PATH, TEST_IMPORT_PASSWORD } from './workspaceBackupImportTestSupport.js';

const input = { workspaceLabel: 'Imported synthetic', containerPath: TEST_IMPORT_CONTAINER_PATH, password: TEST_IMPORT_PASSWORD };

// Actual metadata/root stores and OS reservation; candidate content/runtime are modeled.
async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-coordinator-files-'));
  const reservation = await acquireWorkspaceProcessReservation({ userDataRoot: root, signal: new AbortController().signal });
  test.onTestFinished(async () => {
    await reservation.release(); vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const f = createWorkspaceBackupImportCoordinatorFixture({ userDataRoot: root });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  await registry.write(f.registry.value!);
  const journalPath = join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const journal = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: journalPath });
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const state = { current: true };
  const assertGeneration = () => {
    if (!state.current || reservation.invalidated.aborted) throw new Error('SYNTHETIC_IMPORT_OWNER_EXPIRED');
  };
  const absence = { async assertNoActiveWorkspaceRuntime() {
    if (f.lifecycle.runningRuntimeOwners !== 0 || f.lifecycle.openDatabaseHandleOwners !== 0) throw new Error('SYNTHETIC_RUNTIME_PRESENT');
  } };
  const stage = f.container.stage.bind(f.container);
  vi.spyOn(f.container, 'stage').mockImplementation(async value => {
    await stage(value); await mkdir(value.importStagingRoot, { mode: 0o700 }); return f.container.inspect(value);
  });
  const migrate = f.candidate.migrate.bind(f.candidate);
  vi.spyOn(f.candidate, 'migrate').mockImplementation(async value => {
    const result = await migrate(value);
    await writeFile(value.databaseFilePath, 'synthetic database bytes', { flag: 'wx' });
    await writeFile(join(value.artifactRoot, 'invoice.pdf'), 'synthetic PDF bytes', { flag: 'wx' });
    return result;
  });
  const terminal = vi.fn(() => {
    assertGeneration(); expect(lease.readState()).toBe('idle'); f.lifecycle.completeReturn();
  });
  const uncertain = vi.fn(() => { state.current = false; });
  const coordinator = new WorkspaceBackupImportCoordinator({ userDataRoot: root,
    activeWorkspaceLifecycle: f.lifecycle, workspaceRuntimeAbsence: absence,
    backupCandidate: f.candidate, backupContainer: f.container, plaintextQuarantine: f.plaintextQuarantine,
    maintenanceLease: lease, registry, importJournal: journal, rootStore: new NodeWorkspaceBackupImportRootStore(),
    generateOperationId: () => TEST_IMPORT_OPERATION_ID, generateWorkspaceId: () => TEST_IMPORT_WORKSPACE_ID,
    now: () => new Date(TEST_IMPORT_CREATED_AT),
    captureImportOwner(held) {
      const assertLease = lease.captureCurrentOwner(['import'], held);
      const current = () => { assertGeneration(); assertLease(); };
      const mainCurrent = () => { current(); if (f.lifecycle.runningRuntimeOwners !== 0) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); };
      const owned = async () => { mainCurrent(); await reservation.assertOwned(); mainCurrent(); };
      return { assertCurrent: current, assertMainCurrent: mainCurrent, assertMainOwned: owned,
        onUncertain: uncertain, onTerminalAfterRelease: terminal,
        createBinding(selection) { return new WorkspaceBackupImportBinding({ ...selection, userDataRoot: root,
          lease: held, maintenanceLease: lease, registry, runtimeAbsence: absence,
          mainOwner: { assertCurrent: mainCurrent, assertOwned: owned } }); },
      };
    },
  });
  const paths = deriveWorkspaceBackupImportPaths(root, TEST_IMPORT_OPERATION_ID, TEST_IMPORT_WORKSPACE_ID);
  const bindingPaths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceImport', operationId: TEST_IMPORT_OPERATION_ID });
  return { ...f, root, paths, state, registry, registryPath, journal, journalPath, bindingPaths, lease, terminal, uncertain, coordinator };
}

it('publishes real payload and registry bytes, retires metadata, then returns only after lease release', { timeout: 10_000 }, async test => {
  const f = await fixture(test);
  await expect(f.coordinator.import(input)).resolves.toMatchObject({ workspaceId: TEST_IMPORT_WORKSPACE_ID });
  expect(await readFile(f.paths.publishedDatabaseFilePath, 'utf8')).toBe('synthetic database bytes');
  expect(await readFile(join(f.paths.publishedArtifactRoot, 'invoice.pdf'), 'utf8')).toBe('synthetic PDF bytes');
  expect((await f.registry.inspect())?.workspaces).toHaveLength(2);
  expect(await f.journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
  for (const path of [f.paths.operationRoot, f.bindingPaths.currentPath, f.bindingPaths.nextPath, f.bindingPaths.backupPath]) {
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect(f.terminal).toHaveBeenCalledOnce(); expect(f.uncertain).not.toHaveBeenCalled();
});

it('retires real candidate and metadata after a proven ordinary migration failure', async test => {
  const f = await fixture(test);
  vi.spyOn(f.candidate, 'migrate').mockRejectedValueOnce(new Error('SYNTHETIC_MIGRATION_FAILED'));
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_MIGRATION_FAILED' });
  expect((await f.journal.inspectSlots()).current).toBeUndefined();
  await expect(readFile(f.bindingPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await f.registry.inspect())?.workspaces).toHaveLength(1);
  expect(f.terminal).toHaveBeenCalledOnce(); expect(f.uncertain).not.toHaveBeenCalled();
});

it('retains the real journal after same-byte replacement invalidates its receipt', async test => {
  const f = await fixture(test);
  const write = f.journal.writeSelected.bind(f.journal);
  vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => {
    const identity = await write(...args); const bytes = await readFile(f.journalPath);
    await rename(f.journalPath, f.journalPath + '.retained');
    await writeFile(f.journalPath, bytes, { flag: 'wx' }); return identity;
  });
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_JOURNAL_FAILED' });
  expect(await readFile(f.journalPath)).toEqual(await readFile(f.journalPath + '.retained'));
  expect((await f.journal.inspectSlots()).current?.value.state).toBe('prepared');
  expect(f.terminal).not.toHaveBeenCalled(); expect(f.uncertain).toHaveBeenCalledOnce();
});

it('preserves real candidate, binding and journal when plaintext cleanup is uncertain', async test => {
  const f = await fixture(test);
  vi.spyOn(f.container, 'stage').mockRejectedValueOnce(new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'plaintextQuarantine'));
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ stage: 'plaintextQuarantine' });
  expect((await f.journal.inspectSlots()).current?.value.state).toBe('candidateRootCreated');
  expect((await readFile(f.bindingPaths.currentPath)).byteLength).toBeGreaterThan(0);
  expect(f.terminal).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
  expect(f.lifecycle.runningRuntimeOwners).toBe(0);
});
