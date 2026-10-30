import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_MAX_BYTES } from '../registry/workspaceRegistryBytes.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createWorkspaceLegacyAdoptionJournalPaths, maximumWorkspaceLegacyAdoptionJournalBytes,
  serializeWorkspaceLegacyAdoptionJournal, WorkspaceLegacyAdoptionJournalStore } from './workspaceLegacyAdoptionJournal.js';
import { WorkspaceLegacyAdoptionMetadataSelection } from './workspaceLegacyAdoptionMetadataSelection.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { resolveWorkspaceLegacyAdoptionStartup } from './workspaceLegacyAdoptionStartup.js';
import { createAdoptionJournal, createPublishedAdoptionRegistry, TEST_ADOPTION_CREATED_AT,
  TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const owners = ['journal', 'registry'] as const;

describe('one adoption attempt metadata selection', () => {
  it.for(owners)('observes all initial %s slots before any repair and accepts only its own recovery receipt', async (owner, context) => {
    const f = await fixture(context);
    await f.seed(owner, 'backup');
    await writeFile(f.paths[owner].nextPath, 'torn', { flag: 'wx' });
    const before = await f.snapshot();
    const selected = await f.capture();
    expect(await f.snapshot()).toEqual(before);
    const value = await selected[owner].read();
    expect(value).toEqual(f.values[owner]);
    expect(await fileBytes(f.paths[owner].currentPath)).toEqual(f.bytes[owner]);
    expect(await fileBytes(f.paths[owner].nextPath)).toBeUndefined();
    expect(await fileBytes(f.paths[owner].backupPath)).toBeUndefined();
    await expect(selected.assertCurrent()).resolves.toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it.for(owners.flatMap(owner => ['current', 'backup', 'next'].map(slot => ({ owner, slot } as const))))(
    'preserves existing $owner source precedence for $slot', async ({ owner, slot }, context) => {
      const f = await fixture(context);
      await f.seed(owner, slot as 'current' | 'backup' | 'next');
      const selected = await f.capture();
      expect(await selected[owner].read()).toEqual(f.values[owner]);
      expect(await fileBytes(f.paths[owner].currentPath)).toEqual(f.bytes[owner]);
      expect(f.onUncertain).not.toHaveBeenCalled();
    });

  it('advances only acknowledged journal and registry publications through the existing startup states', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    expect(await selected.journal.read()).toBeUndefined();
    expect(await selected.registry.read()).toBeUndefined();
    for (const state of ['prepared', 'candidatePrepared', 'rootPublished'] as const) {
      await selected.journal.write(createAdoptionJournal(state));
      expect(await selected.journal.read()).toEqual(createAdoptionJournal(state));
    }
    await selected.registry.write(f.values.registry);
    expect(await selected.registry.read()).toEqual(f.values.registry);
    await selected.journal.write(createAdoptionJournal('registryPublished'));
    await selected.journal.clear(TEST_ADOPTION_OPERATION_ID);
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(await fileBytes(f.paths.registry.currentPath)).toEqual(f.bytes.registry);
    expect(f.onUncertain).not.toHaveBeenCalled();
    await expect(selected.journal.write(createAdoptionJournal('prepared'))).rejects.toThrow();
  });

  it.for(owners.flatMap(owner => ['bytes', 'identity', 'sibling'].map(change => ({ owner, change } as const))))(
    'retains $owner $change drift instead of recapturing or repairing it', async ({ owner, change }, context) => {
      const f = await fixture(context);
      await f.seed(owner, 'current');
      const selected = await f.capture();
      if (change === 'identity') {
        await rename(f.paths[owner].currentPath, `${f.paths[owner].currentPath}.preserved`);
        await writeFile(f.paths[owner].currentPath, f.bytes[owner], { flag: 'wx' });
      } else if (change === 'bytes') {
        await writeFile(f.paths[owner].currentPath, owner === 'journal'
          ? serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('recoveryRequired'))
          : serializeWorkspaceRegistry(createPublishedAdoptionRegistry('b'.repeat(64))));
      } else await writeFile(f.paths[owner].nextPath, 'foreign-torn', { flag: 'wx' });
      const before = await f.snapshot();
      await expect(selected[owner].read()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
      await expect(selected.assertCurrent()).rejects.toThrow();
      expect(await f.snapshot()).toEqual(before);
      expect(f.onUncertain).toHaveBeenCalledOnce();
    });

  it.for(owners)('rejects changed %s during the last external wait before the other writer starts', async (changed, context) => {
    const f = await fixture(context);
    await f.seed(changed, 'current');
    const selected = await f.capture();
    f.external.mockImplementationOnce(async () => {
      await writeFile(f.paths[changed].nextPath, 'foreign-torn', { flag: 'wx' });
    });
    const writing = changed === 'journal' ? 'registry' : 'journal';
    const writer = vi.spyOn(f.fs[writing], 'createNextWriter');
    await expect(selected[writing].write(f.values[writing])).rejects.toThrow();
    expect(writer).not.toHaveBeenCalled();
    expect(await fileBytes(f.paths[changed].nextPath)).toEqual(Buffer.from('foreign-torn'));
  });

  it.for(owners)('keeps a lost %s publication reply sealed even after a new owner succeeds', async (owner, context) => {
    const f = await fixture(context);
    if (owner === 'journal') await f.seed(owner, 'current');
    const selected = await f.capture();
    const move = f.fs[owner].moveSlot.bind(f.fs[owner]);
    const first = new Error('synthetic publication reply lost');
    const spy = vi.spyOn(f.fs[owner], 'moveSlot').mockImplementation(async (...args) => {
      await move(...args);
      if (args[1] === 'current') throw first;
    });
    const next = owner === 'journal' ? createAdoptionJournal('candidatePrepared') : f.values.registry;
    await expect(selected[owner].write(next)).rejects.toMatchObject({ cause: first });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    const retained = await f.snapshot();
    spy.mockRestore();
    await expect(selected[owner].read()).rejects.toMatchObject({ cause: first });
    expect(await f.snapshot()).toEqual(retained);
    const successor = await f.capture();
    expect(await successor[owner].read()).toEqual(next);
    await expect(selected.assertCurrent()).rejects.toMatchObject({ cause: first });
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['admission', 'writerExternal'] as const)('rejects metadata changed in the final %s continuation', async (phase, context) => {
    const f = await fixture(context);
    await f.seed('journal', 'current');
    await f.seed('registry', 'current');
    const selected = await f.capture();
    let checks = 0;
    f.external.mockImplementation(async () => {
      if (++checks === (phase === 'admission' ? 2 : 4)) {
        await writeFile(f.paths.registry.nextPath, 'foreign-torn', { flag: 'wx' });
      }
    });
    if (phase === 'admission') await expect(selected.assertCurrent()).rejects.toThrow();
    else await expect(selected.journal.write(createAdoptionJournal('candidatePrepared'))).rejects.toThrow();
    expect(await fileBytes(f.paths.journal.currentPath)).toEqual(f.bytes.journal);
    expect(await fileBytes(f.paths.registry.nextPath)).toEqual(Buffer.from('foreign-torn'));
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('does not recreate a cleared journal after its acknowledgement is lost', async context => {
    const f = await fixture(context);
    await writeFile(f.paths.journal.currentPath, serializeWorkspaceLegacyAdoptionJournal(createAdoptionJournal('registryPublished')));
    const selected = await f.capture();
    const first = new Error('synthetic clear reply lost');
    const sync = f.fs.journal.syncDirectory.bind(f.fs.journal);
    vi.spyOn(f.fs.journal, 'syncDirectory').mockImplementationOnce(async guard => { await sync(guard); throw first; });
    await expect(selected.journal.clear(TEST_ADOPTION_OPERATION_ID)).rejects.toMatchObject({ cause: first });
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    await expect(selected.journal.write(createAdoptionJournal('prepared'))).rejects.toMatchObject({ cause: first });
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  });

  it.for(['beforeRead', 'afterRead', 'mutationGuard'] as const)('rejects ownership lost at %s and does not renew it in the same attempt', async (stage, context) => {
    const f = await fixture(context);
    await f.seed('journal', 'current');
    const selected = await f.capture();
    if (stage === 'beforeRead') f.state.current = false;
    else if (stage === 'afterRead') {
      const inspect = f.fs.journal.inspectSlotIdentity!.bind(f.fs.journal);
      vi.spyOn(f.fs.journal, 'inspectSlotIdentity').mockImplementationOnce(async slot => {
        const value = await inspect(slot); f.state.current = false; return value;
      });
    } else {
      const create = f.fs.journal.createNextWriter.bind(f.fs.journal);
      vi.spyOn(f.fs.journal, 'createNextWriter').mockImplementationOnce(async guard => {
        f.state.current = false; return create(guard);
      });
    }
    const before = await f.snapshot();
    await expect(selected.journal.write(createAdoptionJournal('candidatePrepared'))).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    f.state.current = true;
    await expect(selected.journal.read()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('checks ownership again after the external asynchronous callback', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    f.external.mockImplementationOnce(async () => { f.state.current = false; });
    await expect(selected.journal.write(createAdoptionJournal('prepared'))).rejects.toThrow();
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(await fileBytes(f.paths.journal.nextPath)).toBeUndefined();
  });

  it('rejects a falsely asynchronous synchronous ownership guard before any observation', async context => {
    const f = await fixture(context);
    const inspect = vi.spyOn(f.fs.journal, 'inspectSlotIdentity');
    await expect(WorkspaceLegacyAdoptionMetadataSelection.capture({ journal: f.journal, registry: f.registry,
      ...f.authority, assertAuthority: async () => {} })).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
    expect(f.external).not.toHaveBeenCalled();
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('refuses overlapping work, joins the original read and keeps metadata unchanged', async context => {
    const f = await fixture(context);
    await f.seed('journal', 'current');
    const selected = await f.capture();
    const entered = gate(), release = gate();
    const inspect = f.fs.journal.inspectSlotIdentity!.bind(f.fs.journal);
    vi.spyOn(f.fs.journal, 'inspectSlotIdentity').mockImplementationOnce(async slot => {
      const value = await inspect(slot); entered.resolve(); await release.promise; return value;
    });
    const writer = vi.spyOn(f.fs.journal, 'createNextWriter');
    let settled = false;
    const operation = selected.assertCurrent().finally(() => { settled = true; });
    const observed = operation.catch(error => error);
    try {
      await entered.promise;
      await expect(selected.journal.write(createAdoptionJournal('candidatePrepared'))).rejects.toThrow();
      expect(settled).toBe(false);
    } finally { release.resolve(); await observed; }
    await expect(operation).rejects.toThrow();
    expect(writer).not.toHaveBeenCalled();
    expect(await fileBytes(f.paths.journal.currentPath)).toEqual(f.bytes.journal);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('does not replace the lost reply reason when the observer also fails', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const first = new Error('synthetic original publication failure');
    const move = f.fs.registry.moveSlot.bind(f.fs.registry);
    vi.spyOn(f.fs.registry, 'moveSlot').mockImplementationOnce(async (...args) => { await move(...args); throw first; });
    f.onUncertain.mockImplementationOnce(() => { throw new Error('synthetic observation failure'); });
    await expect(selected.registry.write(f.values.registry)).rejects.toMatchObject({ cause: first });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
    expect(await fileBytes(f.paths.registry.currentPath)).toEqual(f.bytes.registry);
  });

  it('does not turn a rejected input with no I/O into an uncertain publication', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    await expect(selected.journal.write({ invalid: true })).rejects.toThrow();
    await expect(selected.registry.write({ invalid: true })).rejects.toThrow();
    expect(f.onUncertain).not.toHaveBeenCalled();
    await selected.journal.write(createAdoptionJournal('prepared'));
    expect(await selected.journal.read()).toEqual(f.values.journal);
  });

  it('rejects uncertainty delivered in the last completion continuation', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const view = selected as unknown as { assertObservedBoth(): Promise<void> };
    const read = view.assertObservedBoth.bind(view);
    const first = new Error('synthetic final owner invalidation');
    let reads = 0;
    const spy = vi.spyOn(view, 'assertObservedBoth').mockImplementation(async () => {
      await read();
      if (++reads === 2) queueMicrotask(() => selected.onUncertain(first));
    });
    try { await expect(selected.assertCurrent()).rejects.toMatchObject({ cause: first }); }
    finally { spy.mockRestore(); }
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('preserves closing failure after ownership expiry already recorded the first cause', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const closing = new Error('synthetic close failure after owner loss');
    const create = f.fs.journal.createNextWriter.bind(f.fs.journal);
    vi.spyOn(f.fs.journal, 'createNextWriter').mockImplementation(async guard => {
      const writer = await create(guard);
      return { write: writer.write.bind(writer), readIdentity: writer.readIdentity!.bind(writer),
        async sync() { await writer.sync(); f.state.current = false; },
        async close() { await writer.close(); throw closing; } };
    });
    const result = await selected.journal.write(createAdoptionJournal('prepared')).catch(error => error);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(result.cause).toBeInstanceOf(AggregateError);
    expect(result.cause.errors).toEqual([f.onUncertain.mock.calls[0]![0], closing]);
    expect(await fileBytes(f.paths.journal.nextPath)).toEqual(f.bytes.journal);
  });

  it('joins the other initial read after one observation fails', async context => {
    const f = await fixture(context);
    const entered = gate(), release = gate();
    const first = new Error('synthetic initial observation failure');
    vi.spyOn(f.fs.journal, 'inspectSlotIdentity').mockRejectedValueOnce(first);
    const inspect = f.fs.registry.inspectSlotIdentity!.bind(f.fs.registry);
    vi.spyOn(f.fs.registry, 'inspectSlotIdentity').mockImplementationOnce(async slot => {
      const identity = await inspect(slot); entered.resolve(); await release.promise; return identity;
    });
    let settled = false;
    const operation = f.capture().finally(() => { settled = true; });
    const observed = operation.catch(error => error);
    try { await entered.promise; expect(settled).toBe(false); }
    finally { release.resolve(); await observed; }
    await expect(operation).rejects.toThrow();
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('joins a failing writer close and preserves the original failure chain', async context => {
    const f = await fixture(context);
    const selected = await f.capture();
    const first = new Error('synthetic sync failure'), closing = new Error('synthetic close failure');
    const entered = gate(), release = gate();
    const create = f.fs.journal.createNextWriter.bind(f.fs.journal);
    vi.spyOn(f.fs.journal, 'createNextWriter').mockImplementation(async guard => {
      const writer = await create(guard);
      if (writer.readIdentity === undefined) throw new Error('synthetic writer lacks identity');
      return { write: writer.write.bind(writer), readIdentity: writer.readIdentity.bind(writer),
        sync: async () => { throw first; }, async close() {
        entered.resolve(); await release.promise; await writer.close(); throw closing;
      } };
    });
    let settled = false;
    const operation = selected.journal.write(createAdoptionJournal('prepared')).finally(() => { settled = true; });
    const observed = operation.catch(error => error);
    try { await entered.promise; expect(settled).toBe(false); expect(f.onUncertain).not.toHaveBeenCalled(); }
    finally { release.resolve(); await observed; }
    await expect(operation).rejects.toMatchObject({ cause: { errors: [first, closing] } });
    expect(f.onUncertain).toHaveBeenCalledOnce();
    expect(await fileBytes(f.paths.journal.nextPath)).toEqual(f.bytes.journal);
  });

  it.for(['legacy', 'fresh'] as const)('uses the selected adapters in the existing %s startup without ordinary repairing reads', async (kind, context) => {
    const f = await fixture(context);
    const source = join(f.root, 'runtime', 'data', 'eky.sqlite');
    if (kind === 'legacy') {
      await mkdir(join(f.root, 'runtime', 'data'), { recursive: true, mode: 0o700 });
      await mkdir(join(f.root, 'runtime', 'storage', 'invoices'), { recursive: true, mode: 0o700 });
      await writeFile(source, 'synthetic database');
    }
    const ordinaryJournalRead = vi.spyOn(f.journal, 'read');
    const ordinaryRegistryRead = vi.spyOn(f.registry, 'read');
    const selected = await f.capture();
    const startup = await resolveWorkspaceLegacyAdoptionStartup({ journal: selected.journal, registry: selected.registry,
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(), userDataRoot: f.root,
      generateOperationId: () => TEST_ADOPTION_OPERATION_ID, generateWorkspaceId: () => TEST_ADOPTION_WORKSPACE_ID,
      now: () => new Date(TEST_ADOPTION_CREATED_AT) });
    await startup.accept('a'.repeat(64));
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(await fileBytes(f.paths.registry.currentPath)).toEqual(f.bytes.registry);
    expect(ordinaryJournalRead).not.toHaveBeenCalled();
    expect(ordinaryRegistryRead).not.toHaveBeenCalled();
    if (kind === 'legacy') expect(await readFile(source, 'utf8')).toBe('synthetic database');
    expect(f.onUncertain).not.toHaveBeenCalled();
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-metadata-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = { journal: createWorkspaceLegacyAdoptionJournalPaths(root),
    registry: createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME)) };
  await mkdir(paths.journal.directoryPath, { mode: 0o700 });
  const fs = { journal: createNodeCrashSafeFileSlotFileSystem(paths.journal, maximumWorkspaceLegacyAdoptionJournalBytes),
    registry: createNodeCrashSafeFileSlotFileSystem(paths.registry, WORKSPACE_REGISTRY_MAX_BYTES) };
  const journal = new WorkspaceLegacyAdoptionJournalStore(root, fs.journal);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: paths.registry.currentPath, fileSystem: fs.registry });
  const values = { journal: createAdoptionJournal('prepared'), registry: createPublishedAdoptionRegistry() };
  const bytes = { journal: Buffer.from(serializeWorkspaceLegacyAdoptionJournal(values.journal)),
    registry: Buffer.from(serializeWorkspaceRegistry(values.registry)) };
  const state = { current: true };
  const external = vi.fn(async () => {}), onUncertain = vi.fn((_error: unknown) => {});
  const authority = { assertAuthority() { if (!state.current) throw new Error('synthetic owner expired'); },
    assertExternalSelection: external, onUncertain };
  const capture = () => WorkspaceLegacyAdoptionMetadataSelection.capture({ journal, registry, ...authority });
  const seed = (owner: typeof owners[number], slot: 'current' | 'next' | 'backup') => writeFile(paths[owner][`${slot}Path`], bytes[owner], { flag: 'wx' });
  const snapshot = async () => ({ journal: await slotBytes(paths.journal), registry: await slotBytes(paths.registry) });
  return { root, paths, fs, journal, registry, values, bytes, state, external, onUncertain, authority, capture, seed, snapshot };
}

async function slotBytes(paths: { currentPath: string; nextPath: string; backupPath: string }) {
  return { current: await fileBytes(paths.currentPath), next: await fileBytes(paths.nextPath), backup: await fileBytes(paths.backupPath) };
}

async function fileBytes(path: string) {
  try { return await readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
