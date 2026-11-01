import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { deletionTestHeader, deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture, remnantBindingTestOwners } from './workspaceRemnantBindingTestSupport.js';

const targetFor = (f: Awaited<ReturnType<typeof remnantBindingFixture>>) => captureDeletionInventoryHeader({
  ...deletionTestHeader, workspaceId: f.binding.workspaceId, lineageIdentity: f.binding.lineageIdentity,
});

it.for(remnantBindingTestOwners)('clears committed $0 metadata after all payloads are gone', async (owner, test) => {
  const f = await remnantBindingFixture(test, owner);
  await f.store().publish(f.binding, f.authority);
  const target = targetFor(f);
  await f.store().clearCommittedAfterPayloadsAbsent(target, f.cleanup('deletionPurged'));
  await f.store().clearCommittedAfterPayloadsAbsent(target, f.cleanup('deletionPurged'));
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it.for(['next', 'backup', 'current'] as const)('resumes from only the committed %s slot without a reconstructed binding', async (slot, test) => {
  const f = await remnantBindingFixture(test, 'workspaceLegacyAdoption');
  await f.prepare();
  await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600, flag: 'wx' });
  if (slot !== 'current') await expect(f.store().inspect(f.authority)).rejects.toThrow();
  await f.store().clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'));
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('confirms fully absent legacy metadata without inventing its original operation ID or creating a directory', async test => {
  const f = await remnantBindingFixture(test, 'workspaceLegacyAdoption');
  await f.store().clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'));
  expect(await readdir(f.root)).toEqual([]);
});

it.for(['mode', 'target', 'lineage', 'digest', 'foreign', 'malformed'] as const)(
  'preserves every slot when committed cleanup observes %s conflict', async (change, test) => {
    const f = await remnantBindingFixture(test); await f.store().publish(f.binding, f.authority);
    await writeFile(f.paths.backupPath, change === 'malformed' ? '{' : serializeWorkspaceRemnantBinding(change === 'foreign'
      ? captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(9) }) : f.binding), { mode: 0o600, flag: 'wx' });
    const before = await f.snapshot();
    const target = { ...targetFor(f), ...(change === 'target' ? { workspaceId: id(8) } : {}),
      ...(change === 'lineage' ? { lineageIdentity: { formatVersion: 1, profileId: hash('other') } } : {}) };
    const proof = { ...f.cleanup(change === 'mode' ? 'owner' : 'deletionPurged'),
      ...(change === 'digest' ? { bindingSha256: hash('different') } : {}) };
    await expect(f.store().clearCommittedAfterPayloadsAbsent(target, proof)).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  },
);

it.for(['before', 'after'] as const)('retains selected bytes and resumes after %s the last metadata removal', async (timing, test) => {
  const f = await remnantBindingFixture(test, 'workspaceLegacyAdoption');
  await f.store().publish(f.binding, f.authority);
  const first = new Error('SYNTHETIC_CLEANUP_CUT'), remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  f.fileSystem.removeSlot = async (...args) => {
    if (timing === 'before') throw first;
    await remove(...args); throw first;
  };
  await expect(f.store().clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'))).rejects.toBe(first);
  expect(await readdir(f.paths.directoryPath)).toHaveLength(timing === 'before' ? 1 : 0);
  f.fileSystem.removeSlot = remove;
  await f.store().clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'));
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('rejects a same-byte replacement selected after observation and retains both versions', async test => {
  const f = await remnantBindingFixture(test); await f.store().publish(f.binding, f.authority);
  const bytes = await readFile(f.paths.currentPath), retained = join(f.root, 'retained-binding');
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  f.fileSystem.removeSlot = async (...args) => {
    await rename(f.paths.currentPath, retained);
    await writeFile(f.paths.currentPath, bytes, { mode: 0o600, flag: 'wx' });
    return remove(...args);
  };
  await expect(f.store().clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'))).rejects.toThrow();
  expect(await readFile(retained)).toEqual(bytes); expect(await readFile(f.paths.currentPath)).toEqual(bytes);
});

it('joins pending cleanup, preserves owner failure and refuses concurrent access', async test => {
  const f = await remnantBindingFixture(test); const store = f.store(); await store.publish(f.binding, f.authority);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  f.fileSystem.removeSlot = async (...args) => { entered(); await pending; return remove(...args); };
  let settled = false;
  const result = store.clearCommittedAfterPayloadsAbsent(targetFor(f), f.cleanup('deletionPurged'))
    .then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_NOT_PENDING'); })]);
    await expect(store.inspect(f.authority)).rejects.toThrow();
    f.expire(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});
