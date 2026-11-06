import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { captureWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { deletionTestDigest as hash, deletionTestId as id } from '../deletion/workspaceDeletionDataTestSupport.js';
import { createWorkspaceLegacyAdoptionJournalPaths, maximumWorkspaceLegacyAdoptionJournalBytes,
  captureWorkspaceLegacyAdoptionDeletionSlots, serializeWorkspaceLegacyAdoptionJournal, WorkspaceLegacyAdoptionJournalStore } from './workspaceLegacyAdoptionJournal.js';
import { createAdoptionJournal } from './workspaceLegacyAdoptionTestSupport.js';

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-deletion-cleanup-')); await chmod(root, 0o700);
  const paths = createWorkspaceLegacyAdoptionJournalPaths(root); await mkdir(paths.directoryPath, { mode: 0o700 });
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceLegacyAdoptionJournalBytes);
  const store = new WorkspaceLegacyAdoptionJournalStore(root, fs);
  const base = createAdoptionJournal('prepared');
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceLegacyAdoption', operationId: base.operationId,
    workspaceId: base.workspaceId, lineageIdentity: { formatVersion: 1, profileId: hash('synthetic-lineage') } });
  let active = true, purged = true;
  const ownerError = new Error('SYNTHETIC_DELETION_OWNER_LOST'), phaseError = new Error('SYNTHETIC_NOT_PURGED');
  const jobs: Promise<unknown>[] = [];
  const assertAuthority = () => { test.signal.throwIfAborted(); if (!active) throw ownerError; };
  const onUncertain = vi.fn();
  const authority = { assertAuthority, async assertExternalSelection() { assertAuthority(); }, onUncertain,
    async assertDeletionPurged() { assertAuthority(); if (!purged) throw phaseError; } };
  const select = async () => {
    const slots = await store.inspectSlots(assertAuthority);
    return { ...authority,
      expectedSlots: { current: slots.current?.bytes, backup: slots.backup?.bytes, next: slots.next?.bytes },
      expectedIdentities: { current: slots.current?.identity, backup: slots.backup?.identity, next: slots.next?.identity } };
  };
  test.onTestFinished(async () => {
    active = false; await Promise.allSettled(jobs);
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  return { root, paths, fs, store, base, binding, select, onUncertain, ownerError, phaseError,
    revoke() { active = false; }, notPurged() { purged = false; },
    run: async (selection?: Awaited<ReturnType<typeof select>>) => {
      const result = store.clearAfterDeletionPurged(binding, selection ?? await select()); jobs.push(result); return result;
    },
    write: (slot: 'current' | 'backup' | 'next', value = base) => writeFile(paths[`${slot}Path`], serializeWorkspaceLegacyAdoptionJournal(value),
      { mode: 0o600, flag: 'wx' }),
    async snapshot() { const result: Record<string, string> = {};
      for (const name of await readdir(paths.directoryPath)) result[name] = (await readFile(join(paths.directoryPath, name))).toString('hex');
      return result; },
  };
}

it('validates real legacy slots without changing them or invoking the purged callback', async test => {
  const f = await fixture(test);
  await f.write('backup', createAdoptionJournal('recoveryRequired')); await f.write('current');
  f.notPurged();
  const writes = (['createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory'] as const).map(name => vi.spyOn(f.fs, name));
  try {
    const input = await f.select(), before = await f.snapshot();
    const purged = vi.fn(input.assertDeletionPurged);
    const probe = { ...input, assertDeletionPurged: purged };
    expect(captureWorkspaceLegacyAdoptionDeletionSlots(f.binding, probe)).toEqual({
      expectedSlots: input.expectedSlots, expectedIdentities: input.expectedIdentities,
    });
    expect(await f.snapshot()).toEqual(before);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(purged).not.toHaveBeenCalled();
    expect(f.onUncertain).not.toHaveBeenCalled();
  } finally { for (const write of writes) write.mockRestore(); }
});

it.for(['prepared', 'candidatePrepared', 'rootPublished', 'registryPublished', 'recoveryRequired'] as const)(
  'retires only the bound legacy journal in %s after deletion proof', async (state, test) => {
    const f = await fixture(test); await f.write('current', createAdoptionJournal(state));
    await f.run(); await f.run(); expect(await readdir(f.paths.directoryPath)).toEqual([]);
  },
);

it.for(['next', 'backup'] as const)('clears a committed %s-only remainder without promotion', async (slot, test) => {
  const f = await fixture(test); await f.write(slot); await f.run();
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('admits the existing legacy recovery reset relationship without changing ordinary transition rules', async test => {
  const f = await fixture(test); await f.write('backup', createAdoptionJournal('recoveryRequired')); await f.write('current');
  await f.run(); expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it.for(['operation', 'workspace', 'fresh', 'backwards', 'malformed', 'bindingOwner', 'phase', 'threeSlots'] as const)(
  'retains every observed byte for %s conflict', async (change, test) => {
    const f = await fixture(test); await f.write('current', change === 'backwards' ? createAdoptionJournal('candidatePrepared') : f.base);
    if (change === 'malformed') await writeFile(f.paths.nextPath, '{', { mode: 0o600, flag: 'wx' });
    else if (change !== 'bindingOwner' && change !== 'phase') await f.write('next', { ...f.base,
      ...(change === 'operation' ? { operationId: id(9) } : {}),
      ...(change === 'workspace' ? { workspaceId: validateWorkspaceId(id(8)) } : {}),
      ...(change === 'fresh' ? { sourceKind: 'fresh' } : {}) });
    if (change === 'phase') f.notPurged();
    if (change === 'threeSlots') await f.write('backup');
    const before = await f.snapshot();
    if (change === 'bindingOwner') await expect(f.store.clearAfterDeletionPurged(
      { ...f.binding, owner: 'workspaceImport' }, await f.select())).rejects.toThrow();
    else await expect(f.run()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['next', 'backup', 'current', 'sync'] as const)('resumes exact surviving slots after a %s cleanup acknowledgement cut', async (cut, test) => {
  const f = await fixture(test); await f.write('current');
  if (cut === 'next' || cut === 'backup') await f.write(cut);
  const first = new Error('SYNTHETIC_NATIVE_CLEANUP_CUT'), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.removeSlot = async (...args) => { const result = await remove(...args); if (args[0] === cut) throw first; return result; };
  f.fs.syncDirectory = async (...args) => { await sync(...args); if (cut === 'sync') throw first; };
  await expect(f.run()).rejects.toThrow(); expect(f.onUncertain).toHaveBeenLastCalledWith(first);
  const retained = await f.snapshot();
  for (const value of Object.values(retained)) expect(value).toBe(Buffer.from(serializeWorkspaceLegacyAdoptionJournal(f.base)).toString('hex'));
  f.fs.removeSlot = remove; f.fs.syncDirectory = sync;
  await f.run(); expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('retains a new same-byte journal identity instead of adopting it', async test => {
  const f = await fixture(test); await f.write('current'); const selected = await f.select();
  const bytes = await readFile(f.paths.currentPath); await rename(f.paths.currentPath, join(f.root, 'retained-journal')); await f.write('current');
  await expect(f.run(selected)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(bytes); expect(await readFile(join(f.root, 'retained-journal'))).toEqual(bytes);
});

it('rejects an identity supplied for an absent side slot', async test => {
  const f = await fixture(test); await f.write('current'); const selected = await f.select();
  const before = await f.snapshot();
  selected.expectedIdentities.next = selected.expectedIdentities.current;
  await expect(f.run(selected)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('joins pending native work and preserves revocation before any remaining deletion', async test => {
  const f = await fixture(test); await f.write('current');
  const remove = f.fs.removeSlot.bind(f.fs); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.fs.removeSlot = async (...args) => { entered(); await held; return remove(...args); };
  let settled = false;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_NO_PENDING_REMOVE'); })]);
    await expect(f.store.inspectSlots(() => {})).rejects.toThrow();
    f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toBe(f.ownerError);
  expect(await readFile(f.paths.currentPath)).toEqual(Buffer.from(serializeWorkspaceLegacyAdoptionJournal(f.base)));
});
