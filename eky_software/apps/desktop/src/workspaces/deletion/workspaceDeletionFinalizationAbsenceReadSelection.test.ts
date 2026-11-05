import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as retirement from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type AbsenceRead = typeof retirement.assertWorkspaceDeletionInventoryRetired;
interface AbsenceHooks {
  read?(work: AbsenceRead, args: Parameters<AbsenceRead>): ReturnType<AbsenceRead>;
  full?(clearing: boolean): Promise<void>;
}

async function absenceFixture(test: TestContext) {
  const f = await fixture(test, true, true);
  await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath);
  let clearing = false, stable = true, writerFailure: Error | undefined;
  const first = new Error('SYNTHETIC_JOURNAL_CLEAR_SELECTION_CHANGED'), hooks: AbsenceHooks = {};
  const events: string[] = [];
  const proof = f.fullProof.getMockImplementation();
  if (proof === undefined) throw new Error('SYNTHETIC_FULL_SELECTION_REQUIRED');
  f.fullProof.mockImplementation(async () => { await proof(); if (!stable) throw first; await hooks.full?.(clearing); });
  const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  const absent = retirement.assertWorkspaceDeletionInventoryRetired;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(async function (this: WorkspaceDeletionJournalStore, selection, terminal, readSelection) {
    const prefix = readSelection;
    if (prefix === undefined) throw new Error('TERMINAL_READ_PREFIX_NOT_FORWARDED');
    let prefixCalls = 0;
    const forwarded = { async assertBeforeSlotRead() { prefixCalls++; await prefix.assertBeforeSlotRead(); } };

    const external = selection.assertExternalSelection.bind(selection);
    clearing = true;
    try { return await clear.call(this, { ...selection, async assertExternalSelection() {
      events.push('selection.start'); await external(); events.push('selection.end');
    } }, terminal, forwarded); }
    finally { expect(prefixCalls).toBeGreaterThan(0); clearing = false; }
  });
  vi.spyOn(retirement, 'assertWorkspaceDeletionInventoryRetired').mockImplementation(async (...args) => {
    if (!clearing) return absent(...args);
    events.push('absence.start');
    await (hooks.read === undefined ? absent(...args) : hooks.read(absent, args));
    events.push('absence.end');
  });
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); if (writerFailure !== undefined) throw writerFailure; },
    assertStableSelection: f.fullProof });
  return { f, first, hooks, events,
    setStable(value: boolean) { stable = value; }, failWriter(error: Error) { writerFailure = error; },
    run() { return f.track(command(f.header.operationId, f.authority)); },
    async preserved() { expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes); await f.preserved(); },
  };
}

it('retains full selection bookends around every scoped physical-absence read', async test => {
  const t = await absenceFixture(test); let reads = 0;
  t.hooks.read = async (work, args) => {
    const before = t.f.fullProof.mock.calls.length;
    await work(...args); reads++; expect(t.f.fullProof.mock.calls.length).toBe(before);
  };
  await t.run(); expect(reads).toBeGreaterThan(0);
  expect(t.events.length).toBe(reads * 6);
  for (let at = 0; at < t.events.length; at += 6) expect(t.events.slice(at, at + 6)).toEqual([
    'selection.start', 'selection.end', 'absence.start', 'absence.end', 'selection.start', 'selection.end',
  ]);
  expect((await t.f.store.inspect(t.f.authority.assertCurrent)).plan.mode).toBe('absent'); await t.f.preserved();
});

it('characterizes modeled metadata restored wholly inside the physical-absence read', async test => {
  const t = await absenceFixture(test); let changed = false;
  t.hooks.read = async (work, args) => {
    if (changed) return work(...args);
    changed = true; t.setStable(false);
    try { return await work(...args); } finally { t.setStable(true); }
  };
  await t.run(); expect(changed).toBe(true); await t.f.preserved();
});

it('rejects sustained selection changes after the read and before journal removal', async test => {
  const t = await absenceFixture(test); let readCompleted = false;
  t.hooks.read = async (work, args) => { t.setStable(false); await work(...args); readCompleted = true; };
  await expect(t.run()).rejects.toBe(t.first); expect(readCompleted).toBe(true); await t.preserved();
});

it.for(['owner', 'writer'] as const)('detects lost %s inside the actual physical-absence callback', async (kind, test) => {
  const t = await absenceFixture(test), first = new Error('SYNTHETIC_ABSENCE_AUTHORITY_LOST'); let checked = false;
  t.hooks.read = (work, args) => {
    const authority = args[2], external = authority.assertExternalSelection.bind(authority);
    return work(args[0], args[1], { ...authority, async assertExternalSelection() {
      if (kind === 'owner') t.f.failAsyncOwner(first); else t.failWriter(first);
      await expect(external()).rejects.toBe(first); checked = true; throw first;
    } });
  };
  await expect(t.run()).rejects.toBe(first); expect(checked).toBe(true); await t.preserved();
});

it('expires the physical-absence callback before the next full check inside clear', async test => {
  const t = await absenceFixture(test); let saved: (() => Promise<void>) | undefined, returned = false, checked = false;
  t.hooks.read = async (work, args) => { saved ??= args[2].assertExternalSelection; await work(...args); returned = true; };
  t.hooks.full = async clearing => {
    if (saved !== undefined && returned && !checked) {
      expect(clearing).toBe(true); checked = true;
      await expect(saved()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    }
  };
  await t.run(); expect(checked).toBe(true); await t.f.preserved();
});

it('joins held physical-absence work before returning owner loss', async test => {
  const t = await absenceFixture(test); let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  t.hooks.read = (work, args) => {
    const authority = args[2], external = authority.assertExternalSelection.bind(authority);
    return work(args[0], args[1], { ...authority, async assertExternalSelection() { enter(); await gate; await external(); } });
  };
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_ABSENCE_NOT_ENTERED'); })]);
    t.f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await outcome; }
  expect(await outcome).toBe(t.f.first); await t.preserved();
});

it('retains the journal and a target binding returned after the physical-absence read', async test => {
  const t = await absenceFixture(test); let store: WorkspaceRemnantBindingStore | undefined;
  let before: Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>> | undefined;
  t.hooks.read = async (work, args) => {
    await work(...args);
    store = new WorkspaceRemnantBindingStore(t.f.root, { owner: 'workspaceImport', operationId: id(239) });
    await store.publish({ formatVersion: 1, owner: 'workspaceImport', operationId: id(239),
      workspaceId: t.f.header.workspaceId, lineageIdentity: t.f.header.lineageIdentity }, t.f.external);
    before = await store.inspect(t.f.external);
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); expect(before).toBeDefined();
  if (store === undefined) throw new Error('SYNTHETIC_RETURNED_BINDING_REQUIRED');
  expect(await store.inspect(t.f.external)).toEqual(before); await t.preserved();
});

it('retains returned original payload with its first owning error before journal removal', async test => {
  const t = await absenceFixture(test); let changed = false;
  const retained = join(t.f.originalPaths.candidateRoot, 'synthetic-retained');
  t.hooks.read = async (work, args) => {
    await work(...args); changed = true;
    await mkdir(t.f.originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
    await writeFile(retained, 'synthetic returned original', { flag: 'wx', mode: 0o600 });
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID'); expect(changed).toBe(true);
  expect(await readFile(retained, 'utf8')).toBe('synthetic returned original'); await t.preserved();
});

it('rejects a replaced inventory-parent identity during physical-absence checking', async test => {
  const t = await absenceFixture(test); let changed = false;
  const retained = join(t.f.root, 'retained-inventory-parent');
  t.hooks.read = async (work, args) => {
    changed = true; await rename(t.f.inventoryPaths.parentPath, retained);
    await mkdir(t.f.inventoryPaths.parentPath, { mode: 0o700 }); await work(...args);
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID'); expect(changed).toBe(true);
  expect(await readdir(retained)).toEqual([]); await t.preserved();
});
