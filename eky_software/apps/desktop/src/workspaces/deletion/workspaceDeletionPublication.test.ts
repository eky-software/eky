import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
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
import { createWorkspaceDeletionPublisher, createWorkspaceDeletionPublicationPhaseProducer,
  type WorkspaceDeletionPublicationPhaseEvent, type WorkspaceDeletionPublicationHandoff } from './workspaceDeletionPublication.js';
import type { SlotIoEvent } from '../persistence/crashSafeFileSlot.js';
import { createWorkspaceDeletionCommand } from './workspaceDeletionCommand.js';
import * as registrySelection from './workspaceDeletionRegistrySelection.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import type { CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import * as originalJournalSelections from './workspaceDeletionOriginalJournalSelection.js';
import { serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';

it.for(['active', 'selector'] as const)('publishes the real %s source selection in the approved order without deleting data', { timeout: 10_000 }, async (mode, test) => {
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

it.for(['source', 'identity', 'sideSlot'] as const)('rejects postpublication %s changes and preserves the committed journal', { timeout: 10_000 }, async (changed, test) => {
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
  const readOwned = vi.fn(f.assertReadOwned);
  const result = await f.start(undefined, readOwned);
  expect(readOwned).toHaveBeenCalled();
  expect(result.journal.inventory.recordCount).toBe(1);
  await expect(readFile(own)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readFile(foreign)).equals(bytes)).toBe(true);
  await f.preserved();
}, 20_000);

it.for(['registry', 'root', 'writer', 'authority'] as const)(
  'current preparation read port rejects changed %s before publication', async (change, test) => {
    const f = await fixture(test);
    const root = deriveWorkspaceRoot(f.root, TEST_TARGET_WORKSPACE_ID, 1).workspaceRoot;
    const retainedRoot = join(f.root, 'retained-original-workspace');
    let changed = false, readCompleted = false;
    const readOwned = vi.fn(async () => {
      if (!changed) {
        changed = true;
        if (change === 'registry') await writeFile(f.registryPath + '.next', f.registryBytes, { flag: 'wx' });
        else if (change === 'root') { await rename(root, retainedRoot); await mkdir(root, { mode: 0o700 }); }
        else if (change === 'writer') f.writerAppeared();
        else f.revoke();
      }
      await f.assertReadOwned(); readCompleted = true;
    });
    await expect(f.start(undefined, readOwned)).rejects.toThrow(change === 'writer' ? 'SYNTHETIC_WRITER_UNSETTLED'
      : change === 'authority' ? 'SYNTHETIC_AUTHORITY_LOST' : 'WORKSPACE_DELETE_STALE_CONFIRMATION');
    expect(readOwned).toHaveBeenCalled();
    expect(readCompleted).toBe(change === 'registry');
    for (const path of [f.journal.currentPath, f.journal.nextPath, f.inventory.currentPath]) {
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(f.backup).not.toHaveBeenCalled();
    expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
    if (change === 'root') {
      expect(await readFile(join(retainedRoot, 'sentinel'), 'utf8')).toBe('retained');
      expect(await readFile(join(deriveWorkspaceRoot(f.root, TEST_SOURCE_WORKSPACE_ID, 1).workspaceRoot, 'sentinel'), 'utf8')).toBe('retained');
    } else await f.preserved();
    if (change === 'registry') expect(await readFile(f.registryPath + '.next')).toEqual(f.registryBytes);
  },
);

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

it.for(['publisher', 'command'] as const)('hands the exact prejournal selection through the %s once without changing payloads', { timeout: 10_000 }, async (owner, test) => {
  const f = await fixture(test), phases: string[] = [];
  let selectedTransition: ReturnType<typeof registrySelection.captureWorkspaceDeletionRegistryTransition> | undefined;
  let selectedJournal: Parameters<WorkspaceDeletionPublicationHandoff>[0] | undefined;
  const transition = registrySelection.captureWorkspaceDeletionRegistryTransition;
  vi.spyOn(registrySelection, 'captureWorkspaceDeletionRegistryTransition').mockImplementation((...args) => {
    selectedTransition = transition(...args); return selectedTransition;
  });
  const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    await compare.apply(this, args); phases.push('sources');
  });
  const beforeJournalPublication = vi.fn<WorkspaceDeletionPublicationHandoff>(async (journal, after) => {
    selectedJournal = journal;
    expect(journal.phase).toBe('authorized'); expect(after).toBe(selectedTransition?.after);
    expect(after.workspaces.some(entry => entry.workspaceId === journal.target.workspaceId)).toBe(false);
    await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(f.journal.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.inventory.currentPath)).not.toHaveLength(0);
    expect(phases).toEqual(['sources']); phases.push('handoff');
  });
  const publishJournal = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(function(this: WorkspaceDeletionJournalStore, ...args) {
    expect(args[0]).toBe(selectedJournal); return publishJournal.apply(this, args);
  });
  f.backup.mockImplementation(async () => { phases.push('backup'); });
  const options = { userDataRoot: f.root, registry: f.registry, assertWritersAbsent: f.assertWritersAbsent, beforeJournalPublication };
  const publish = owner === 'command' ? createWorkspaceDeletionCommand(options).publish : createWorkspaceDeletionPublisher(options);
  const result = await f.start(publish);
  expect(result.journal).toBe(selectedJournal);
  expect(phases).toEqual(['sources', 'handoff', 'sources', 'backup', 'sources', 'sources']);
  expect(beforeJournalPublication).toHaveBeenCalledOnce();
  await expect(f.start(publish)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(beforeJournalPublication).toHaveBeenCalledOnce();
  await f.preserved();
});

it.for(['throws', 'false', 'authority'] as const)('retains inventory and original files when the prejournal handoff %s', async (kind, test) => {
  const f = await fixture(test), first = new Error('SYNTHETIC_PREJOURNAL_HANDOFF_FAILED');
  const handoff = vi.fn<WorkspaceDeletionPublicationHandoff>(async () => {
    if (kind === 'throws') throw first;
    if (kind === 'false') return false as never;
    f.revoke();
  });
  const publish = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, beforeJournalPublication: handoff });
  const work = f.start(publish);
  if (kind === 'throws') await expect(work).rejects.toBe(first); else await expect(work).rejects.toThrow();
  expect(handoff).toHaveBeenCalledOnce();
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(f.journal.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.inventory.currentPath)).not.toHaveLength(0);
  await f.preserved();
});

it('joins the prejournal handoff after revocation without publishing authorization', async test => {
  const f = await fixture(test);
  let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const abort = () => { enter(); release(); };
  test.signal.addEventListener('abort', abort, { once: true });
  const publish = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, async beforeJournalPublication() { enter(); await held; } });
  const work = f.start(publish).finally(() => { settled = true; }); void work.catch(() => undefined);
  try {
    await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_PREJOURNAL_HANDOFF_NOT_REACHED'); })]);
    test.signal.throwIfAborted(); f.revoke();
    await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
    await expect(readFile(f.journal.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    release(); await expect(work).rejects.toThrow('SYNTHETIC_AUTHORITY_LOST');
    await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.preserved();
  } finally {
    release(); await Promise.allSettled([work]); test.signal.removeEventListener('abort', abort);
  }
});

it.for(['off', 'on', 'throwing'] as const)('phase observation preserves publisher comparisons and journal bytes: %s', { timeout: 10_000 }, async (mode, test) => {
  const f = await fixture(test), phases: WorkspaceDeletionPublicationPhaseEvent[] = [], slots: SlotIoEvent[] = [];
  const order: string[] = [], compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    await compare.apply(this, args); order.push('sources');
  });
  f.backup.mockImplementation(async () => { order.push('backup'); });
  const observePublicationPhase = (event: WorkspaceDeletionPublicationPhaseEvent) => {
    phases.push(event); if (mode === 'throwing') throw undefined;
  };
  const observeSlotIo = (event: SlotIoEvent) => { slots.push(event); if (mode === 'throwing') throw undefined; };
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, async beforeJournalPublication() { order.push('handoff'); },
    ...(mode === 'off' ? {} : { observePublicationPhase, observeSlotIo }) });
  const result = await f.start(publisher, f.assertReadOwned);
  expect(order).toEqual(['sources', 'handoff', 'sources', 'backup', 'sources', 'sources']);
  const store = new WorkspaceDeletionJournalStore(f.root);
  expect((await store.inspect(f.guard)).plan.mode).toBe('published');
  const { serializeWorkspaceDeletionJournal } = await import('./workspaceDeletionJournalCodec.js');
  expect(await readFile(f.journal.currentPath)).toEqual(serializeWorkspaceDeletionJournal(result.journal));
  await f.preserved();
  if (mode === 'off') { expect(phases).toEqual([]); expect(slots).toEqual([]); return; }
  expect(phases.filter(event => event.phase === 'sourceComparison' && event.event === 'entered')).toHaveLength(4);
  expect(phases.filter(event => event.phase === 'selectionHandoff' && event.event === 'entered')).toHaveLength(1);
  expect(phases.some(event => event.phase === 'fullSelection')).toBe(true);
  for (const events of [phases, slots]) {
    expect(events.filter(event => event.event === 'rejected')).toEqual([]);
    expect(events.filter(event => event.event === 'entered').map(event => event.callId).sort())
      .toEqual(events.filter(event => event.event === 'fulfilled').map(event => event.callId).sort());
    for (const event of events) expect(Object.isFrozen(event)).toBe(true);
  }
  expect(slots.some(event => event.scope === 'ioAttempt' && event.operation === 'fileWrite')).toBe(true);
  const before = slots.length;
  await store.inspect(f.guard);
  expect(slots).toHaveLength(before);
});

it('phase observation preserves the handoff failure without starting the journal writer', async test => {
  const f = await fixture(test), first = new Error('SYNTHETIC_HANDOFF_ORIGINAL');
  const phases: WorkspaceDeletionPublicationPhaseEvent[] = [], slots: SlotIoEvent[] = [];
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, async beforeJournalPublication() { throw first; },
    observePublicationPhase(event) { phases.push(event); throw new Error('SYNTHETIC_OBSERVER_SECONDARY'); },
    observeSlotIo(event) { slots.push(event); } });
  await expect(f.start(publisher, f.assertReadOwned)).rejects.toBe(first);
  expect(phases.filter(event => event.phase === 'selectionHandoff').map(event => event.event)).toEqual(['entered', 'rejected']);
  expect(slots.some(event => event.operation === 'createNextWriter')).toBe(false);
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});

it('phase observation precedes the final mutation guard even if the observer revokes authority', async test => {
  const f = await fixture(test), events: SlotIoEvent[] = [];
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, observeSlotIo(event) {
      events.push(event);
      if (event.scope === 'ioAttempt' && event.operation === 'fileWrite' && event.event === 'entered') f.revoke();
    } });
  await expect(f.start(publisher, f.assertReadOwned)).rejects.toThrow('SYNTHETIC_AUTHORITY_LOST');
  expect(events.some(event => event.operation === 'fileWrite' && event.event === 'rejected')).toBe(true);
  expect(events.some(event => event.operation === 'fileWrite' && event.event === 'fulfilled')).toBe(false);
  expect(events.some(event => event.operation === 'fileClose' && event.event === 'fulfilled')).toBe(true);
  expect(await readFile(f.journal.nextPath)).toEqual(Buffer.alloc(0));
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});

it.for([false, true])('phase observation returns the exact publisher promise with observer: %s', async enabled => {
  const events: WorkspaceDeletionPublicationPhaseEvent[] = [];
  const observe = createWorkspaceDeletionPublicationPhaseProducer(enabled ? event => { events.push(event); throw undefined; } : undefined);
  const first = new Error('SYNTHETIC_ORIGINAL_PROMISE');
  let calls = 0;
  const original = Promise.reject(first), returned = observe('fullSelection', () => { calls++; return original; });
  expect(returned).toBe(original); await expect(returned).rejects.toBe(first); expect(calls).toBe(1);
  expect(events.map(event => event.event)).toEqual(enabled ? ['entered', 'rejected'] : []);
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
  // Caller ownership is controlled here; root identity and file bytes are real.
  const assertReadOwned = async () => {
    guard(); await selected.assertRootCurrent(); guard();
    await assertWritersAbsent(); guard();
  };
  return { root, registry, registryPath, registryBytes, selected, guard, assertWritersAbsent, assertReadOwned, backup, unownedFile,
    journal: createWorkspaceDeletionJournalPaths(root), inventory: createWorkspaceDeletionInventoryPaths(root, id(1)),
    revoke() { owned = false; }, writerAppeared() { writersAbsent = false; },
    start(publisher = publish, readOwned?: () => Promise<void>) {
      const args = [guard, backup, selected.target, context, selected.assertCurrent] as const;
      const work = readOwned === undefined ? publisher(...args) : publisher(...args, readOwned);
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

import * as sourceFactory from './workspaceDeletionInventorySources.js';
import * as inventoryFiles from './workspaceDeletionInventoryFile.js';
function privateScopeGate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}
it("keeps three independent finite authorities out of the original source and writes", async (context) => {
    const authorities: unknown[] = [], scopes: {
        assertAuthority(): void;
        assertExternalSelection(): Promise<void>;
    }[] = [];
    const originalCapture = sourceFactory.captureWorkspaceDeletionInventorySources;
    vi.spyOn(sourceFactory, 'captureWorkspaceDeletionInventorySources').mockImplementation(async (...args) => {
        authorities.push(args[3]);
        return originalCapture(...args);
    });
    const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
        for (const previous of scopes) {
            expect(() => previous.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
            await expect(previous.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        }
        expect(authorities).toHaveLength(1);
        expect(args[2]).not.toBe(authorities[0]);
        expect(args[2].assertAuthority).not.toBe((authorities[0] as typeof args[2]).assertAuthority);
        expect(args[3]).toBeTypeOf('function');
        scopes.push(args[2]);
        return compare.apply(this, args);
    });
    const f = await fixture(context), before = await f.preserved();
    const result = await f.start();
    expect(scopes).toHaveLength(3);
    expect(new Set(scopes).size).toBe(3);
    for (const scope of scopes)
        expect(() => scope.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(result.journal.phase).toBe('authorized');
    expect(result.journal.inventory.recordCount).toBe(1);
    expect(await f.preserved()).toEqual(before);
}, 10_000);
for (const mode of ['success', 'sourceFailure'] as const) {
  it(`confines the inventory callback during source-owned wait: ${mode}`, mode === 'success' ? { timeout: 10_000 } : {}, async context => {
    const entered = privateScopeGate(), releaseSource = privateScopeGate(), closeEntered = privateScopeGate(), releaseClose = privateScopeGate();
    const first = new Error('SYNTHETIC_OPAQUE_SOURCE_FAILURE');
    let comparisons = 0, held = false, failed = false, sourceWaiting = false, reads = 0, writes = 0, settled = false;
    let activeInventoryIo = 0, installedDirectories = false;
    const prohibitedIo: string[] = [];
    const observeIo = async <T>(name: string, work: () => Promise<T>) => {
        if (sourceWaiting) {
            prohibitedIo.push(name);
            throw new Error('SYNTHETIC_INVENTORY_IO_DURING_SOURCE_WAIT');
        }
        activeInventoryIo++;
        try {
            return await work();
        }
        finally {
            activeInventoryIo--;
        }
    };
    let currentScope!: {
        assertAuthority(): void;
        assertExternalSelection(): Promise<void>;
    };
    let sourceAuthority: unknown;
    const originalCapture = sourceFactory.captureWorkspaceDeletionInventorySources;
    vi.spyOn(sourceFactory, 'captureWorkspaceDeletionInventorySources').mockImplementation(async (...args) => {
        sourceAuthority = args[3];
        const source = await originalCapture(...args);
        return Object.freeze({ ...source, async *records(...readArgs: Parameters<typeof source.records>) {
                const inner = source.records(...readArgs);
                try {
                    while (true) {
                        if (comparisons === 1 && !held) {
                            expect(activeInventoryIo).toBe(0);
                            held = true;
                            sourceWaiting = true;
                            entered.release();
                            try {
                                await releaseSource.promise;
                            }
                            finally {
                                sourceWaiting = false;
                            }
                            if (mode === 'sourceFailure') {
                                failed = true;
                                throw first;
                            }
                        }
                        const next = await inner.next();
                        if (next.done)
                            return;
                        yield next.value;
                    }
                }
                finally {
                    await inner.return(undefined);
                }
            } });
    });
    const originalOpen = inventoryFiles.openWorkspaceDeletionInventoryFile;
    vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
        const file = await observeIo('open', () => originalOpen(...args));
        return { ...file,
            stat: () => observeIo('handleStat', () => file.stat()),
            async read(...values) { reads++; return observeIo('read', () => file.read(...values)); },
            async write(...values) { writes++; return observeIo('write', () => file.write(...values)); },
            sync: () => observeIo('sync', () => file.sync()),
            close: () => observeIo('close', async () => {
                if (failed) {
                    closeEntered.release();
                    await releaseClose.promise;
                }
                return file.close();
            }),
        };
    });
    const inspectPath = inventoryFiles.inspectDeletionInventoryFile;
    vi.spyOn(inventoryFiles, 'inspectDeletionInventoryFile').mockImplementation((...args) => observeIo('pathStat', () => inspectPath(...args)));
    const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
        if (!installedDirectories) {
            installedDirectories = true;
            const directories = Reflect.get(this, 'directories') as typeof inventoryFiles.workspaceDeletionInventoryDirectoryReads;
            Reflect.set(this, 'directories', {
                identity: (...values: Parameters<typeof directories.identity>) => observeIo('directoryIdentity', () => directories.identity(...values)),
                names: (...values: Parameters<typeof directories.names>) => observeIo('directoryNames', () => directories.names(...values)),
            });
        }
        comparisons++;
        currentScope = args[2];
        expect(currentScope).not.toBe(sourceAuthority);
        return compare.apply(this, args);
    });
    const f = await fixture(context), before = await f.preserved();
    const work = f.start().then(value => value, error => error).finally(() => { settled = true; });
    context.onTestFinished(async () => { releaseSource.release(); releaseClose.release(); await work; });
    try {
        await Promise.race([entered.promise, work.then(() => { throw new Error('SOURCE_WAIT_NOT_ENTERED'); })]);
        expect(settled).toBe(false);
        expect(comparisons).toBe(1);
        expect(activeInventoryIo).toBe(0);
        expect(prohibitedIo).toEqual([]);
        expect(f.backup).not.toHaveBeenCalled();
        await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
        releaseSource.release();
        if (mode === 'sourceFailure') {
            await Promise.race([closeEntered.promise, work.then(() => { throw new Error('INVENTORY_CLOSE_NOT_ENTERED'); })]);
            expect(settled).toBe(false);
            expect(() => currentScope.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
            await expect(currentScope.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        }
    }
    finally {
        releaseSource.release();
        releaseClose.release();
    }
    const result = await work;
    expect(prohibitedIo).toEqual([]);
    expect(activeInventoryIo).toBe(0);
    if (mode === 'sourceFailure') {
        expect(result).toBe(first);
        await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(f.journal.nextPath)).not.toHaveLength(0);
    }
    else {
        expect(result.journal.phase).toBe('authorized');
        expect(comparisons).toBe(3);
    }
    expect(await f.preserved()).toEqual(before);
});
}
it("rejects a registry side slot added during the final inventory close", async (context) => {
    const f = await fixture(context), before = await f.preserved();
    let comparisons = 0, changed = false;
    let committed: Awaited<ReturnType<WorkspaceDeletionJournalStore['inspect']>>['slots']['current'];
    let thirdScope!: {
        assertAuthority(): void;
        assertExternalSelection(): Promise<void>;
    };
    const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
        comparisons++;
        if (comparisons === 3)
            thirdScope = args[2];
        return compare.apply(this, args);
    });
    const originalOpen = inventoryFiles.openWorkspaceDeletionInventoryFile;
    vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
        const file = await originalOpen(...args);
        return { ...file, async close() {
                await file.close();
                if (comparisons === 3 && !changed) {
                    committed = (await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard)).slots.current;
                    expect(committed?.identity).toBeDefined();
                    changed = true;
                    await writeFile(`${f.registryPath}.next`, f.registryBytes, { flag: 'wx' });
                }
            } };
    });
    await expect(f.start()).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
    expect(changed).toBe(true);
    expect(comparisons).toBe(3);
    const retained = (await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard)).slots;
    expect(Buffer.from(retained.current!.bytes)).toEqual(Buffer.from(committed!.bytes));
    expect(retained.current!.identity).toEqual(committed!.identity);
    expect(retained.next).toBeUndefined();
    expect(retained.backup).toBeUndefined();
    expect(() => thirdScope.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    await expect(thirdScope.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect((await readFile(`${f.registryPath}.next`)).equals(f.registryBytes)).toBe(true);
    expect(await f.preserved()).toEqual(before);
}, 10_000);

it.for(['active', 'selector', 'handoff'] as const)('source comparison publication forwards scoped authority through %s', async (route, context) => {
    const f = await fixture(context, route === 'active' ? 'active' : 'selector');
    const original = sourceFactory.captureWorkspaceDeletionInventorySources;
    const ports: {
        assertAuthority(): void;
    }[] = [];
    let initialCaptures = 0, ordinaryConsumptions = 0, forwarded = 0;
    vi.spyOn(sourceFactory, 'captureWorkspaceDeletionInventorySources').mockImplementation(async (...args) => {
        initialCaptures++;
        const source = await original(...args);
        return Object.freeze({ ...source, records(...values: Parameters<typeof source.records>) {
                const port = (values as unknown[])[0] as undefined | {
                    assertAuthority(): void;
                };
                if (port === undefined)
                    ordinaryConsumptions++;
                else {
                    ports.push(port);
                    forwarded++;
                    port.assertAuthority();
                }
                return source.records(...values);
            } });
    });
    let afterHandoff = false, preRead = 0, postRead = 0;
    const publish = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
        assertWritersAbsent: f.assertWritersAbsent,
        ...(route === 'handoff' ? { async beforeJournalPublication() { afterHandoff = true; } } : {}) });
    const read = async () => {
        if (afterHandoff)
            postRead++;
        else
            preRead++;
        await f.assertReadOwned();
    };
    const result = await f.start(publish, read);
    const comparisons = route === 'handoff' ? 4 : 3;
    expect(initialCaptures).toBe(1);
    expect(result.journal.phase).toBe('authorized');
    expect(forwarded).toBe(comparisons);
    expect(ordinaryConsumptions).toBe(1);
    expect(new Set(ports).size).toBe(comparisons);
    for (const port of ports)
        expect(() => port.assertAuthority()).toThrow();
    expect(preRead).toBeGreaterThan(0);
    if (route === 'handoff')
        expect(postRead).toBeGreaterThan(0);
    await f.preserved();
});

type InitialPublicationReadPort = {
  assertBeforeSlotRead(): Promise<void>;
};
it.for(['active', 'selector', 'handoff'] as const)('initial publication keeps complete publication boundaries through %s', async (route, context) => {
  const f = await fixture(context, route === 'active' ? 'active' : 'selector');
  const observations: string[] = [];
  let currentPort: InitialPublicationReadPort | undefined, insideJournal = false;
  let journalReadChecks = 0, journalFullChecks = 0;
  const readOwned = async () => {
    if (insideJournal) journalReadChecks++;
    await f.assertReadOwned();
  };
  const compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    observations.push('sources');
    if (!insideJournal && currentPort !== undefined) {
      const reads = journalReadChecks;
      await expect(currentPort.assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(journalReadChecks).toBe(reads);
    }
    return compare.apply(this, args);
  });
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    currentPort = (args as unknown[])[3] as InitialPublicationReadPort | undefined;
    const selected = args[1];
    const values: Parameters<typeof original> = [args[0], {
      ...selected, async assertExternalSelection() {
        journalFullChecks++;
        return selected.assertExternalSelection();
      },
    }, args[2], args[3]];
    insideJournal = true;
    try {
      return await original.apply(this, values);
    }
    finally {
      insideJournal = false;
    }
  });
  f.backup.mockImplementation(async () => { observations.push('backup'); });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent,
    ...(route === 'handoff' ? { async beforeJournalPublication() { observations.push('handoff'); } } : {}) });
  const result = await f.start(publisher, readOwned);
  expect(observations).toEqual(route === 'handoff'
    ? ['sources', 'handoff', 'sources', 'backup', 'sources', 'sources']
    : ['sources', 'backup', 'sources', 'sources']);
  expect(result.journal.phase).toBe('authorized');
  expect(result.journal.inventory.recordCount).toBe(1);
  expect(journalFullChecks).toBeGreaterThan(0);
  expect(journalReadChecks).toBeGreaterThan(0);
  expect(currentPort !== undefined).toBe(true);
  if (currentPort !== undefined)
    await expect(currentPort.assertBeforeSlotRead()).rejects.toThrow();
  const selected = await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard);
  expect(selected.plan.mode).toBe('published');
  expect(selected.slots.next).toBeUndefined();
  expect(selected.slots.backup).toBeUndefined();
  expect(await readFile(f.journal.currentPath)).toEqual(Buffer.from(selected.slots.current!.bytes));
  await f.preserved();
});
it('initial publication preserves the portless path without a writer-only fallback', { timeout: 10_000 }, async (context) => {
  const f = await fixture(context);
  let argsSeen = 0;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(function (this: WorkspaceDeletionJournalStore, ...args) {
    argsSeen++;
    expect((args as unknown[])[3]).toBeUndefined();
    return original.apply(this, args);
  });
  expect((await f.start()).journal.phase).toBe('authorized');
  expect(argsSeen).toBe(1);
  await f.preserved();
});
it.for(['registry', 'writers'] as const)('initial publication rejects a persistent %s change before journal mutation', async (change, context) => {
  const f = await fixture(context);
  let insideJournal = false, changed = false;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    insideJournal = true;
    try {
      return await original.apply(this, args);
    }
    finally {
      insideJournal = false;
    }
  });
  const readOwned = async () => {
    if (insideJournal && !changed) {
      changed = true;
      if (change === 'registry')
        await writeFile(f.registryPath + '.next', f.registryBytes, { flag: 'wx' });
      else
        f.writerAppeared();
    }
    await f.assertReadOwned();
  };
  await expect(f.start(undefined, readOwned)).rejects.toThrow();
  expect(changed).toBe(true);
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(f.journal.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.inventory.currentPath)).not.toHaveLength(0);
  if (change === 'registry')
    expect(await readFile(f.registryPath + '.next')).toEqual(f.registryBytes);
  await f.preserved();
});
it('initial publication joins a held owner check before returning authority loss', async (context) => {
  const f = await fixture(context), entered = privateScopeGate(), release = privateScopeGate();
  let insideJournal = false, held = false, settled = false;
  let currentPort: InitialPublicationReadPort | undefined;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    insideJournal = true;
    currentPort = (args as unknown[])[3] as InitialPublicationReadPort | undefined;
    try {
      return await original.apply(this, args);
    }
    finally {
      insideJournal = false;
    }
  });
  const readOwned = async () => {
    if (insideJournal && !held) {
      held = true;
      entered.release();
      await release.promise;
    }
    await f.assertReadOwned();
  };
  const work = f.start(undefined, readOwned).then(value => ({ succeeded: true, value }), cause => ({ succeeded: false, cause })).finally(() => { settled = true; });
  const abort = () => release.release();
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('SYNTHETIC_PUBLICATION_READ_NOT_ENTERED'); })]);
    f.revoke();
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  finally {
    release.release();
    await work;
    context.signal.removeEventListener('abort', abort);
  }
  expect((await work).succeeded).toBe(false);
  if (currentPort !== undefined)
    await expect(currentPort.assertBeforeSlotRead()).rejects.toThrow();
  await f.preserved();
});
it.for(['undefinedFailure', 'invalidResult'] as const)('initial publication retains %s without publishing current', async (kind, context) => {
  const f = await fixture(context);
  let insideJournal = false, observed = false;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    insideJournal = true;
    try {
      return await original.apply(this, args);
    }
    finally {
      insideJournal = false;
    }
  });
  const readOwned = async () => {
    await f.assertReadOwned();
    if (insideJournal) {
      observed = true;
      if (kind === 'undefinedFailure')
        throw undefined;
      return false as never;
    }
  };
  const result = await f.start(undefined, readOwned).then(value => ({ succeeded: true as const, value }), cause => ({ succeeded: false as const, cause }));
  expect(observed).toBe(true);
  expect(result.succeeded).toBe(false);
  if (kind === 'undefinedFailure' && !result.succeeded)
    expect(result.cause).toBeUndefined();
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});
it.for(['error', 'undefined'] as const)('initial publication preserves latched %s through native write normalization and close failure', async (kind, context) => {
  const f = await fixture(context);
  const first = kind === 'error' ? new Error('SYNTHETIC_INITIAL_PUBLICATION_OWNER_FAILURE') : undefined;
  const later = new Error('SYNTHETIC_INITIAL_PUBLICATION_CLOSE_FAILURE');
  let failOwner = false, writeEntered = false, closed = false;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(function (this: WorkspaceDeletionJournalStore, ...args) {
    const fileSystem = Reflect.get(this, 'fileSystem') as import('../persistence/crashSafeFileSlot.js').CrashSafeFileSlotFileSystem;
    const create = fileSystem.createNextWriter.bind(fileSystem);
    fileSystem.createNextWriter = async (guard) => {
      const writer = await create(guard);
      return { async write(bytes) {
          writeEntered = true;
          failOwner = true;
          return writer.write(bytes);
        }, sync: writer.sync.bind(writer),
        ...(writer.readIdentity === undefined ? {} : { readIdentity: writer.readIdentity.bind(writer) }),
        async close() { await writer.close(); closed = true; throw later; } };
    };
    return original.apply(this, args);
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry, assertWritersAbsent: f.assertWritersAbsent });
  const request: typeof publisher = (check, ...rest) => publisher(() => {
    check();
    if (failOwner)
      throw first;
  }, ...rest);
  const result = await f.start(request, f.assertReadOwned).then(() => ({ succeeded: true as const }), cause => ({ succeeded: false as const, cause }));
  expect(result.succeeded).toBe(false);
  expect(writeEntered).toBe(true);
  expect(closed).toBe(true);
  if (result.succeeded)
    throw new Error('SYNTHETIC_EXPECTED_INITIAL_PUBLICATION_FAILURE');
  expect(result.cause).toBeInstanceOf(AggregateError);
  const aggregate = result.cause as AggregateError;
  const lower = aggregate.errors[1] as AggregateError;
  expect(aggregate.errors[0]).toBe(first);
  expect(lower).toBeInstanceOf(AggregateError);
  expect(lower.errors).toHaveLength(2);
  expect(lower.errors[0]).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'unavailable' });
  expect(lower.errors[1]).toBe(later);
  expect(await readFile(f.journal.nextPath)).toHaveLength(0);
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});
it('initial publication rejects malformed writers results only at the new read boundary', async (context) => {
  const f = await fixture(context);
  let insideJournal = false, seen = 0;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    insideJournal = true;
    try {
      return await original.apply(this, args);
    }
    finally {
      insideJournal = false;
    }
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() {
      await f.assertWritersAbsent();
      if (insideJournal) {
        seen++;
        return false as never;
      }
    } });
  const result = await f.start(publisher, f.assertReadOwned).then(() => ({ succeeded: true as const }), cause => ({ succeeded: false as const, cause }));
  expect(seen).toBeGreaterThan(0);
  expect(result.succeeded).toBe(false);
  await expect(readFile(f.journal.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved();
});
it('initial publication distinguishes an actual transient original import journal', async (context) => {
  const f = await fixture(context);
  const { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } = await import('../import/workspaceBackupImportJournalPaths.js');
  const path = join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const bytes = Buffer.from('synthetic transient original import journal');
  let inserted = false, restored = false;
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    inserted = true;
    const fileSystem = Reflect.get(this, 'fileSystem') as import('../persistence/crashSafeFileSlot.js').CrashSafeFileSlotFileSystem;
    const read = fileSystem.readSlot.bind(fileSystem);
    fileSystem.readSlot = async (...values) => {
      if (!restored) {
        await rm(path);
        restored = true;
      }
      return read(...values);
    };
    return original.apply(this, args);
  });
  const result = await f.start(undefined, f.assertReadOwned).then(() => ({ succeeded: true as const }), cause => ({ succeeded: false as const, cause }));
  expect(inserted).toBe(true);
  expect(restored).toBe(true);
  expect(result.succeeded).toBe(true);
  {
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard)).plan.mode).toBe('published');
  }
  await f.preserved();
});
it('initial publication cannot use a failed old callback to poison the next publication', { timeout: 10_000 }, async (context) => {
  const first = await fixture(context), next = await fixture(context);
  let oldPort: InitialPublicationReadPort | undefined, currentPort: InitialPublicationReadPort | undefined;
  let insideFirst = false, firstReads = 0;
  const failure = new Error('SYNTHETIC_FIRST_PUBLICATION_READ_FAILURE');
  const original = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const port = (args as unknown[])[3] as InitialPublicationReadPort | undefined;
    if (oldPort === undefined && currentPort === undefined) {
      oldPort = port;
      insideFirst = true;
      try {
        return await original.apply(this, args);
      }
      finally {
        insideFirst = false;
      }
    }
    currentPort = port;
    if (oldPort !== undefined) {
      const reads = firstReads;
      await expect(oldPort.assertBeforeSlotRead()).rejects.toThrow();
      expect(firstReads).toBe(reads);
      expect(currentPort).not.toBe(oldPort);
    }
    return original.apply(this, args);
  });
  const result = await first.start(undefined, async () => {
    firstReads++;
    if (insideFirst)
      throw failure;
    await first.assertReadOwned();
  }).then(() => ({ succeeded: true }), cause => ({ succeeded: false, cause }));
  expect(result.succeeded).toBe(false);
  const succeeded = await next.start(undefined, next.assertReadOwned);
  expect(succeeded.journal.phase).toBe('authorized');
  {
    expect(oldPort).toBeDefined();
    expect(currentPort).toBeDefined();
    await expect(oldPort!.assertBeforeSlotRead()).rejects.toThrow();
    await expect(currentPort!.assertBeforeSlotRead()).rejects.toThrow();
  }
  await first.preserved();
  await next.preserved();
});
it('initial publication preserves an unlatched aggregate unchanged', async (context) => {
  const f = await fixture(context);
  const first = new Error('SYNTHETIC_UNLATCHED_PUBLICATION_WRITE');
  const close = new Error('SYNTHETIC_UNLATCHED_PUBLICATION_CLOSE');
  const failure = new AggregateError([first, close], 'SYNTHETIC_UNLATCHED_PUBLICATION_FAILURE');
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockRejectedValue(failure);
  await expect(f.start(undefined, f.assertReadOwned)).rejects.toBe(failure);
  expect(failure.errors).toEqual([first, close]);
  for (const path of [f.journal.currentPath, f.journal.nextPath, f.journal.backupPath]) {
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expect(await readFile(f.inventory.currentPath)).not.toHaveLength(0);
  await f.preserved();
});

function recoveryComparisonPhases() {
  const state = { ordinal: 0, inside: false, outer: 0, completed: 0 };
  const observe = (event: WorkspaceDeletionPublicationPhaseEvent) => {
    if (event.phase === 'sourceComparison') {
      if (event.event === 'entered') { state.ordinal++; state.inside = true; state.outer = 0; }
      else { if (event.event === 'fulfilled') state.completed++; state.inside = false; state.outer = 0; }
    } else if (state.inside && event.phase === 'fullSelection' && event.event === 'entered') state.outer++;
  };
  return { state, observe };
}

type PublicationFixture = Awaited<ReturnType<typeof fixture>>;
function startRecoveryPublication(f: PublicationFixture, publisher: ReturnType<typeof createWorkspaceDeletionPublisher>, options: {
  readOwned?: () => Promise<void>;
  guard?: (original: () => void) => void;
  preparation?: (original: () => Promise<void>) => Promise<void>;
} = {}) {
  const request: typeof publisher = function (this: unknown, ...args) {
    const forwarded: Parameters<typeof publisher> = [...args];
    const originalGuard = args[0], originalPreparation = args[4];
    forwarded[0] = () => options.guard === undefined ? originalGuard() : options.guard(originalGuard);
    // This fixture proves publisher routing, not Main's real recovery transfer.
    forwarded[6] = args[0];
    if (options.preparation !== undefined) {
      forwarded[4] = () => options.preparation!(() => Reflect.apply(originalPreparation, this, []));
    }
    return Reflect.apply(publisher, this, forwarded);
  };
  return f.start(request, options.readOwned ?? f.assertReadOwned);
}

async function publicationSlots(f: PublicationFixture) {
  return (await new WorkspaceDeletionJournalStore(f.root).inspect(f.guard)).slots;
}

async function assertPublicationPreserved(f: PublicationFixture,
  current: Awaited<ReturnType<PublicationFixture['registry']['inspectSlots']>>['current']) {
  const after = await f.registry.inspectSlots(f.guard);
  expect(after.current?.identity).toEqual(current?.identity);
  expect(Buffer.from(after.current!.bytes).equals(f.registryBytes)).toBe(true);
  // Compare the actual root without reviving a receipt invalidated by the injected conflict.
  const paths = deriveWorkspaceRoot(f.root, f.selected.target.workspaceId, 1);
  f.guard(); await inspectWorkspaceRoot(paths); f.guard();
  expect(await readWorkspaceProcessReservationIdentity(paths.workspaceRoot)).toBe(f.selected.target.rootIdentity);
  f.guard(); await inspectWorkspaceRoot(paths); f.guard();
  await f.preserved();
}

function capturePublicationCause(work: () => void) {
  try { work(); return { threw: false as const }; }
  catch (cause) { return { threw: true as const, cause }; }
}

it.for(['recoveryHandoff', 'seventhWithoutHandoff', 'handoffWithoutSeventh'] as const)(
  'recovery comparison brackets full selection without a repeated prefix: %s', async (route, test) => {
  const f = await fixture(test, 'selector'), phases = recoveryComparisonPhases();
  const withHandoff = route !== 'seventhWithoutHandoff', withSeventh = route !== 'handoffWithoutSeventh';
  const counts: { preparation: number; originals: number; fullSelections: number }[] = [];
  const capture = originalJournalSelections.captureWorkspaceDeletionOriginalJournals;
  let captured: Awaited<ReturnType<typeof capture>> | undefined;
  vi.spyOn(originalJournalSelections, 'captureWorkspaceDeletionOriginalJournals').mockImplementation(async function (this: unknown, ...args) {
    const selected = await Reflect.apply(capture, this, args); captured = selected;
    return Object.freeze({ ...selected, async assertSelected() {
      if (phases.state.inside) counts[phases.state.ordinal - 1]!.originals++;
      await selected.assertSelected();
    } });
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent,
    ...(withHandoff ? { async beforeJournalPublication() {} } : {}),
    observePublicationPhase(event) {
      phases.observe(event);
      if (event.phase === 'sourceComparison' && event.event === 'entered')
        counts.push({ preparation: 0, originals: 0, fullSelections: 0 });
      if (event.phase === 'fullSelection' && event.event === 'entered' && phases.state.inside)
        counts[phases.state.ordinal - 1]!.fullSelections++;
    } });
  const request: typeof publisher = function (this: unknown, ...args) {
    const forwarded: Parameters<typeof publisher> = [...args], preparation = args[4];
    forwarded[4] = async () => {
      if (phases.state.inside) counts[phases.state.ordinal - 1]!.preparation++;
      await Reflect.apply(preparation, this, []);
    };
    if (withSeventh) forwarded[6] = args[0];
    return Reflect.apply(publisher, this, forwarded);
  };
  const result = await f.start(request, f.assertReadOwned);
  const expected = withHandoff && withSeventh ? [14, 10, 10, 10] : withHandoff ? [14, 14, 14, 14] : [14, 14, 14];
  expect(counts.map(value => value.preparation)).toEqual(expected);
  expect(counts.map(value => value.originals)).toEqual(expected.map(() => 4));
  expect(counts.map(value => value.fullSelections)).toEqual(expected.map(() => 2));
  expect(phases.state.completed).toBe(expected.length);
  await expect(captured!.assertSelected()).rejects.toThrow();
  const slots = await publicationSlots(f);
  expect(slots.next).toBeUndefined(); expect(slots.backup).toBeUndefined();
  expect(Buffer.from(slots.current!.bytes)).toEqual(serializeWorkspaceDeletionJournal(result.journal));
  expect(result.journal.inventory.recordCount).toBe(1); await f.preserved();
});

it.for([
  ['originalRead', 'registry'], ['originalRead', 'originalJournal'],
  ['inventoryClose', 'registry'], ['inventoryClose', 'originalJournal'],
] as const)('recovery comparison rejects a persistent %s %s change after joining the read', async ([boundary, change], test) => {
  const f = await fixture(test, 'selector'), phases = recoveryComparisonPhases();
  const registryBefore = (await f.registry.inspectSlots(f.guard)).current;
  const entered = privateScopeGate(), release = privateScopeGate();
  const path = change === 'registry' ? f.registryPath + '.next' : join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const changedBytes = change === 'registry' ? f.registryBytes : Buffer.from('synthetic persistent original journal conflict');
  let held = false, settled = false, activeDelegates = 0;
  const originalRead = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementation(async function (this: WorkspaceBackupImportJournalStore, ...args) {
    activeDelegates++;
    try {
      if (boundary === 'originalRead' && phases.state.inside && phases.state.ordinal === 2 && phases.state.outer === 2 && !held) {
        held = true; entered.release(); await release.promise;
      }
      return await Reflect.apply(originalRead, this, args);
    } finally { activeDelegates--; }
  });
  const originalOpen = inventoryFiles.openWorkspaceDeletionInventoryFile;
  vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await Reflect.apply(originalOpen, inventoryFiles, args);
    return { ...file, async close() {
      activeDelegates++;
      try {
        if (boundary === 'inventoryClose' && phases.state.inside && phases.state.ordinal === 2 && !held && args[1] === 'r') {
          held = true; entered.release(); await release.promise;
        }
        await file.close();
      } finally { activeDelegates--; }
    } };
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, observePublicationPhase: phases.observe,
    async beforeJournalPublication() {} });
  const work = startRecoveryPublication(f, publisher).then(value => ({ ok: true as const, value }), cause => ({ ok: false as const, cause }))
    .finally(() => { settled = true; });
  const abort = () => release.release(); test.signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([entered.promise, work.then(() => { throw new Error('PUBLICATION_HOLD_NOT_REACHED'); })]);
    const before = await publicationSlots(f);
    expect(before.current).toBeUndefined(); expect(before.next?.identity).toBeDefined();
    await writeFile(path, changedBytes, { flag: 'wx', mode: 0o600 });
    await Promise.resolve(); expect(settled).toBe(false); expect(activeDelegates).toBeGreaterThan(0);
    release.release(); expect((await work).ok).toBe(false);
    expect(phases.state.completed).toBe(1); expect(await publicationSlots(f)).toEqual(before);
    expect(activeDelegates).toBe(0); expect(await readFile(path)).toEqual(changedBytes);
    await assertPublicationPreserved(f, registryBefore);
    if (change === 'registry') expect(() => f.selected.assertValid()).toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  } finally { release.release(); await work; test.signal.removeEventListener('abort', abort); }
});

it.for(['rename', 'sync'] as const)('recovery comparison preserves the final %s guard and physical effects', async (boundary, test) => {
  const f = await fixture(test, 'selector'), phases = recoveryComparisonPhases();
  const registryBefore = (await f.registry.inspectSlots(f.guard)).current;
  const events: SlotIoEvent[] = [];
  let injected = false, before: Awaited<ReturnType<typeof publicationSlots>> | undefined, eventCut = 0;
  const originalPublish = WorkspaceDeletionJournalStore.prototype.publish;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(function (this: WorkspaceDeletionJournalStore, ...args) {
    const fs = Reflect.get(this, 'fileSystem') as CrashSafeFileSlotFileSystem;
    const originalMove = fs.moveSlot.bind(fs), originalSync = fs.syncDirectory.bind(fs);
    fs.moveSlot = async (source, destination, guard) => {
      if (boundary === 'rename') {
        expect(phases.state.completed).toBe(3);
        before = await publicationSlots(f); eventCut = events.length;
        expect(before.current).toBeUndefined(); expect(before.next?.identity).toBeDefined();
        expect(guard).toBeDefined();
        return originalMove(source, destination, { ...guard!, async beforeMutation() {
          if (!injected) { injected = true; await writeFile(f.registryPath + '.next', f.registryBytes, { flag: 'wx' }); }
          await guard!.beforeMutation();
        } });
      }
      return originalMove(source, destination, guard);
    };
    fs.syncDirectory = async guard => {
      if (boundary === 'sync' && phases.state.completed === 3 && !injected) {
        before = await publicationSlots(f); eventCut = events.length;
        expect(before.current?.identity).toBeDefined(); expect(before.next).toBeUndefined();
        expect(guard).toBeDefined();
        return originalSync({ ...guard!, async beforeMutation() {
          injected = true; await writeFile(f.registryPath + '.next', f.registryBytes, { flag: 'wx' });
          await guard!.beforeMutation();
        } });
      }
      return originalSync(guard);
    };
    return Reflect.apply(originalPublish, this, args);
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, observePublicationPhase: phases.observe,
    observeSlotIo: event => events.push(event), async beforeJournalPublication() {} });
  await expect(startRecoveryPublication(f, publisher)).rejects.toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
  expect(injected).toBe(true); expect(before).toBeDefined(); expect(await publicationSlots(f)).toEqual(before);
  const mutations = (values: SlotIoEvent[]) => values.filter(event => event.scope === 'ioAttempt' && event.event === 'entered' &&
    ['fileWrite', 'fileSync', 'pathRename', 'pathRemove'].includes(event.operation));
  expect(mutations(events.slice(eventCut))).toEqual([]);
  expect(mutations(events).filter(event => event.operation === 'pathRename')).toHaveLength(boundary === 'sync' ? 1 : 0);
  expect(await readFile(f.registryPath + '.next')).toEqual(f.registryBytes);
  await assertPublicationPreserved(f, registryBefore);
  expect(() => f.selected.assertValid()).toThrow('WORKSPACE_DELETE_STALE_CONFIRMATION');
});

it.for(['error', 'undefined'] as const)('recovery comparison retains exact %s through iterator and file close failures', async (kind, test) => {
  const f = await fixture(test, 'selector'), phases = recoveryComparisonPhases();
  const first = kind === 'error' ? new Error('SYNTHETIC_SOURCE_FAILURE') : undefined;
  const returnFailure = new Error('SYNTHETIC_ITERATOR_RETURN_FAILURE'), closeFailure = new Error('SYNTHETIC_FILE_CLOSE_FAILURE');
  const closeEntered = privateScopeGate(), releaseClose = privateScopeGate();
  let failed = false, settled = false, activeDelegates = 0, iteratorClosed = 0, fileClosed = 0;
  let port: Parameters<WorkspaceDeletionInventoryStore['assertRecords']>[2] | undefined;
  let comparisonFailure: unknown;
  const originalSources = sourceFactory.captureWorkspaceDeletionInventorySources;
  vi.spyOn(sourceFactory, 'captureWorkspaceDeletionInventorySources').mockImplementation(async function (this: unknown, ...args) {
    const selected = await Reflect.apply(originalSources, this, args);
    return Object.freeze({ ...selected, records(...values: Parameters<typeof selected.records>) {
      const inner = Reflect.apply(selected.records, selected, values);
      if (!phases.state.inside || phases.state.ordinal !== 2) return inner;
      const originalNext = inner.next, originalReturn = inner.return;
      inner.next = async (...nextArgs) => {
        activeDelegates++;
        try { await Reflect.apply(originalNext, inner, nextArgs); failed = true; throw first; }
        finally { activeDelegates--; }
      };
      inner.return = async (...returnArgs) => {
        activeDelegates++;
        try { await Reflect.apply(originalReturn, inner, returnArgs); iteratorClosed++; throw returnFailure; }
        finally { activeDelegates--; }
      };
      return inner;
    } });
  });
  const originalCompare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    if (phases.state.ordinal === 2) port = args[2];
    try { return await Reflect.apply(originalCompare, this, args); }
    catch (cause) { if (phases.state.ordinal === 2) comparisonFailure = cause; throw cause; }
  });
  const originalOpen = inventoryFiles.openWorkspaceDeletionInventoryFile;
  vi.spyOn(inventoryFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await Reflect.apply(originalOpen, inventoryFiles, args);
    return { ...file, async close() {
      if (!failed) return file.close();
      activeDelegates++; closeEntered.release();
      try { await releaseClose.promise; await file.close(); fileClosed++; throw closeFailure; }
      finally { activeDelegates--; }
    } };
  });
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, observePublicationPhase: phases.observe,
    async beforeJournalPublication() {} });
  const work = startRecoveryPublication(f, publisher).then(() => ({ ok: true as const }), cause => ({ ok: false as const, cause }))
    .finally(() => { settled = true; });
  const abort = () => releaseClose.release(); test.signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([closeEntered.promise, work.then(() => { throw new Error('PUBLICATION_FAILURE_CLOSE_NOT_REACHED'); })]);
    expect(settled).toBe(false); expect(iteratorClosed).toBe(1); expect(fileClosed).toBe(0);
    expect(capturePublicationCause(() => port!.assertAuthority())).toEqual({ threw: true, cause: first });
    const before = await publicationSlots(f);
    releaseClose.release(); const result = await work;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('SYNTHETIC_EXPECTED_PUBLICATION_FAILURE');
    expect(result.cause).toBe(comparisonFailure); expect(result.cause).toBeInstanceOf(AggregateError);
    const outer = result.cause as AggregateError;
    expect(outer.errors).toHaveLength(2); expect(outer.errors[1]).toBe(closeFailure);
    expect(outer.errors[0]).toBeInstanceOf(AggregateError);
    expect((outer.errors[0] as AggregateError).errors).toEqual([first, returnFailure]);
    expect(capturePublicationCause(() => port!.assertAuthority())).toEqual({ threw: true, cause: first });
    expect(fileClosed).toBe(1); expect(activeDelegates).toBe(0);
    expect(phases.state.completed).toBe(1); expect(await publicationSlots(f)).toEqual(before);
    await f.preserved(); await f.selected.assertRootCurrent();
  } finally { releaseClose.release(); await work; test.signal.removeEventListener('abort', abort); }
});

it.for(['restoredTransient', 'competingReadOwnedFailure'] as const)(
  'recovery comparison preserves the approved %s observation ordering', async (mode, test) => {
  const f = await fixture(test, 'selector'), phases = recoveryComparisonPhases();
  const registryBefore = (await f.registry.inspectSlots(f.guard)).current;
  const side = f.registryPath + '.next', competing = new Error('SYNTHETIC_COMPETING_READ_OWNED_FAILURE');
  let inserted = false, restoredInsideReadOwned = false, observedPrefix = false;
  const publisher = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
    assertWritersAbsent: f.assertWritersAbsent, observePublicationPhase: phases.observe,
    async beforeJournalPublication() {} });
  const result = await startRecoveryPublication(f, publisher, {
    guard(original) {
      original();
      if (phases.state.inside && phases.state.ordinal === 2 && !inserted) {
        writeFileSync(side, f.registryBytes, { flag: 'wx', mode: 0o600 }); inserted = true;
      }
    },
    async preparation(original) {
      if (inserted && !restoredInsideReadOwned && phases.state.inside && phases.state.ordinal === 2) observedPrefix = true;
      await original();
    },
    async readOwned() {
      if (inserted && phases.state.inside && phases.state.ordinal === 2 && !restoredInsideReadOwned) {
        if (mode === 'competingReadOwnedFailure') throw competing;
        await rm(side); restoredInsideReadOwned = true;
      }
      await f.assertReadOwned();
    },
  }).then(value => ({ ok: true as const, value }), cause => ({ ok: false as const, cause }));
  expect(inserted).toBe(true); expect(observedPrefix).toBe(false);
  if (mode === 'restoredTransient') {
    expect(result.ok).toBe(true); expect(restoredInsideReadOwned).toBe(true);
    expect(phases.state.completed).toBe(4); expect((await publicationSlots(f)).current?.identity).toBeDefined();
  } else {
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('SYNTHETIC_EXPECTED_PUBLICATION_FAILURE');
    expect(result.cause).toBe(competing); expect(phases.state.completed).toBe(1);
    const retained = await publicationSlots(f);
    expect(retained.current).toBeUndefined(); expect(retained.next?.identity).toBeDefined();
    expect(await readFile(side)).toEqual(f.registryBytes);
  }
  // Restore the intentional side slot only after every outcome assertion succeeds.
  await rm(side, { force: true });
  await expect(readFile(side)).rejects.toMatchObject({ code: 'ENOENT' });
  await assertPublicationPreserved(f, registryBefore);
});
