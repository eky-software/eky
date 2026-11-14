import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { recoverWorkspaceLegacyAdoption } from './workspaceLegacyAdoptionRecovery.js';
import { resolveWorkspaceLegacyAdoptionStartup } from './workspaceLegacyAdoptionStartup.js';
import { createAdoptionJournal, createPublishedAdoptionRegistry, TEST_ADOPTION_OPERATION_ID,
  TEST_ADOPTION_WORKSPACE_ID } from './workspaceLegacyAdoptionTestSupport.js';

const profileId = 'c'.repeat(64);

describe('adoption phase views of the same selected bytes', () => {
  it.for(['empty', 'candidate', 'published'] as const)('recovers a bound %s interruption with the same journal identity', { timeout: 10_000 }, async (branch, context) => {
    const f = await interruptedRecoveryFixture(context, branch);
    const { recovering } = f;
    const result = await recoverWorkspaceLegacyAdoption(f.recoveryOptions);
    expect(result).toBe('relaunchRequired');
    expect(f.journalClear).not.toHaveBeenCalled();
    expect(await recovering.metadata.journal.read()).toEqual(createAdoptionJournal('prepared'));
    expect(await fileBytes(f.paths.binding.currentPath)).toEqual(f.bindingBytes);
    expect(await fileBytes(f.paths.registry.currentPath)).toBeUndefined();
    await recovering.roots!.assertRecoveredPayloadAbsent();
    expect(await readFile(f.source, 'utf8')).toBe('synthetic preserved legacy bytes');
    // A later owner sees the same prepared IDs, not a generated replacement.
    recovering.state.current = false;
    const nextRoots = await WorkspaceLegacyAdoptionRootSelection.observe(f.adoptionPaths, {
      assertMutationCurrent() {}, onUncertain: f.onUncertain,
    });
    const next = f.phase(await f.observe(), nextRoots);
    expect(await next.metadata.journal.read()).toEqual(createAdoptionJournal('prepared'));
    await next.binding.assertPublished(profileId);
    const noNewIdentity = () => { throw new Error('must retain the recovered adoption identity'); };
    const readoption = await resolveWorkspaceLegacyAdoptionStartup({
      journal: next.metadata.journal, registry: next.metadata.registry,
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(next.roots), userDataRoot: f.root,
      generateOperationId: noNewIdentity, generateWorkspaceId: noNewIdentity, now: noNewIdentity,
    });
    expect(readoption.workspaceId).toBe(TEST_ADOPTION_WORKSPACE_ID);
    expect(readoption.workspaceRoot).toBe(f.adoptionPaths.finalRoot);
    expect(await readFile(join(readoption.workspaceRoot, 'runtime', 'data', 'eky.sqlite'), 'utf8')).toBe('synthetic preserved legacy bytes');
    expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it.for(['beforeReset', 'lostResetReply', 'rootReappeared', 'bindingChanged'] as const)(
    'retains evidence instead of relaunching after %s', async (cut, context) => {
      const f = await interruptedRecoveryFixture(context, 'empty');
      const first = new Error('synthetic bound recovery interruption');
      if (cut === 'beforeReset') f.recoveryOptions.boundRecovery.prepareRecoveredSelection = async () => { throw first; };
      if (cut === 'lostResetReply') {
        const move = f.fs.journal.moveSlot.bind(f.fs.journal);
        vi.spyOn(f.fs.journal, 'moveSlot').mockImplementation(async (...args) => {
          await move(...args); if (args[1] === 'current') throw first;
        });
      }
      if (cut === 'rootReappeared') f.checks.assertPayloadAbsent.mockImplementationOnce(async () => {
        await mkdir(f.adoptionPaths.operationRoot, { mode: 0o700 });
        await f.recovering.roots!.assertRecoveredPayloadAbsent();
      });
      if (cut === 'bindingChanged') f.checks.assertBindingCurrent.mockImplementationOnce(async () => {
        await writeFile(f.paths.binding.nextPath, 'foreign binding evidence', { flag: 'wx' });
        await f.recovering.binding.assertObservedCurrent();
      });
      const failure = await recoverWorkspaceLegacyAdoption(f.recoveryOptions).catch(error => error);
      expect(failure.code).toBe('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
      if (cut === 'beforeReset' || cut === 'lostResetReply') expect(failure.cause).toBe(first);
      expect(await f.journal.read()).toEqual(createAdoptionJournal(cut === 'lostResetReply' ? 'prepared' : 'recoveryRequired'));
      expect(await readFile(f.source, 'utf8')).toBe('synthetic preserved legacy bytes');
      expect(await fileBytes(f.paths.binding.currentPath)).toEqual(f.bindingBytes);
      expect(f.journalClear).not.toHaveBeenCalled();
      if (cut === 'bindingChanged') expect(await fileBytes(f.paths.binding.nextPath)).toEqual(Buffer.from('foreign binding evidence'));
      if (cut !== 'beforeReset') {
        const retained = await f.snapshot();
        await expect(f.recovering.metadata.assertCurrent()).rejects.toThrow();
        expect(await f.snapshot()).toEqual(retained);
      }
    });

  it.for(['afterFinalRemoval', 'afterOperationRemoval'] as const)(
    'retains the bound journal and resumes with a new owner after %s', async (cut, context) => {
      const f = await interruptedRecoveryFixture(context, 'published');
      const first = new Error('synthetic interrupted recovery cleanup');
      if (cut === 'afterFinalRemoval') vi.spyOn(f.recoveryOptions.rootStore, 'discardEmptyRecoveryOperation').mockRejectedValueOnce(first);
      else f.recoveryOptions.boundRecovery.prepareRecoveredSelection = async () => { throw first; };
      await expect(recoverWorkspaceLegacyAdoption(f.recoveryOptions)).rejects.toMatchObject({ cause: first });
      expect(await fileBytes(join(f.adoptionPaths.finalRoot, 'runtime', 'data', 'eky.sqlite'))).toBeUndefined();
      if (cut === 'afterFinalRemoval') await expect(readdir(f.adoptionPaths.operationRoot)).resolves.toEqual([]);
      else await expect(readdir(f.adoptionPaths.operationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await f.journal.read()).toEqual(createAdoptionJournal('recoveryRequired'));
      expect(await fileBytes(f.paths.binding.currentPath)).toEqual(f.bindingBytes);
      expect(f.journalClear).not.toHaveBeenCalled();
      f.recovering.state.current = false;
      const roots = await WorkspaceLegacyAdoptionRootSelection.observe(f.adoptionPaths, {
        assertMutationCurrent() {}, onUncertain: f.onUncertain,
      });
      const successor = f.phase(await f.observe(), roots);
      await expect(recoverWorkspaceLegacyAdoption({
        journal: successor.metadata.journal, registry: successor.metadata.registry,
        rootStore: new NodeWorkspaceLegacyAdoptionRootStore(successor.roots), userDataRoot: f.root,
        boundRecovery: {
          async assertCurrent() {
            await successor.binding.assertPublished(profileId);
            await successor.metadata.assertRegistryAbsentCurrent();
          },
          prepareRecoveredSelection: () => successor.metadata.prepareRecoveredSelection({
            assertBindingCurrent: () => successor.binding.assertObservedCurrent(),
            assertPayloadAbsent: () => successor.roots!.assertRecoveredPayloadAbsent(),
          }),
        },
      })).resolves.toBe('relaunchRequired');
      expect(await successor.metadata.journal.read()).toEqual(createAdoptionJournal('prepared'));
      await successor.roots!.assertRecoveredPayloadAbsent();
      expect(await readFile(f.source, 'utf8')).toBe('synthetic preserved legacy bytes');
      expect(await fileBytes(f.paths.binding.currentPath)).toEqual(f.bindingBytes);
    });

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

async function interruptedRecoveryFixture(context: TestContext, branch: 'empty' | 'candidate' | 'published') {
  const f = await fixture(context);
  const adoptionPaths = deriveWorkspaceLegacyAdoptionPaths(f.root, TEST_ADOPTION_OPERATION_ID, TEST_ADOPTION_WORKSPACE_ID);
  const source = join(adoptionPaths.legacyRuntimeRoot, 'data', 'eky.sqlite');
  await mkdir(join(adoptionPaths.legacyRuntimeRoot, 'data'), { recursive: true, mode: 0o700 });
  await mkdir(join(adoptionPaths.legacyRuntimeRoot, 'storage', 'invoices'), { recursive: true, mode: 0o700 });
  await writeFile(source, 'synthetic preserved legacy bytes');
  const preparing = f.phase(await f.observe());
  const initialStore = new NodeWorkspaceLegacyAdoptionRootStore();
  await preparing.metadata.journal.write(createAdoptionJournal('prepared'));
  if (branch !== 'empty') {
    await initialStore.prepareCandidate(adoptionPaths, 'legacy');
    await preparing.metadata.journal.write(createAdoptionJournal('candidatePrepared'));
  }
  if (branch === 'published') {
    await initialStore.publishCandidate(adoptionPaths);
    await preparing.metadata.journal.write(createAdoptionJournal('rootPublished'));
  }
  await preparing.binding.publish(profileId);
  await preparing.metadata.journal.write(createAdoptionJournal('recoveryRequired'));
  preparing.state.current = false;
  const bindingBytes = await fileBytes(f.paths.binding.currentPath);
  const roots = await WorkspaceLegacyAdoptionRootSelection.observe(adoptionPaths, {
    assertMutationCurrent() {}, onUncertain: f.onUncertain,
  });
  const journalClear = vi.spyOn(f.journal, 'clearSelected');
  const recovering = f.phase(await f.observe(), roots);
  const checks = {
    assertBindingCurrent: vi.fn(async () => recovering.binding.assertObservedCurrent()),
    assertPayloadAbsent: vi.fn(async () => recovering.roots!.assertRecoveredPayloadAbsent()),
  };
  const recoveryOptions = {
    journal: recovering.metadata.journal, registry: recovering.metadata.registry,
    rootStore: new NodeWorkspaceLegacyAdoptionRootStore(recovering.roots), userDataRoot: f.root,
    boundRecovery: {
      async assertCurrent() {
        await recovering.binding.assertPublished(profileId);
        await recovering.metadata.assertRegistryAbsentCurrent();
      },
      prepareRecoveredSelection: () => recovering.metadata.prepareRecoveredSelection(checks),
    },
  };
  return { ...f, adoptionPaths, source, recovering, bindingBytes, journalClear, checks, recoveryOptions };
}

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
