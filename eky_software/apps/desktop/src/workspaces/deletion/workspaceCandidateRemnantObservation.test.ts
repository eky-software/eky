import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { observeWorkspaceCandidateRemnants } from './workspaceCandidateRemnantEnumeration.js';
import * as candidateSelection from './workspaceCandidateRemnantSelection.js';
import { captureWorkspaceCandidateRemnantObservation as observe,
  captureWorkspaceCandidateRemnantSelection as capture } from './workspaceCandidateRemnantSelection.js';
import { candidateObservationFixture, candidateObservationOwners as owners,
  candidateObservationTree as tree } from './workspaceCandidateRemnantObservationTestSupport.js';
import { clearAbsentWorkspaceDeletionBinding } from './workspaceDeletionBindingCleanup.js';
import { deletionTestHeader, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { observeWorkspaceDeletionRemnants } from './workspaceDeletionRemnantCensus.js';
import { workspaceInspectionRemnantReads as nativeReads } from './workspaceInspectionRemnantAbsence.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type Observation = Awaited<ReturnType<typeof observe>>;
const noCleanupKeys: Extract<keyof Observation, 'ownerSlots' | 'assertPayloadsAbsent'> extends never ? true : never = true;
const dataKeys = ['binding', 'bindingSha256', 'role', 'rootPath', 'parentPath',
  'rootIdentity', 'parentIdentity', 'ancestors'] as const;
const readers = [{ name: 'strict', capture }, { name: 'observation', capture: observe }] as const;
const phases = ['capture', 'receipt'] as const;

async function fixture(context: TestContext, owner: typeof owners[number]) {
  const f = await candidateObservationFixture(context, owner);
  await f.publish(); await f.addPayload();
  const foreign = join(f.candidate.operationRoot, id(8));
  await mkdir(foreign, { mode: 0o700 });
  await writeFile(join(foreign, 'keep'), 'other-company', { flag: 'wx', mode: 0o600 });
  await writeFile(join(f.root, 'unrelated'), 'unrelated-bytes', { flag: 'wx', mode: 0o600 });
  return { ...f, foreign };
}

it.for(owners)('keeps strict default reads and a frozen nine-key %s observation without cleanup authority', async (owner, context) => {
  const f = await fixture(context, owner), before = await tree(f.root);
  const identity = await lstat(f.paths.currentPath);
  // Delegate every inspect to the real store: these count physical binding rounds, not mock returns.
  const inspect = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect');
  context.onTestFinished(() => { inspect.mockRestore(); });
  const strict = await f.track(capture(f.root, f.binding.operationId, f.binding.workspaceId, f.authority));
  expect(inspect).toHaveBeenCalledTimes(6);
  inspect.mockClear();
  await f.track(strict.assertSelected());
  expect(inspect).toHaveBeenCalledTimes(6);
  expect(typeof strict.assertPayloadsAbsent).toBe('function');
  expect(strict.ownerSlots.current).toBeDefined();
  inspect.mockClear();
  const selected = await f.track(observe(f.root, f.binding.operationId, f.binding.workspaceId, f.authority));
  expect(inspect).toHaveBeenCalledTimes(4);
  inspect.mockClear();
  await f.track(selected.assertSelected());
  expect(inspect).toHaveBeenCalledTimes(4);
  expect(Object.isFrozen(selected)).toBe(true);
  expect(Reflect.ownKeys(selected).sort()).toEqual([...dataKeys, 'assertSelected'].sort());
  expect('ownerSlots' in selected).toBe(false);
  expect('assertPayloadsAbsent' in selected).toBe(false);
  expect(noCleanupKeys).toBe(true);
  expect(dataKeys.map(key => selected[key])).toEqual(dataKeys.map(key => strict[key]));
  expect(await tree(f.root)).toEqual(before);
  expect(sameCrashSafeFileSlotIdentity(identity, await lstat(f.paths.currentPath))).toBe(true);
});

it.for(owners.flatMap(owner => phases.map(phase => ({ owner, phase }))))(
  'distinguishes the transient NEXT midpoint in $owner $phase without rewriting CURRENT', async ({ owner, phase }, context) => {
    for (const reader of readers) {
      const f = await fixture(context, owner), before = await tree(f.root);
      const original = await readFile(f.paths.currentPath), identity = await lstat(f.paths.currentPath);
      let armed = phase === 'capture', rootReads = 0, inserted = false, removed = false;
      let during: Record<string, string> | undefined;
      const reads = { ...nativeReads, async directoryIdentity(path: string, guard: () => void) {
        const atRoot = armed && path === f.candidate.candidateRoot;
        if (atRoot) rootReads++;
        if (atRoot && rootReads === 3) { await rm(f.paths.nextPath); removed = true; }
        const value = await nativeReads.directoryIdentity(path, guard);
        if (atRoot && rootReads === 2) {
          await writeFile(f.paths.nextPath, original, { flag: 'wx', mode: 0o600 }); inserted = true;
          during = await tree(f.root);
        }
        return value;
      } };
      const selected = phase === 'receipt'
        ? await f.track<Observation>(reader.capture(f.root, f.binding.operationId, f.binding.workspaceId, f.authority, reads)) : undefined;
      armed = true; rootReads = 0;
      const work = selected === undefined
        ? f.track<Observation>(reader.capture(f.root, f.binding.operationId, f.binding.workspaceId, f.authority, reads))
        : f.track(selected.assertSelected());
      if (reader.name === 'strict') await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      else await work;
      expect(inserted).toBe(true);
      expect(rootReads).toBe(reader.name === 'strict' ? 2 : 4);
      expect(removed).toBe(reader.name === 'observation');
      expect(during).toBeDefined();
      expect(await tree(f.root)).toEqual(reader.name === 'strict' ? during : before);
      expect((await readFile(f.paths.currentPath)).equals(original)).toBe(true);
      expect(sameCrashSafeFileSlotIdentity(identity, await lstat(f.paths.currentPath))).toBe(true);
    }
  });

it.for(owners.flatMap(owner => phases.flatMap(phase =>
  (['binding', 'root'] as const).map(change => ({ owner, phase, change })))))(
  'rejects persistent $change changes in both $owner readers during $phase', async ({ owner, phase, change }, context) => {
    for (const reader of readers) {
      const f = await fixture(context, owner);
      const original = await readFile(f.paths.currentPath), identity = await lstat(f.paths.currentPath);
      const retained = join(f.root, 'retained-original-root');
      let changed = false, rootReads = 0, changedTree: Record<string, string> | undefined;
      const inject = async () => {
        if (change === 'binding') await writeFile(f.paths.nextPath, original, { flag: 'wx', mode: 0o600 });
        else { await rename(f.candidate.candidateRoot, retained); await f.addPayload(); }
        changed = true; changedTree = await tree(f.root);
      };
      const reads = { ...nativeReads, async directoryIdentity(path: string, guard: () => void) {
        const value = await nativeReads.directoryIdentity(path, guard);
        if (path === f.candidate.candidateRoot && ++rootReads === 2 && phase === 'capture') await inject();
        return value;
      } };
      const selected = phase === 'receipt'
        ? await f.track<Observation>(reader.capture(f.root, f.binding.operationId, f.binding.workspaceId, f.authority, reads)) : undefined;
      if (selected !== undefined) await inject();
      const work = selected === undefined
        ? f.track<Observation>(reader.capture(f.root, f.binding.operationId, f.binding.workspaceId, f.authority, reads))
        : f.track(selected.assertSelected());
      await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      expect(changed).toBe(true); expect(changedTree).toBeDefined();
      expect(await tree(f.root)).toEqual(changedTree);
      expect((await readFile(f.paths.currentPath)).equals(original)).toBe(true);
      expect(sameCrashSafeFileSlotIdentity(identity, await lstat(f.paths.currentPath))).toBe(true);
      expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
      if (change === 'root') expect(await readFile(join(retained, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
      expect(await readFile(join(f.foreign, 'keep'), 'utf8')).toBe('other-company');
      expect(await readFile(join(f.root, 'unrelated'), 'utf8')).toBe('unrelated-bytes');
    }
  });

it('joins the held real observation read after lease expiry and preserves the first cause', async context => {
  const f = await fixture(context, 'workspaceImport'), before = await tree(f.root);
  const identity = await lstat(f.paths.currentPath);
  let armed = false, release!: () => void, enter!: () => void, settled = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let firstAuthorityCause: unknown;
  const originalAuthority = f.authority.assertAuthority;
  f.authority.assertAuthority = () => {
    try { originalAuthority(); } catch (error) { firstAuthorityCause ??= error; throw firstAuthorityCause; }
  };
  const selected = await f.track(observe(f.root, f.binding.operationId, f.binding.workspaceId, f.authority,
    { ...nativeReads, async directoryIdentity(path, guard) {
      const value = await nativeReads.directoryIdentity(path, guard);
      if (armed && path === f.candidate.candidateRoot) { enter(); await pending; }
      return value;
    } }));
  armed = true;
  const work = selected.assertSelected();
  void work.then(() => { settled = true; }, () => { settled = true; });
  context.onTestFinished(async () => { release(); await work.catch(() => undefined); });
  await entered; f.expire(); expect(settled).toBe(false); release();
  let failure: unknown;
  try { await work; } catch (error) { failure = error; }
  expect(settled).toBe(true);
  expect(firstAuthorityCause).toBeDefined(); expect(failure).toBe(firstAuthorityCause);
  expect(failure).toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(await tree(f.root)).toEqual(before);
  expect(sameCrashSafeFileSlotIdentity(identity, await lstat(f.paths.currentPath))).toBe(true);
});

it('routes actual census and operation enumeration through observation, never strict capture', async context => {
  const f = await candidateObservationFixture(context, 'workspaceImport');
  await f.publish(); await f.addPayload();
  const before = await tree(f.root);
  const observation = vi.spyOn(candidateSelection, 'captureWorkspaceCandidateRemnantObservation');
  const strict = vi.spyOn(candidateSelection, 'captureWorkspaceCandidateRemnantSelection');
  context.onTestFinished(() => { observation.mockRestore(); strict.mockRestore(); });
  let censusCandidates = 0;
  for await (const row of observeWorkspaceDeletionRemnants(f.root, f.authority)) {
    if (row.kind === 'metadataCandidate' || (row.kind === 'candidateSource' && row.observation.kind === 'candidate')) censusCandidates++;
  }
  expect(censusCandidates).toBe(2);
  expect(observation).toHaveBeenCalled(); expect(strict).not.toHaveBeenCalled();
  observation.mockClear();
  let enumerated = 0;
  for await (const row of observeWorkspaceCandidateRemnants(f.root, f.binding.operationId, f.authority)) {
    enumerated++; expect(row.binding).toEqual(f.binding);
    expect('assertPayloadsAbsent' in row).toBe(false); expect('ownerSlots' in row).toBe(false);
  }
  expect(enumerated).toBe(1);
  expect(observation).toHaveBeenCalledOnce(); expect(strict).not.toHaveBeenCalled();
  expect(await tree(f.root)).toEqual(before);
});

it('keeps actual payloadless BindingCleanup on strict capture only', async context => {
  const f = await candidateObservationFixture(context, 'workspaceImport'); await f.publish();
  const unrelated = join(f.root, 'unrelated');
  await writeFile(unrelated, 'retained-unrelated', { flag: 'wx', mode: 0o600 });
  const observation = vi.spyOn(candidateSelection, 'captureWorkspaceCandidateRemnantObservation');
  const strict = vi.spyOn(candidateSelection, 'captureWorkspaceCandidateRemnantSelection');
  context.onTestFinished(() => { observation.mockRestore(); strict.mockRestore(); });
  await f.track(clearAbsentWorkspaceDeletionBinding(f.root, deletionTestHeader, f.binding, f.authority, { fileSystem: f.fileSystem }));
  expect(strict).toHaveBeenCalledOnce(); expect(observation).not.toHaveBeenCalled();
  expect((await f.store().inspect(f.authority)).mode).toBe('absent');
  await expect(readdir(f.candidate.operationsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(unrelated, 'utf8')).toBe('retained-unrelated');
});
