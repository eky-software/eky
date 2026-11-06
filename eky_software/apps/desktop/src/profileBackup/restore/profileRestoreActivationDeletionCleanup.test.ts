import { chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../../workspaces/persistence/crashSafeFileSlot.js';
import { captureWorkspaceRemnantBinding } from '../../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { deletionTestId as id, deletionTestDigest as hash } from '../../workspaces/deletion/workspaceDeletionDataTestSupport.js';
import { profileRestoreActivationPhases, profileRestoreForwardActivationPhases,
  type ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import { captureProfileRestoreActivationDeletionSlots, ProfileRestoreActivationJournalStore,
  profileRestoreActivationJournalFileName } from './profileRestoreActivationJournalStore.js';

async function fixture(test: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-activation-deletion-cleanup-')); await chmod(root, 0o700);
  const paths = { directoryPath: root, currentPath: join(root, profileRestoreActivationJournalFileName),
    backupPath: join(root, `${profileRestoreActivationJournalFileName}.backup`), nextPath: join(root, `${profileRestoreActivationJournalFileName}.next`) };
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, 64 * 1024), store = new ProfileRestoreActivationJournalStore(paths.currentPath, fs);
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceReplacement', operationId: id(1), workspaceId: id(2),
    lineageIdentity: { formatVersion: 1, profileId: hash('lineage') } });
  const base: ProfileRestoreActivationJournal = { formatVersion: 1, operationId: binding.operationId, phase: 'prepared', revision: 0,
    hadActiveDatabase: true, hadActiveDocuments: true };
  let active = true, purged = true;
  const ownerError = new Error('SYNTHETIC_ACTIVATION_OWNER_LOST'), phaseError = new Error('SYNTHETIC_NOT_PURGED');
  const onUncertain = vi.fn(), jobs: Promise<unknown>[] = [];
  const assertAuthority = () => { test.signal.throwIfAborted(); if (!active) throw ownerError; };
  const select = async () => {
    const slots = await store.inspectDeletionSlots(assertAuthority);
    return { assertAuthority, onUncertain, async assertExternalSelection() { assertAuthority(); },
      async assertDeletionPurged() { assertAuthority(); if (!purged) throw phaseError; },
      expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
      expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity } };
  };
  test.onTestFinished(async () => {
    active = false; await Promise.allSettled(jobs);
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  return { root, paths, fs, store, base, binding, select, onUncertain, ownerError,
    revoke() { active = false; }, notPurged() { purged = false; },
    async run(selection?: Awaited<ReturnType<typeof select>>) {
      const result = store.clearAfterDeletionPurged(binding, selection ?? await select()); jobs.push(result); return result;
    },
    write(slot: 'current' | 'backup' | 'next', value = base) { return writeFile(paths[`${slot}Path`], `${JSON.stringify(value)}\n`,
      { mode: 0o600, flag: 'wx' }); },
    async snapshot() { const result: Record<string, string> = {};
      for (const name of await readdir(root)) result[name] = (await readFile(join(root, name))).toString('hex'); return result; },
  };
}

it('validates real activation slots without repair, file mutation or purged authority', async test => {
  const f = await fixture(test);
  await f.write('backup'); await f.write('current', { ...f.base, phase: 'movingCurrentDatabase', revision: 1 });
  f.notPurged();
  const writes = (['createNextWriter', 'moveSlot', 'removeSlot', 'syncDirectory'] as const).map(name => vi.spyOn(f.fs, name));
  try {
    const input = await f.select(), before = await f.snapshot();
    const purged = vi.fn(input.assertDeletionPurged);
    const probe = { ...input, assertDeletionPurged: purged };
    expect(captureProfileRestoreActivationDeletionSlots(f.binding, probe)).toEqual({
      expectedSlots: input.expectedSlots, expectedIdentities: input.expectedIdentities,
    });
    expect(await f.snapshot()).toEqual(before);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(purged).not.toHaveBeenCalled();
    expect(f.onUncertain).not.toHaveBeenCalled();
  } finally { for (const write of writes) write.mockRestore(); }
});

it.for(profileRestoreActivationPhases)('retires the selected %s phase only with explicit purged authority', async (phase, test) => {
  const f = await fixture(test); await f.write('current', { ...f.base, phase });
  await f.run(); await f.run(); expect(await readdir(f.root)).toEqual([]);
});

it.for(['current', 'backup', 'next'] as const)('clears an exact %s-only remainder without ordinary recovery', async (slot, test) => {
  const f = await fixture(test); await f.write(slot); await f.run(); expect(await readdir(f.root)).toEqual([]);
});

it.for([
  { before: 'accepted', after: 'prepared' },
  { before: 'rolledBack', after: 'validationStarting' },
  { before: 'failedSafe', after: 'rollbackStarting' },
  { before: 'prepared', after: 'stagedDatabaseActivated' },
  { before: 'prepared', after: 'prepared' },
] as const)('retains impossible +1 phase edge $before -> $after', async ({ before, after }, test) => {
  const f = await fixture(test); await f.write('backup', { ...f.base, phase: before, revision: 10 });
  await f.write('current', { ...f.base, phase: after, revision: 11 });
  const bytes = await f.snapshot();
  await expect(f.run()).rejects.toThrow(); expect(await f.snapshot()).toEqual(bytes);
});

it.for([
  ...profileRestoreForwardActivationPhases.slice(0, -1).map((before, index) => ({ before, after: profileRestoreForwardActivationPhases[index + 1]! })),
  ...profileRestoreForwardActivationPhases.map(before => ({ before, after: 'rollbackStarting' as const })),
  { before: 'validationStarting', after: 'accepted' },
  { before: 'rollbackStarting', after: 'rolledBack' },
  { before: 'rollbackStarting', after: 'failedSafe' },
] satisfies readonly { before: ProfileRestoreActivationJournal['phase']; after: ProfileRestoreActivationJournal['phase'] }[])(
  'admits the existing transaction edge $before -> $after', async ({ before, after }, test) => {
    const f = await fixture(test); await f.write('backup', { ...f.base, phase: before, revision: 10 });
    await f.write('current', { ...f.base, phase: after, revision: 11 }); await f.run();
    expect(await readdir(f.root)).toEqual([]);
  },
);

it.for(['operation', 'flags', 'revisionGap', 'sameRevisionPhase', 'backwards', 'malformed', 'owner', 'phase', 'threeSlots'] as const)(
  'preserves all bytes for a %s conflict', async (change, test) => {
    const f = await fixture(test); await f.write('current', change === 'backwards' ? { ...f.base, revision: 1 } : f.base);
    if (change === 'malformed') await writeFile(f.paths.nextPath, '{', { mode: 0o600, flag: 'wx' });
    else if (change !== 'owner' && change !== 'phase') await f.write('next', { ...f.base,
      ...(change === 'operation' ? { operationId: id(9) } : {}),
      ...(change === 'flags' ? { hadActiveDocuments: false } : {}),
      ...(change === 'revisionGap' ? { revision: 3 } : {}),
      ...(change === 'sameRevisionPhase' ? { phase: 'accepted' } : {}) });
    if (change === 'phase') f.notPurged();
    if (change === 'threeSlots') await f.write('backup');
    const before = await f.snapshot();
    if (change === 'owner') await expect(f.store.clearAfterDeletionPurged(
      { ...f.binding, owner: 'workspaceImport' }, await f.select())).rejects.toThrow();
    else await expect(f.run()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['beforePublication', 'afterPublication'] as const)('clears consecutive migration revisions %s', async (boundary, test) => {
  const f = await fixture(test);
  if (boundary === 'beforePublication') {
    await f.write('current'); await f.write('next', { ...f.base, phase: 'movingCurrentDatabase', revision: 1 });
  } else {
    await f.write('backup'); await f.write('current', { ...f.base, phase: 'movingCurrentDatabase', revision: 1 });
  }
  await f.store.clearAfterDeletionPurged({ ...f.binding, owner: 'workspaceActivationMigration' }, await f.select());
  expect(await readdir(f.root)).toEqual([]);
});

it.for(['next', 'backup', 'current', 'sync'] as const)('resumes retained slots after a %s acknowledgement cut', async (cut, test) => {
  const f = await fixture(test); await f.write('current');
  if (cut === 'next' || cut === 'backup') await f.write(cut);
  const first = new Error('SYNTHETIC_NATIVE_ACTIVATION_CUT'), remove = f.fs.removeSlot.bind(f.fs), sync = f.fs.syncDirectory.bind(f.fs);
  f.fs.removeSlot = async (...args) => { const result = await remove(...args); if (args[0] === cut) throw first; return result; };
  f.fs.syncDirectory = async (...args) => { await sync(...args); if (cut === 'sync') throw first; };
  await expect(f.run()).rejects.toBe(first); expect(f.onUncertain).toHaveBeenLastCalledWith(first);
  const bytes = Buffer.from(`${JSON.stringify(f.base)}\n`).toString('hex');
  for (const value of Object.values(await f.snapshot())) expect(value).toBe(bytes);
  f.fs.removeSlot = remove; f.fs.syncDirectory = sync; await f.run(); expect(await readdir(f.root)).toEqual([]);
});

it('rejects same-byte replacement of a selected activation journal', async test => {
  const f = await fixture(test); await f.write('current'); const selected = await f.select();
  const bytes = await readFile(f.paths.currentPath); await rename(f.paths.currentPath, join(f.root, 'preserved-original')); await f.write('current');
  await expect(f.run(selected)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(bytes); expect(await readFile(join(f.root, 'preserved-original'))).toEqual(bytes);
});

it('rejects an identity supplied for an absent side slot', async test => {
  const f = await fixture(test); await f.write('current'); const selected = await f.select();
  const before = await f.snapshot();
  selected.expectedIdentities.next = selected.expectedIdentities.current;
  await expect(f.run(selected)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it('joins pending native cleanup before releasing revoked ownership', async test => {
  const f = await fixture(test); await f.write('current'); const remove = f.fs.removeSlot.bind(f.fs);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.fs.removeSlot = async (...args) => { entered(); await held; return remove(...args); };
  let settled = false; const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_NOT_PENDING'); })]);
    await expect(f.store.inspectDeletionSlots(() => {})).rejects.toThrow(); f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toBe(f.ownerError);
  expect(await readFile(f.paths.currentPath, 'utf8')).toBe(`${JSON.stringify(f.base)}\n`);
});
