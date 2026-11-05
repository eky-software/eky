import { readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import * as phaseSelection from './workspaceDeletionPhaseSelection.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type MetadataRead = typeof metadata.assertWorkspaceDeletionMetadataAbsent;
type AroundRead = (work: MetadataRead, args: Parameters<MetadataRead>) => ReturnType<MetadataRead>;

async function metadataReadFixture(test: TestContext, options: {
  terminal?: boolean; originalProof?: boolean; cold?: boolean;
} = {}) {
  let registryReads = 0, modeledHiddenRegistry = false, writerFailure: Error | undefined;
  let around: AroundRead | undefined;
  const reads: { registryReads: number }[] = [];
  const first = new Error('SYNTHETIC_TERMINAL_METADATA_READ_STOP');
  const inspect = WorkspaceRegistryStore.prototype.inspectSlots;
  const read = metadata.assertWorkspaceDeletionMetadataAbsent;
  // Install before the factories bind their registry methods.
  vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots').mockImplementation(function (this: WorkspaceRegistryStore, ...args) {
    registryReads++;
    if (modeledHiddenRegistry) return Promise.reject(first);
    return inspect.apply(this, args);
  });
  vi.spyOn(metadata, 'assertWorkspaceDeletionMetadataAbsent').mockImplementation((...args) => {
    const before = registryReads;
    const work = around === undefined ? read(...args) : around(read, args);
    const record = () => { reads.push({ registryReads: registryReads - before }); };
    void work.then(record, record);
    return work;
  });
  const f = await fixture(test, options.terminal ?? true, options.originalProof ?? false);
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); if (writerFailure !== undefined) throw writerFailure; },
    ...((options.cold ?? true) ? { assertStableSelection: f.fullProof } : {}) });
  return { f, reads, first,
    around(hook: AroundRead) { around = hook; },
    failWriter(error: Error) { writerFailure = error; },
    hideRegistry(value: boolean) { modeledHiddenRegistry = value; },
    run() { return f.track(command(f.header.operationId, f.authority)); },
    async preserved() {
      expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
      await f.preserved();
    },
  };
}

it.for(['present', 'retired', 'present.v2', 'retired.v2'])(
  'completes cold terminal metadata reading with inventory %s', async (state, test) => {
    const t = await metadataReadFixture(test, { originalProof: state.endsWith('.v2') }), f = t.f;
    if (state.startsWith('retired')) { await unlink(f.inventoryPaths.currentPath); await rmdir(f.inventoryPaths.directoryPath); }
    expect((await t.run()).phase).toBe('registryPublished');
    expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
    await expect(readdir(f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(t.reads.length).toBeGreaterThan(0);
    expect(t.reads.every(row => row.registryReads === 0)).toBe(true);
    expect(f.fullProof).toHaveBeenCalled(); await f.preserved();
  });

it.for(['default', 'nonterminal'] as const)('uses scoped ownership inside metadata reading for the %s caller', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: kind !== 'default', terminal: kind !== 'nonterminal' });
  t.around(async (work, args) => { await work(...args); throw t.first; });
  await expect(t.run()).rejects.toBe(t.first);
  expect(t.reads).toHaveLength(1); expect(t.reads[0]!.registryReads).toBe(0);
  if (kind === 'default') expect(t.f.fullProof).not.toHaveBeenCalled();
  await t.preserved();
});

it.for(['owner', 'writer'] as const)('rejects lost %s inside the metadata read itself', async (kind, test) => {
  const t = await metadataReadFixture(test), first = new Error('SYNTHETIC_METADATA_AUTHORITY_LOST');
  let checked = false;
  t.around((work, args) => {
    const authority = args[2], external = authority.assertExternalSelection;
    return work(args[0], args[1], { ...authority, async assertExternalSelection() {
      if (kind === 'owner') t.f.failAsyncOwner(first); else t.failWriter(first);
      await expect(external()).rejects.toBe(first); checked = true; throw first;
    } });
  });
  await expect(t.run()).rejects.toBe(first); expect(checked).toBe(true); await t.preserved();
});

it('expires the read callback while the finalizer is still active', async test => {
  const t = await metadataReadFixture(test);
  let saved: (() => Promise<void>) | undefined, checked = false;
  t.around((work, args) => { saved ??= args[2].assertExternalSelection; return work(...args); });
  t.f.fullProof.mockImplementation(async () => {
    t.f.authority.assertCurrent();
    if (saved !== undefined && !checked) {
      await expect(saved()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); checked = true;
    }
  });
  await t.run(); expect(checked).toBe(true); await t.f.preserved();
});

it('joins held metadata work before returning authority loss', async test => {
  const t = await metadataReadFixture(test);
  let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  t.f.releases.push(release);
  t.around((work, args) => {
    const authority = args[2], external = authority.assertExternalSelection;
    return work(args[0], args[1], { ...authority, async assertExternalSelection() { enter(); await held; await external(); } });
  });
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('SYNTHETIC_METADATA_READ_NOT_ENTERED'); })]);
    t.f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await outcome; }
  expect(await outcome).toBe(t.f.first); await t.preserved();
});

it('rejects persistent registry bytes at the trailing bookend before the next full proof', async test => {
  const t = await metadataReadFixture(test);
  let metadataCompleted = false, proofAfterMetadata = false;
  t.f.fullProof.mockImplementation(async () => {
    t.f.authority.assertCurrent(); if (metadataCompleted) proofAfterMetadata = true;
  });
  t.around(async (work, args) => {
    await writeFile(t.f.registryPath, serializeWorkspaceRegistry(t.f.before));
    await work(...args); metadataCompleted = true;
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(metadataCompleted).toBe(true); expect(proofAfterMetadata).toBe(false);
  expect(await readFile(t.f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(t.f.before)));
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
});

it('characterizes only modeled registry visibility restored within the read', async test => {
  const t = await metadataReadFixture(test); let changed = false;
  t.around(async (work, args) => {
    if (changed) return work(...args);
    changed = true; t.hideRegistry(true);
    try { return await work(...args); } finally { t.hideRegistry(false); }
  });
  await t.run(); expect(changed).toBe(true);
  expect(t.reads.length).toBeGreaterThan(0); expect(t.reads.every(row => row.registryReads === 0)).toBe(true);
  // Actual file bytes and native identities were never changed or reconstructed.
  await t.f.preserved();
});

it('preserves foreign binding bytes and identity across the whole terminal chain', async test => {
  const t = await metadataReadFixture(test), f = t.f, other = f.before.workspaces[0]!;
  const store = new WorkspaceRemnantBindingStore(f.root, { owner: 'workspaceImport', operationId: id(229) });
  await store.publish({ formatVersion: 1, owner: 'workspaceImport', operationId: id(229),
    workspaceId: other.workspaceId, lineageIdentity: other.lineageIdentity }, f.external);
  const before = await store.inspect(f.external);
  await t.run(); expect(await store.inspect(f.external)).toEqual(before); await f.preserved();
}, 10_000);

it('rejects a returned target binding without removing its evidence', async test => {
  const t = await metadataReadFixture(test), f = t.f;
  const store = new WorkspaceRemnantBindingStore(f.root, { owner: 'workspaceImport', operationId: id(229) });
  await store.publish({ formatVersion: 1, owner: 'workspaceImport', operationId: id(229),
    workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity }, f.external);
  const before = await store.inspect(f.external);
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await store.inspect(f.external)).toEqual(before); await t.preserved();
});

it.for(['default', 'nonterminal'] as const)('rejects persistent registry selection for the %s caller before mutation', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: kind !== 'default', terminal: kind !== 'nonterminal' });
  t.around(async (work, args) => {
    await writeFile(t.f.registryPath, serializeWorkspaceRegistry(t.f.before));
    return work(...args);
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
});

it('rejects same-byte registry replacement at the metadata bookend', async test => {
  const t = await metadataReadFixture(test, { cold: false });
  let replaced = false;
  t.around(async (work, args) => {
    if (!replaced) {
      replaced = true;
      const bytes = await readFile(t.f.registryPath);
      await rename(t.f.registryPath, t.f.registryPath + '.retained-original');
      await writeFile(t.f.registryPath, bytes, { flag: 'wx', mode: 0o600 });
    }
    return work(...args);
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(replaced).toBe(true); await t.preserved();
});

it.for(['default', 'nonterminal'] as const)('characterizes restored modeled registry visibility for the %s caller', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: kind !== 'default', terminal: kind !== 'nonterminal' });
  const stop = new Error('SYNTHETIC_READ_FINISHED_BEFORE_MUTATION');
  let completed = false;
  t.around(async (work, args) => {
    t.hideRegistry(true);
    try { await work(...args); completed = true; }
    finally { t.hideRegistry(false); }
    throw stop;
  });
  await expect(t.run()).rejects.toBe(stop);
  expect(completed).toBe(true); await t.preserved();
});

it.for(['firstOwner', 'writer', 'secondOwner'] as const)('retains the %s failure before metadata reader cleanup', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: false }), f = t.f;
  const first = new Error('SYNTHETIC_INNER_OWNER_CAUSE'), close = new Error('SYNTHETIC_READER_CLOSE_CAUSE');
  let armed = false, ownershipChecks = 0, seen: unknown;
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
    await f.authority.assertOwned();
    if (armed && ++ownershipChecks === (kind === 'secondOwner' ? 2 : 1) && kind !== 'writer') throw first;
  } };
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); if (armed && kind === 'writer') throw first; } });
  t.around(async (work, args) => {
    armed = true;
    try { return await work(...args); }
    catch (error) { seen = error; f.revoke(); throw close; }
  });
  await expect(f.track(command(f.header.operationId, authority))).rejects.toBe(first);
  expect(seen).toBe(first); await t.preserved();
});

it.for(['firstOwner', 'writer', 'secondOwner'] as const)('retains undefined from %s before metadata reader cleanup', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: false }), f = t.f;
  const close = new Error('SYNTHETIC_UNDEFINED_READER_CLOSE_CAUSE');
  let armed = false, ownershipChecks = 0, caught = false, seen: unknown = close;
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
    await f.authority.assertOwned();
    if (armed && ++ownershipChecks === (kind === 'secondOwner' ? 2 : 1) && kind !== 'writer') throw undefined;
  } };
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); if (armed && kind === 'writer') throw undefined; } });
  t.around(async (work, args) => {
    armed = true;
    try { return await work(...args); }
    catch (error) { caught = true; seen = error; f.revoke(); throw close; }
  });
  await expect(f.track(command(f.header.operationId, authority))).rejects.toBeUndefined();
  expect(caught).toBe(true); expect(seen).toBeUndefined(); await t.preserved();
});

it.for(['cold', 'ordinary', 'nonterminal', 'acrossPhase'] as const)('expires the %s metadata callback without later owner writer or registry IO', async (kind, test) => {
  const t = await metadataReadFixture(test, { cold: false, terminal: kind === 'ordinary' || kind === 'cold' }), f = t.f;
  const stop = new Error('SYNTHETIC_ACTIVE_READ_FINISHED_AFTER_EXPIRED_CALLBACK');
  const capture = phaseSelection.captureWorkspaceDeletionPhaseSelection;
  let phase = '', originalPhase = '', checked = false, activeReadFinished = false;
  let old: (() => Promise<void>) | undefined;
  const activity = { owner: 0, writers: 0, registry: 0 };
  vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (...args) => {
    const selected = await capture(...args); phase = selected.journal.phase; return selected;
  });
  const registry = { async inspectSlots(...args: Parameters<typeof f.registry.inspectSlots>) {
    activity.registry++; return f.registry.inspectSlots(...args);
  } };
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
    activity.owner++; await f.authority.assertOwned();
  } };
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry,
    async assertWritersAbsent() { activity.writers++; f.authority.assertCurrent(); },
    ...(kind === 'cold' ? { assertStableSelection: f.fullProof } : {}) });
  t.around(async (work, args) => {
    if (old === undefined) { old = args[2].assertExternalSelection; originalPhase = phase; return work(...args); }
    if (!checked && (kind !== 'acrossPhase' || phase !== originalPhase)) {
      const before = { ...activity };
      await expect(old()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(activity).toEqual(before); checked = true;
      await args[2].assertExternalSelection(); await work(...args); activeReadFinished = true; throw stop;
    }
    return work(...args);
  });
  await expect(f.track(command(f.header.operationId, authority))).rejects.toBe(stop);
  expect(checked).toBe(true); expect(activeReadFinished).toBe(true);
  if (kind === 'acrossPhase') {
    expect(originalPhase).toBe('purged'); expect(phase).toBe('registryPublished');
    const current = await f.store.inspect(f.authority.assertCurrent);
    expect(current.plan.mode).toBe('published');
    if (current.plan.mode === 'published') expect(current.plan.selected.phase).toBe('registryPublished');
  } else expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});
