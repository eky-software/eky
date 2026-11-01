import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

it.for(['active', 'selector'] as const)('publishes the real %s source selection in the approved order without deleting data', async (mode, test) => {
  const f = await fixture(test, mode);
  const observations: string[] = [];
  const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    await compare.apply(this, args); observations.push('sources');
  });
  f.backup.mockImplementation(async () => { observations.push('backup'); });
  const result = await f.start();
  expect(observations).toEqual(['sources', 'backup', 'sources', 'sources']);
  expect(result.journal).toMatchObject({ phase: 'authorized', backupDisposition: 'explicitDataLoss',
    previousActiveWorkspaceId: mode === 'active' ? TEST_SOURCE_WORKSPACE_ID : null,
    target: { operationId: id(1), workspaceId: TEST_TARGET_WORKSPACE_ID } });
  const observed = await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard);
  expect(observed.plan.mode).toBe('published');
  expect(observed.slots.next).toBeUndefined(); expect(observed.slots.backup).toBeUndefined();
  expect(result.workspaceRootIdentity).toBe(f.selected.target.rootIdentity);
  expect(result.journal.inventory.recordCount).toBe(1);
  await f.preserved();
});

it.for(['source', 'registry', 'journal', 'inventory', 'authority', 'writers', 'backup'] as const)(
  'retains initial-next without authorizing deletion when %s changes during the backup read', async (changed, test) => {
    const f = await fixture(test), failure = new Error('SYNTHETIC_BACKUP_FAILURE');
    f.backup.mockImplementation(async () => {
      if (changed === 'source') await f.addUnownedSource();
      if (changed === 'registry') await writeFile(`${f.registryPath}.next`, f.registryBytes, { flag: 'wx' });
      if (changed === 'journal') await writeFile(f.journal.backupPath, await readFile(f.journal.nextPath), { flag: 'wx' });
      if (changed === 'inventory') await appendFile(f.inventory.currentPath, 'changed');
      if (changed === 'authority') f.revoke();
      if (changed === 'writers') f.writerAppeared();
      if (changed === 'backup') throw failure;
    });
    const result = f.start();
    if (changed === 'backup') await expect(result).rejects.toBe(failure);
    else await expect(result).rejects.toThrow();
    await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.journal.nextPath)).not.toHaveLength(0);
    expect(await readFile(f.inventory.currentPath)).not.toHaveLength(0);
    await f.preserved();
    if (changed === 'source') expect(await readFile(f.unownedFile, 'utf8')).toBe('unowned retained');
    if (changed === 'registry') expect((await readFile(`${f.registryPath}.next`)).equals(f.registryBytes)).toBe(true);
    if (changed === 'journal') expect((await readFile(f.journal.backupPath)).equals(await readFile(f.journal.nextPath))).toBe(true);
  });

it.for(['source', 'identity', 'sideSlot'] as const)('rejects postpublication %s changes and preserves the committed journal', async (changed, test) => {
  const f = await fixture(test);
  const publish = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const result = await publish.apply(this, args);
    if (changed === 'source') await f.addUnownedSource();
    if (changed === 'identity') {
      await rename(f.journal.currentPath, join(f.root, 'retained-original-journal'));
      await writeFile(f.journal.currentPath, await readFile(join(f.root, 'retained-original-journal')), { flag: 'wx' });
    }
    if (changed === 'sideSlot') await writeFile(f.journal.nextPath, await readFile(f.journal.currentPath), { flag: 'wx' });
    return result;
  });
  await expect(f.start()).rejects.toThrow();
  expect(await readFile(f.journal.currentPath)).not.toHaveLength(0);
  await f.preserved();
});

it('rejects same-byte registry replacement against the original preparation identity before inventory creation', async test => {
  const f = await fixture(test);
  await rename(f.registryPath, join(f.root, 'retained-original-registry'));
  await writeFile(f.registryPath, f.registryBytes, { flag: 'wx' });
  await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  await expect(readFile(f.inventory.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.backup).not.toHaveBeenCalled(); await f.preserved();
});

it('does not replace an earlier interrupted publication or clean its source metadata', async test => {
  const f = await fixture(test);
  const binding = await f.publishBinding(TEST_TARGET_WORKSPACE_ID, false);
  const bytes = await readFile(binding);
  await mkdir(f.journal.directoryPath, { recursive: true, mode: 0o700 });
  await writeFile(f.journal.nextPath, 'retained interrupted bytes', { flag: 'wx' });
  await expect(f.start()).rejects.toThrow();
  expect(await readFile(f.journal.nextPath, 'utf8')).toBe('retained interrupted bytes');
  expect((await readFile(binding)).equals(bytes)).toBe(true);
  await expect(readFile(f.inventory.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(f.backup).not.toHaveBeenCalled(); await f.preserved();
});

it('cleans only proven target metadata before capturing sources and preserves foreign metadata', async test => {
  const f = await fixture(test);
  const own = await f.publishBinding(TEST_TARGET_WORKSPACE_ID, false);
  const foreign = await f.publishBinding(TEST_SOURCE_WORKSPACE_ID, true), bytes = await readFile(foreign);
  const result = await f.start();
  expect(result.journal.inventory.recordCount).toBe(1);
  await expect(readFile(own)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readFile(foreign)).equals(bytes)).toBe(true);
  await f.preserved();
}, 10_000);

it('joins an admitted backup check after revocation and rejects concurrent publication', async test => {
  const f = await fixture(test);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.backup.mockImplementation(async () => { entered(); await gate; });
  let settled = false;
  const result = f.start().catch(error => error as unknown).finally(() => { settled = true; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('BACKUP_CHECK_NOT_REACHED'); })]);
    await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    f.revoke(); await Promise.resolve();
    expect(settled).toBe(false);
    await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { release(); await result; }
  expect(await result).toBeInstanceOf(Error);
  expect(await readFile(f.journal.nextPath)).not.toHaveLength(0);
  await f.preserved();
});

async function fixture(test: TestContext, mode: 'active' | 'selector' = 'active') {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-publication-'));
  const pending: Promise<unknown>[] = [];
  let owned = true, writersAbsent = true;
  const guard = () => { test.signal.throwIfAborted(); if (!owned) throw new Error('SYNTHETIC_AUTHORITY_LOST'); };
  const assertWritersAbsent = async () => { guard(); if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); };
  test.onTestFinished(async () => {
    owned = false; await Promise.allSettled(pending); vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const initial = { ...createSwitchRegistry(), formatVersion: 2 as const,
    activeWorkspaceId: mode === 'active' ? TEST_SOURCE_WORKSPACE_ID : null };
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  await registry.write(initial);
  const registryBytes = await readFile(registryPath), sentinels: string[] = [];
  for (const entry of initial.workspaces) {
    const path = deriveWorkspaceRoot(root, entry.workspaceId, 1).workspaceRoot;
    await mkdir(path, { recursive: true, mode: 0o700 });
    const sentinel = join(path, 'sentinel'); await writeFile(sentinel, 'retained', { flag: 'wx' }); sentinels.push(sentinel);
  }
  const selected = await captureDeletionTarget({ installationRoot: root, workspaceId: TEST_TARGET_WORKSPACE_ID,
    typedLabel: initial.workspaces[1]!.workspaceLabel, registry, assertAuthority: guard });
  const context = Object.freeze({ operationId: id(1), target: selected.target, backupDisposition: 'explicitDataLoss' as const });
  const publish = createWorkspaceDeletionPublisher({ userDataRoot: root, registry, assertWritersAbsent });
  const backup = vi.fn(async () => {});
  const unownedRoot = join(deriveWorkspaceReplacementRemnantParents(root)[1]!.parentPath, id(99));
  const unownedFile = join(unownedRoot, 'retained');
  return { root, registry, registryPath, registryBytes, selected, guard, backup, unownedFile,
    journal: createWorkspaceDeletionJournalPaths(root), inventory: createWorkspaceDeletionInventoryPaths(root, id(1)),
    revoke() { owned = false; }, writerAppeared() { writersAbsent = false; },
    start() {
      const work = publish(guard, backup, selected.target, context, selected.assertCurrent);
      pending.push(work); void work.catch(() => undefined); return work;
    },
    async addUnownedSource() {
      await mkdir(unownedRoot, { recursive: true, mode: 0o700 }); await writeFile(unownedFile, 'unowned retained', { flag: 'wx' });
    },
    async publishBinding(workspaceId: string, foreign: boolean) {
      const entry = initial.workspaces.find(value => value.workspaceId === workspaceId)!;
      const value = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport',
        operationId: id(foreign ? 11 : 10), workspaceId, lineageIdentity: entry.lineageIdentity });
      const key = workspaceRemnantBindingKey(value);
      await new WorkspaceRemnantBindingStore(root, key).publish(value, {
        assertAuthority: guard, assertExternalSelection: selected.assertCurrent,
      });
      return createWorkspaceRemnantBindingPaths(root, key).currentPath;
    },
    async preserved() {
      expect((await readFile(registryPath)).equals(registryBytes)).toBe(true);
      for (const path of sentinels) expect(await readFile(path, 'utf8')).toBe('retained');
    },
  };
}
