import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { maximumWorkspaceRemnantBindingBytes } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import type { ObservedRecoveryAuthority } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_REGISTRY_MAX_BYTES } from '../registry/workspaceRegistryBytes.js';
import { createWorkspaceRegistryPaths, WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceLegacyAdoptionBindingSelection } from './workspaceLegacyAdoptionBindingSelection.js';
import { createWorkspaceLegacyAdoptionJournalPaths, maximumWorkspaceLegacyAdoptionJournalBytes,
  serializeWorkspaceLegacyAdoptionJournal, WorkspaceLegacyAdoptionJournalStore } from './workspaceLegacyAdoptionJournal.js';
import { WorkspaceLegacyAdoptionMetadataSelection } from './workspaceLegacyAdoptionMetadataSelection.js';
import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import { WorkspaceLegacyAdoptionRootSelection, type WorkspaceLegacyAdoptionRootObservation } from './workspaceLegacyAdoptionRootSelection.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from './workspaceLegacyAdoptionRootStore.js';
import { createAdoptionJournal, createPublishedAdoptionRegistry, TEST_ADOPTION_OPERATION_ID,
  TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const profileId = 'c'.repeat(64);

describe('adoption phase views of the same selected bytes', () => {
  it('uses the same root, metadata and binding selections through prepare, publish and live acceptance', async context => {
    const f = await fixture(context);
    const paths = deriveWorkspaceLegacyAdoptionPaths(f.root, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID);
    const sourceDatabase = join(paths.legacyRuntimeRoot, 'data', 'eky.sqlite');
    await mkdir(join(paths.legacyRuntimeRoot, 'data'), { recursive: true, mode: 0o700 });
    await mkdir(join(paths.legacyRuntimeRoot, 'storage', 'invoices'), { recursive: true, mode: 0o700 });
    await writeFile(sourceDatabase, 'synthetic original database');
    const roots = await WorkspaceLegacyAdoptionRootSelection.observe(paths, {
      assertMutationCurrent() {}, onUncertain: f.onUncertain,
    });
    const observed = await f.observe();
    const preparing = f.phase(observed, roots);
    const rootStore = new NodeWorkspaceLegacyAdoptionRootStore(preparing.roots);
    await preparing.metadata.journal.write(createAdoptionJournal('prepared'));
    await rootStore.prepareCandidate(paths, 'legacy');
    await preparing.metadata.journal.write(createAdoptionJournal('candidatePrepared'));
    await rootStore.publishCandidate(paths);
    await preparing.metadata.journal.write(createAdoptionJournal('rootPublished'));
    preparing.state.current = false;
    const accepting = f.phase(observed, roots);
    const acceptedStore = new NodeWorkspaceLegacyAdoptionRootStore(accepting.roots);
    const finalDatabase = join(paths.finalRoot, 'runtime', 'data', 'eky.sqlite');
    // Business writes may change file content, never the selected root identity.
    await writeFile(finalDatabase, 'synthetic business write');
    await accepting.binding.publish(profileId);
    await accepting.metadata.registry.write(createPublishedAdoptionRegistry(profileId));
    await accepting.metadata.journal.write(createAdoptionJournal('registryPublished'));
    await acceptedStore.discardCandidate(paths);
    await accepting.binding.assertPublished(profileId);
    await accepting.metadata.journal.clear(TEST_ADOPTION_OPERATION_ID);
    await accepting.roots!.assertObservedCurrent();
    expect(await readFile(sourceDatabase, 'utf8')).toBe('synthetic original database');
    expect(await readFile(finalDatabase, 'utf8')).toBe('synthetic business write');
    expect(await fileBytes(f.paths.binding.currentPath)).toBeDefined();
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it.for(['metadata', 'binding'] as const)('preserves the live %s bootstrap authority receiver', async (owner, context) => {
    const f = await fixture(context);
    const prepared = f.phase(await f.observe());
    if (owner === 'metadata') await prepared.metadata.journal.write(createAdoptionJournal('prepared'));
    else await prepared.binding.publish(profileId);
    const state = { current: true };
    const first = new Error('synthetic receiver authority expired');
    const options = <T>(journal: T) => ({
      journal, registry: f.registry, userDataRoot: f.root,
      get current() { return state.current; },
      assertAuthority() { if (!this.current) throw first; },
      onUncertain(error: unknown) { f.onUncertain(error); },
    });
    f.reading[owner].mockImplementationOnce(() => { state.current = false; });
    const operation = owner === 'metadata'
      ? WorkspaceLegacyAdoptionMetadataSelection.observe(options(f.journal))
      : WorkspaceLegacyAdoptionBindingSelection.observe(options(createAdoptionJournal('prepared')), f.fs.binding);
    await expect(operation).rejects.toMatchObject({ cause: first });
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  });

  it.for(['metadata', 'binding'] as const)('supports prototype-defined %s bootstrap authority methods', async (owner, context) => {
    const f = await fixture(context);
    class Authority {
      assertAuthority() {}
      onUncertain(error: unknown) { f.onUncertain(error); }
    }
    const observation = owner === 'metadata'
      ? await WorkspaceLegacyAdoptionMetadataSelection.observe(Object.assign(new Authority(), { journal: f.journal, registry: f.registry }))
      : await WorkspaceLegacyAdoptionBindingSelection.observe(Object.assign(new Authority(), {
        userDataRoot: f.root, journal: createAdoptionJournal('prepared'),
      }), f.fs.binding);
    await observation.assertObservedCurrent();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('observes backup metadata without repair and exposes no initial mutation ports', async context => {
    const f = await fixture(context);
    const journal = createAdoptionJournal('prepared');
    await writeFile(f.paths.journal.backupPath, serializeWorkspaceLegacyAdoptionJournal(journal));
    await writeFile(f.paths.journal.nextPath, 'synthetic torn side');
    const before = await f.snapshot();
    const observed = await f.observe();
    expect('journal' in observed.metadata).toBe(false);
    expect('publish' in observed.binding).toBe(false);
    expect(await observed.metadata.readJournal()).toEqual(journal);
    expect(await f.snapshot()).toEqual(before);
    const phase = f.phase(observed);
    await phase.metadata.assertCurrent();
    await phase.binding.assertCurrent();
    expect(await phase.metadata.journal.read()).toEqual(journal);
    expect(await fileBytes(f.paths.journal.backupPath)).toBeUndefined();
    expect(await fileBytes(f.paths.journal.nextPath)).toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('cross-checks each writer through readonly leaves without entering its peer callback', async context => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed);
    await phase.metadata.assertCurrent();
    await phase.binding.assertCurrent();
    await phase.metadata.journal.write(createAdoptionJournal('prepared'));
    await phase.metadata.journal.write(createAdoptionJournal('candidatePrepared'));
    await phase.metadata.journal.write(createAdoptionJournal('rootPublished'));
    await phase.binding.publish(profileId);
    await phase.metadata.registry.write(createPublishedAdoptionRegistry(profileId));
    await phase.metadata.journal.write(createAdoptionJournal('registryPublished'));
    await phase.binding.assertPublished(profileId);
    await phase.metadata.journal.clear(TEST_ADOPTION_OPERATION_ID);
    expect(await fileBytes(f.paths.binding.currentPath)).toBeDefined();
    expect(await fileBytes(f.paths.registry.currentPath)).toBeDefined();
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('shares own publication receipts across phases without recapturing the filesystem', async context => {
    const f = await fixture(context);
    const observed = await f.observe();
    const preparing = f.phase(observed);
    await preparing.metadata.journal.write(createAdoptionJournal('prepared'));
    preparing.state.current = false;
    const accepting = f.phase(observed);
    await accepting.metadata.journal.write(createAdoptionJournal('candidatePrepared'));
    await accepting.binding.publish(profileId);
    accepting.state.current = false;
    const recovering = f.phase(observed);
    expect(await recovering.metadata.journal.read()).toEqual(createAdoptionJournal('candidatePrepared'));
    await recovering.binding.assertPublished(profileId);
    expect(observed.binding.initialBinding).toBeUndefined();
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('rejects expired views and callbacks before I/O without poisoning the successor', async context => {
    const f = await fixture(context);
    const observed = await f.observe();
    const old = f.phase(observed);
    old.state.current = false;
    const current = f.phase(observed);
    f.reading.metadata.mockClear();
    f.reading.binding.mockClear();
    await expect(old.metadata.assertObservedCurrent()).rejects.toThrow();
    await expect(old.metadata.journal.write(createAdoptionJournal('prepared'))).rejects.toThrow();
    await expect(old.binding.publish(profileId)).rejects.toThrow();
    expect(() => old.metadata.assertMutationCurrent()).toThrow();
    expect(() => old.binding.initialBinding).toThrow();
    expect(f.reading.metadata).not.toHaveBeenCalled();
    expect(f.reading.binding).not.toHaveBeenCalled();
    await current.metadata.journal.write(createAdoptionJournal('prepared'));
    await current.binding.publish(profileId);
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it.for(['metadata', 'binding'] as const)('keeps %s in-flight authority loss sealed after a phase change', async (owner, context) => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed);
    const entered = gate(), release = gate();
    phase.external[owner].mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const operation = phase[owner].assertCurrent();
    const rejected = expect(operation).rejects.toThrow();
    try { await entered.promise; phase.state.current = false; }
    finally { release.resolve(); }
    await rejected;
    const successor = f.phase(observed);
    const before = await f.snapshot();
    await expect(successor[owner].assertCurrent()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['metadata', 'binding'] as const)('does not renew %s selection after external byte drift', async (owner, context) => {
    const f = await fixture(context);
    const observed = await f.observe();
    await writeFile(f.paths[owner === 'metadata' ? 'journal' : 'binding'].nextPath, 'foreign side', { flag: 'wx' });
    const phase = f.phase(observed);
    const before = await f.snapshot();
    await expect(phase[owner].assertObservedCurrent()).rejects.toThrow();
    const successor = f.phase(observed);
    await expect(successor[owner].assertCurrent()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });

  it.for(['metadata', 'binding'] as const)('does not turn a lost %s publication receipt into a new phase receipt', async (owner, context) => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed);
    const fs = f.fs[owner === 'metadata' ? 'journal' : 'binding'];
    const move = fs.moveSlot.bind(fs);
    const first = new Error('synthetic lost publication reply');
    const fault = vi.spyOn(fs, 'moveSlot').mockImplementation(async (...args) => {
      await move(...args);
      if (args[1] === 'current') throw first;
    });
    const operation = owner === 'metadata'
      ? phase.metadata.journal.write(createAdoptionJournal('prepared'))
      : phase.binding.publish(profileId);
    await expect(operation).rejects.toMatchObject({ cause: first });
    fault.mockRestore();
    const before = await f.snapshot();
    const successor = f.phase(observed);
    await expect(successor[owner].assertObservedCurrent()).rejects.toMatchObject({ cause: first });
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(first);
  });

  it.for(['metadata', 'binding'] as const)('checks %s phase authority after a readonly leaf has started I/O', async (owner, context) => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed);
    if (owner === 'binding') await phase.binding.publish(profileId);
    else await phase.metadata.journal.write(createAdoptionJournal('prepared'));
    const fault = f.reading[owner].mockClear().mockImplementationOnce(() => { phase.state.current = false; });
    const before = await f.snapshot();
    await expect(phase[owner].assertObservedCurrent()).rejects.toThrow();
    expect(fault).toHaveBeenCalled();
    const successor = f.phase(observed);
    await expect(successor[owner].assertCurrent()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it.for(['metadata', 'binding'] as const)('refuses overlapping %s views and joins the original observation', async (owner, context) => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed), other = f.phase(observed);
    const entered = gate(), release = gate();
    phase.external[owner].mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    let settled = false;
    const operation = phase[owner].assertCurrent().finally(() => { settled = true; });
    const rejected = expect(operation).rejects.toThrow();
    try {
      await entered.promise;
      await expect(other[owner].assertObservedCurrent()).rejects.toThrow();
      expect(settled).toBe(false);
    } finally { release.resolve(); }
    await rejected;
    expect(f.onUncertain).toHaveBeenCalledOnce();
  });

  it('keeps retired metadata retired in a new phase', async context => {
    const f = await fixture(context);
    const observed = await f.observe();
    const phase = f.phase(observed);
    await phase.metadata.journal.write(createAdoptionJournal('prepared'));
    await phase.metadata.journal.clear(TEST_ADOPTION_OPERATION_ID);
    const successor = f.phase(observed);
    await expect(successor.metadata.journal.write(createAdoptionJournal('prepared'))).rejects.toThrow();
    expect(await fileBytes(f.paths.journal.currentPath)).toBeUndefined();
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-phase-'));
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const paths = {
    journal: createWorkspaceLegacyAdoptionJournalPaths(root),
    registry: createWorkspaceRegistryPaths(root, join(root, WORKSPACE_REGISTRY_FILE_NAME)),
    binding: createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceLegacyAdoption', workspaceId: TEST_ADOPTION_WORKSPACE_ID }),
  };
  await mkdir(paths.journal.directoryPath, { mode: 0o700 });
  await mkdir(paths.binding.directoryPath, { recursive: true, mode: 0o700 });
  const fs = {
    journal: createNodeCrashSafeFileSlotFileSystem(paths.journal, maximumWorkspaceLegacyAdoptionJournalBytes),
    registry: createNodeCrashSafeFileSlotFileSystem(paths.registry, WORKSPACE_REGISTRY_MAX_BYTES),
    binding: createNodeCrashSafeFileSlotFileSystem(paths.binding, maximumWorkspaceRemnantBindingBytes),
  };
  const reading = { metadata: vi.fn(() => {}), binding: vi.fn(() => {}) };
  for (const [owner, fileSystem] of [['metadata', fs.journal], ['binding', fs.binding]] as const) {
    const read = fileSystem.readSlot.bind(fileSystem);
    fileSystem.readSlot = async (...args) => {
      const bytes = await read(...args);
      reading[owner]();
      return bytes;
    };
  }
  const journal = new WorkspaceLegacyAdoptionJournalStore(root, fs.journal);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: paths.registry.currentPath, fileSystem: fs.registry });
  const onUncertain = vi.fn((_error: unknown) => {});
  const observe = async () => ({
    metadata: await WorkspaceLegacyAdoptionMetadataSelection.observe({ journal, registry, assertAuthority() {}, onUncertain }),
    binding: await WorkspaceLegacyAdoptionBindingSelection.observe({ userDataRoot: root,
      journal: createAdoptionJournal('prepared'), assertAuthority() {}, onUncertain }, fs.binding),
  });
  const phase = (observed: Awaited<ReturnType<typeof observe>>, rootObservation?: Readonly<WorkspaceLegacyAdoptionRootObservation>) => {
    const state = { current: true };
    const assertAuthority = () => { if (!state.current) throw new Error('synthetic phase expired'); };
    const external = { metadata: vi.fn(async () => { await binding.assertObservedCurrent(); await roots?.assertObservedCurrent(); }),
      binding: vi.fn(async () => { await metadata.assertObservedCurrent(); await roots?.assertObservedCurrent(); }) };
    const authority = (owner: keyof typeof external): ObservedRecoveryAuthority => ({
      assertAuthority, assertExternalSelection: external[owner], onUncertain,
    });
    const metadata = observed.metadata.forPhase(authority('metadata'));
    const binding = observed.binding.forPhase(authority('binding'));
    const roots = rootObservation?.forPhase({ assertMutationCurrent: assertAuthority, onUncertain,
      async assertCurrent() { await metadata.assertObservedCurrent(); await binding.assertObservedCurrent(); },
    });
    return { metadata, binding, roots, state, external };
  };
  const snapshot = async () => Promise.all(Object.values(paths).map(async slots =>
    Promise.all([slots.currentPath, slots.nextPath, slots.backupPath].map(fileBytes))));
  return { root, paths, fs, journal, registry, observe, phase, snapshot, onUncertain, reading };
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
