import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, type TestContext } from 'vitest';
import { maximumWorkspaceRemnantBindingBytes } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { createNodeWorkspaceRegistryFileSystem } from '../registry/workspaceRegistryFileSystem.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { createImportedWorkspaceEntry, publishImportedWorkspaceEntry } from './workspaceBackupImportRegistry.js';
import { WorkspaceBackupImportBinding, type WorkspaceBackupImportBindingOptions } from './workspaceBackupImportBinding.js';

export const importBindingOperationId = '33333333-3333-4333-8333-333333333333';
export const importBindingWorkspaceId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');

export async function createImportBindingFixture(context: TestContext, selector = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-import-binding-'));
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPaths = createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME));
  const registryFs = createNodeWorkspaceRegistryFileSystem(registryPaths);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPaths.currentPath, fileSystem: registryFs });
  const createdAt = '2026-10-29T09:00:00.000Z';
  const originalId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
  const original = { formatVersion: 2 as const, activeWorkspaceId: selector ? null : originalId,
    workspaces: [createImportedWorkspaceEntry({ workspaceId: originalId, workspaceLabel: 'Existing synthetic',
      createdAt, lineageIdentity: { formatVersion: 1, profileId: 'a'.repeat(64) } })] };
  await registry.write(original);
  const selection = await registry.inspectSlots();
  const lineageIdentity = { formatVersion: 1 as const, profileId: 'b'.repeat(64) };
  const entry = createImportedWorkspaceEntry({ workspaceId: importBindingWorkspaceId,
    workspaceLabel: 'Imported synthetic', createdAt, lineageIdentity });
  const expected = publishImportedWorkspaceEntry(original, entry);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const held = await lease.acquire('import');
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceImport', operationId: importBindingOperationId });
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
  const state = { current: true, owned: true, absent: true };
  const onUncertain = vi.fn<() => void>();
  const assertOwned = vi.fn(async () => { if (!state.owned) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); });
  const assertAbsent = vi.fn(async () => { if (!state.absent) throw new Error('SYNTHETIC_RUNTIME_PRESENT'); });
  const checkJournal = vi.fn(async () => {});
  const checkInitialJournal = vi.fn(async () => {});
  const options: WorkspaceBackupImportBindingOptions = { userDataRoot: root, operationId: importBindingOperationId,
    workspaceId: importBindingWorkspaceId, lineageIdentity, registrySelection: selection, registry,
    lease: held, maintenanceLease: lease, runtimeAbsence: { assertNoActiveWorkspaceRuntime: assertAbsent },
    mainOwner: { assertCurrent() { if (!state.current) throw new Error('SYNTHETIC_MAIN_EXPIRED'); }, assertOwned },
    assertJournalSelection: checkInitialJournal, onUncertain };
  return { root, registryPaths, registryFs, registry, original, selection, entry, expected, lease, held, paths, fileSystem,
    state, onUncertain, assertOwned, assertAbsent, checkJournal, checkInitialJournal, options,
    binding: new WorkspaceBackupImportBinding(options, fileSystem) };
}

export async function snapshotImportBindingFiles(root: string): Promise<readonly unknown[]> {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const result: unknown[] = [];
  for (const entry of entries) result.push([entry.name, entry.isDirectory()
    ? await snapshotImportBindingFiles(join(root, entry.name)) : await readFile(join(root, entry.name))]);
  return result;
}

export function importBindingGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
