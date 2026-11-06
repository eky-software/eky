import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import * as nativeReservation from '../../runtime/workspaceProcessReservation.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as retirement from './workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type AbsenceRead = typeof retirement.assertWorkspaceDeletionInventoryRetired;

async function postClearFixture(test: TestContext, options: { cold?: boolean; original?: boolean; retired?: boolean } = {}) {
  const f = await fixture(test, true, options.original ?? true);
  if (options.retired ?? true) { await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath); }
  let post = false, inside = false, writerFailure: Error | undefined;
  const modeled = { build: true, registry: true, foreign: true, metadata: true };
  const first = new Error('SYNTHETIC_POST_CLEAR_SELECTION_CHANGED');
  const hooks: {
    read?: (work: AbsenceRead, args: Parameters<AbsenceRead>) => ReturnType<AbsenceRead>;
    full?: () => Promise<void>;
  } = {};
  const events: string[] = [];
  const stats = { reads: 0, stableInside: 0, metadataInside: 0, ownerInside: 0, writerInside: 0 };
  const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const result = await clear.apply(this, args); post = true; events.push('clear.done'); return result;
  });
  const meta = metadata.assertWorkspaceDeletionMetadataAbsent;
  vi.spyOn(metadata, 'assertWorkspaceDeletionMetadataAbsent').mockImplementation((...args) => {
    if (post) events.push('metadata'); if (inside) stats.metadataInside++;
    return meta(...args);
  });
  f.fullProof.mockImplementation(async () => {
    f.authority.assertCurrent(); if (post) events.push('stable');
    if (inside) stats.stableInside++;
    if (Object.values(modeled).some(value => !value)) throw first;
    await hooks.full?.();
  });
  const absent = retirement.assertWorkspaceDeletionInventoryRetired;
  vi.spyOn(retirement, 'assertWorkspaceDeletionInventoryRetired').mockImplementation(async (...args) => {
    if (!post) return absent(...args);
    stats.reads++; inside = true; events.push('physical.start');
    try { return await (hooks.read === undefined ? absent(...args) : hooks.read(absent, args)); }
    finally { events.push('physical.end'); inside = false; }
  });
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
    if (inside) stats.ownerInside++; await f.authority.assertOwned();
  } };
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() {
      if (inside) stats.writerInside++; f.authority.assertCurrent(); if (writerFailure !== undefined) throw writerFailure;
    }, ...((options.cold ?? true) ? { assertStableSelection: f.fullProof } : {}) });
  return { f, first, hooks, events, stats, modeled, command,
    inside: () => inside, failWriter(error: Error) { writerFailure = error; },
    run() { return f.track(command(f.header.operationId, authority)); },
    async absent() { expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent'); await f.preserved(); },
  };
}

it('compares the exact final physical-read call graph', async test => {
  const t = await postClearFixture(test); await t.run(); expect(t.stats.reads).toBe(1);
  expect(t.stats.metadataInside).toBe(0);
  expect(t.stats.stableInside).toBe(0);
  expect(t.stats.ownerInside).toBe(4); expect(t.stats.writerInside).toBe(2);
  const full = ['stable', 'metadata', 'stable'];
  expect(t.events).toEqual(['clear.done', ...full, 'physical.start',
    'physical.end', ...full]);
  await t.absent();
});

it.for(['build', 'registry', 'foreign', 'metadata'] as const)(
  'characterizes modeled transient-restored %s', async (field, test) => {
    const t = await postClearFixture(test); let changed = false;
    t.hooks.read = async (work, args) => {
      changed = true; t.modeled[field] = false;
      try { return await work(...args); } finally { t.modeled[field] = true; }
    };
    await t.run();
    expect(changed).toBe(true); await t.absent();
  });

it.for(['build', 'registry', 'foreign', 'metadata'] as const)(
  'rejects sustained modeled %s after journal removal', async (field, test) => {
    const t = await postClearFixture(test); let physicalFinished = false;
    t.hooks.read = async (work, args) => { t.modeled[field] = false; await work(...args); physicalFinished = true; };
    await expect(t.run()).rejects.toBe(t.first);
    expect(physicalFinished).toBe(true); await t.absent();
  });

it.for(['owner', 'writer'] as const)('detects lost %s inside the real absence helper', async (kind, test) => {
  const t = await postClearFixture(test), first = new Error('SYNTHETIC_POST_CLEAR_AUTHORITY_LOST'); let checked = false;
  t.hooks.read = (work, args) => {
    const authority = args[2], external = authority.assertExternalSelection.bind(authority);
    return work(args[0], args[1], { ...authority, async assertExternalSelection() {
      if (kind === 'owner') t.f.failAsyncOwner(first); else t.failWriter(first);
      await expect(external()).rejects.toBe(first); checked = true; throw first;
    } });
  };
  await expect(t.run()).rejects.toBe(first); expect(checked).toBe(true); await t.absent();
});

it('rejects an actual persistent registry replacement at the trailing bookend', async test => {
  const t = await postClearFixture(test); let finished = false;
  t.hooks.read = async (work, args) => {
    await writeFile(t.f.registryPath, serializeWorkspaceRegistry(t.f.before)); await work(...args); finished = true;
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(finished).toBe(true);
  expect((await readFile(t.f.registryPath)).equals(Buffer.from(serializeWorkspaceRegistry(t.f.before)))).toBe(true);
  expect((await t.f.store.inspect(t.f.authority.assertCurrent)).plan.mode).toBe('absent');
});

it('preserves a real returned binding after journal removal', async test => {
  const t = await postClearFixture(test); let store: WorkspaceRemnantBindingStore | undefined;
  let observed: Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>> | undefined;
  t.hooks.read = async (work, args) => {
    await work(...args); store = new WorkspaceRemnantBindingStore(t.f.root, { owner: 'workspaceImport', operationId: id(239) });
    await store.publish({ formatVersion: 1, owner: 'workspaceImport', operationId: id(239),
      workspaceId: t.f.header.workspaceId, lineageIdentity: t.f.header.lineageIdentity }, t.f.external);
    observed = await store.inspect(t.f.external);
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(store).toBeDefined(); expect(observed).toBeDefined();
  expect(await store!.inspect(t.f.external)).toEqual(observed); await t.absent();
});

it('preserves a real returned original payload and its first cause', async test => {
  const t = await postClearFixture(test); const retained = join(t.f.originalPaths.candidateRoot, 'post-clear-retained');
  t.hooks.read = async (work, args) => {
    await work(...args); await mkdir(t.f.originalPaths.candidateRoot, { recursive: true, mode: 0o700 });
    await writeFile(retained, 'synthetic returned original', { flag: 'wx', mode: 0o600 });
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(retained, 'utf8')).toBe('synthetic returned original'); await t.absent();
});

it.for(['parent', 'operation'] as const)('rejects a changed native %s directory', async (kind, test) => {
  const t = await postClearFixture(test); const retained = join(t.f.root, 'retained-postclear-parent');
  t.hooks.read = async (work, args) => {
    if (kind === 'parent') { await rename(t.f.inventoryPaths.parentPath, retained); await mkdir(t.f.inventoryPaths.parentPath, { mode: 0o700 }); }
    else await mkdir(t.f.inventoryPaths.directoryPath, { mode: 0o700 });
    await work(...args);
  };
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(await readdir(kind === 'parent' ? retained : t.f.inventoryPaths.directoryPath)).toEqual([]); await t.absent();
});

it('expires its callback before the trailing full check and after return', async test => {
  const t = await postClearFixture(test); let saved: (() => Promise<void>) | undefined, returned = false, checked = false;
  t.hooks.read = async (work, args) => { saved = args[2].assertExternalSelection; await work(...args); returned = true; };
  t.hooks.full = async () => {
    if (returned && saved !== undefined && !checked) {
      checked = true; await expect(saved()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    }
  };
  await t.run(); expect(checked).toBe(true); expect(saved).toBeDefined();
  await expect(saved!()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); await t.absent();
});

it('joins a held native identity result after revocation', async test => {
  const t = await postClearFixture(test); let enter!: () => void, release!: () => void, settled = false, nativeFinished = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  const original = nativeReservation.readWorkspaceProcessReservationIdentity;
  vi.spyOn(nativeReservation, 'readWorkspaceProcessReservationIdentity').mockImplementation(async (...args) => {
    const result = original(...args);
    if (!t.inside() || args[0] !== t.f.inventoryPaths.parentPath) return result;
    // Observe rejection immediately, hold the actual identity result, and join it before return.
    const observed = result.then(value => ({ value }), error => ({ error }));
    enter(); await gate; const outcome = await observed; nativeFinished = true;
    if ('error' in outcome) throw outcome.error; return outcome.value;
  });
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_NATIVE_POST_CLEAR_NOT_ENTERED'); })]);
    t.f.revoke(); await setImmediate(); expect(settled).toBe(false); expect(nativeFinished).toBe(false);
  } finally { release(); await outcome; }
  expect(nativeFinished).toBe(true); expect(await outcome).toBe(t.f.first);
});

it('rejects reentrant finalization without poisoning the active call', async test => {
  const t = await postClearFixture(test); let checked = false;
  t.hooks.read = async (work, args) => {
    await expect(t.command(t.f.header.operationId, t.f.authority)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    checked = true; return work(...args);
  };
  await t.run(); expect(checked).toBe(true); await t.absent();
});

it.for(['default.v1', 'default.v2', 'cold.present.v1', 'cold.present.v2'])(
  'retains the %s path and evidence', async (kind, test) => {
    const t = await postClearFixture(test, { cold: kind.startsWith('cold'), original: kind.endsWith('v2'), retired: !kind.includes('present') });
    await t.run(); expect(t.stats.reads).toBe(1);
    if (kind.startsWith('default')) { expect(t.stats.metadataInside).toBe(2); expect(t.f.fullProof).not.toHaveBeenCalled(); }
    await t.absent();
  });
