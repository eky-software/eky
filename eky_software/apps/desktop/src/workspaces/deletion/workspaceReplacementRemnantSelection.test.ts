import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { workspaceInspectionRemnantReads as nativeReads } from './workspaceInspectionRemnantAbsence.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents, deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceReplacementRemnantSelection as capture } from './workspaceReplacementRemnantSelection.js';

async function fixture(context: TestContext, owner: 'workspaceReplacement' | 'workspaceActivationMigration' = 'workspaceReplacement') {
  const f = await remnantBindingFixture(context, owner);
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const parents = deriveWorkspaceReplacementRemnantParents(f.root, f.binding.workspaceId);
  const roots = parents.map(parent => ({ ...parent,
    ...deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, parent.role) }));
  const addPayload = async (index: number) => {
    const path = roots[index]!.rootPath;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, 'retained-data'), `synthetic-${index}`, { mode: 0o600 });
  };
  const publish = () => f.store().publish(f.binding, authority);
  return { ...f, authority, roots, addPayload, publish, unsettled() { writersAbsent = false; },
    capture: (reads = nativeReads) => capture(f.root, f.binding.operationId, authority, reads) };
}

it.for(['workspaceReplacement', 'workspaceActivationMigration'] as const)(
  'binds the actual roots for %s without modifying payloads or metadata', async (owner, context) => {
    const f = await fixture(context, owner);
    await f.publish();
    for (let index = owner === 'workspaceReplacement' ? 0 : 1; index < f.roots.length; index++) await f.addPayload(index);
    const before = await f.snapshot();
    const selected = await f.capture();
    expect(selected.binding).toEqual(f.binding);
    expect(selected.roots.map(row => row.rootPath)).toEqual(f.roots.map(row => row.rootPath));
    expect(selected.roots.filter(row => row.rootIdentity !== null)).toHaveLength(owner === 'workspaceReplacement' ? 4 : 3);
    await selected.assertSelected();
    expect(await f.snapshot()).toEqual(before);
    for (let index = owner === 'workspaceReplacement' ? 0 : 1; index < f.roots.length; index++) {
      expect(await readFile(join(f.roots[index]!.rootPath, 'retained-data'), 'utf8')).toBe(`synthetic-${index}`);
    }
  });

it('observes missing payloads without creating operation parents or deleting metadata', async context => {
  const f = await fixture(context);
  await f.publish();
  const before = await f.snapshot();
  const selected = await f.capture();
  expect(selected.roots.every(row => row.rootIdentity === null && row.parentIdentity === null)).toBe(true);
  await selected.assertSelected();
  expect(await f.snapshot()).toEqual(before);
  for (const row of f.roots) await expect(readFile(row.parentPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects a competing owner introduced by the final absence read', async context => {
  const f = await fixture(context); await f.publish();
  const other = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
  let armed = false, reads = 0;
  const selected = await f.capture({ ...nativeReads, async assertAbsent(path, guard) {
    await nativeReads.assertAbsent(path, guard);
    if (armed && path === f.roots.at(-1)!.rootPath && ++reads === 4) {
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other)).publish(other, f.authority);
    }
  } });
  armed = true;
  const work = selected.assertPayloadsAbsent();
  context.onTestFinished(async () => { await work.catch(() => undefined); });
  await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(reads).toBe(4);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('returns foreign company ownership explicitly and preserves both companies', async context => {
  const f = await fixture(context);
  const foreign = captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(8), lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } });
  await f.store().publish(foreign, f.authority);
  await f.addPayload(1);
  const unrelated = join(f.root, 'unrelated-company');
  await writeFile(unrelated, 'retained-other-company', { mode: 0o600 });
  const selected = await f.capture();
  expect(selected.binding.workspaceId).toBe(foreign.workspaceId);
  expect(selected.binding.lineageIdentity).toEqual(foreign.lineageIdentity);
  await selected.assertSelected();
  expect(await readFile(unrelated, 'utf8')).toBe('retained-other-company');
  expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
});

it.for(['absent', 'both', 'nextOnly', 'conflictingBackup'] as const)(
  'rejects %s binding ownership while retaining the actual payload', async (mode, context) => {
    const f = await fixture(context);
    await f.addPayload(1);
    if (mode === 'nextOnly') {
      await f.prepare(); await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    } else if (mode !== 'absent') {
      await f.publish();
      if (mode === 'both') {
        const other = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
        await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other)).publish(other, f.authority);
      } else await writeFile(f.paths.backupPath,
        serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(8) })), { mode: 0o600 });
    }
    await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
  });

it('does not grant migration ownership of a backup-import root with the same operation id', async context => {
  const f = await fixture(context, 'workspaceActivationMigration');
  await f.publish(); await f.addPayload(0);
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(f.roots[0]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-0');
});

it.for(['root', 'ancestor', 'newPayload', 'otherOwner', 'sideSlot', 'rawBytes'] as const)(
  'invalidates a captured selection on %s change and retains the changed state', async (mode, context) => {
    const f = await fixture(context);
    await f.publish(); await f.addPayload(1);
    const selected = await f.capture();
    if (mode === 'root') {
      await rename(f.roots[1]!.rootPath, join(f.root, 'retained-root')); await f.addPayload(1);
    } else if (mode === 'ancestor') {
      const parent = f.roots[1]!.parentPath, retained = join(f.root, 'retained-parent');
      await rename(parent, retained); await mkdir(parent, { mode: 0o700 });
      await rename(join(retained, f.binding.operationId), f.roots[1]!.rootPath);
    } else if (mode === 'newPayload') await f.addPayload(2);
    else if (mode === 'otherOwner') {
      const other = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other)).publish(other, f.authority);
    } else if (mode === 'sideSlot') await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    else await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.binding).toString()}`, { mode: 0o600 });
    const before = await f.snapshot();
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  });

it.for(['root', 'parent'] as const)('rejects a linked %s without touching its target', async (kind, context) => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload(1);
  const linkPath = kind === 'root' ? f.roots[1]!.rootPath : f.roots[1]!.parentPath;
  const saved = join(f.root, 'retained-linked-directory');
  await rename(linkPath, saved); await symlink(saved, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.capture()).rejects.toThrow();
  const data = kind === 'root' ? join(saved, 'retained-data') : join(saved, f.binding.operationId, 'retained-data');
  expect(await readFile(data, 'utf8')).toBe('synthetic-1');
});

it.for(['lease', 'target', 'writer'] as const)('refuses a changed %s authority', async (kind, context) => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload(1);
  const selected = await f.capture();
  if (kind === 'lease') f.expire();
  else if (kind === 'target') f.changeTarget();
  else f.unsettled();
  await expect(selected.assertSelected()).rejects.toThrow(/SYNTHETIC_/);
  expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
});

it('joins a pending identity read before reporting lost authority', async context => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload(1);
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const work = f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
    if (path === f.roots[1]!.rootPath) { entered(); await pending; }
    return nativeReads.directoryIdentity(path, guard);
  } });
  void work.then(() => { settled = true; }, () => { settled = true; });
  let asserted = false;
  context.onTestFinished(async () => {
    release();
    try { await work; } catch (error) { if (!asserted && error !== context.signal.reason) throw error; }
  });
  await started; f.expire();
  expect(settled).toBe(false);
  release();
  await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  asserted = true;
  expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
});

it('does not recover a failed selection when original metadata returns', async context => {
  const f = await fixture(context);
  await f.publish();
  const other = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
  const otherPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(other));
  await mkdir(otherPaths.directoryPath, { recursive: true, mode: 0o700 });
  const selected = await f.capture();
  await writeFile(otherPaths.currentPath, serializeWorkspaceRemnantBinding(other), { mode: 0o600 });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  await rm(otherPaths.currentPath);
  await expect(f.capture()).resolves.toMatchObject({ binding: f.binding });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('rejects an earlier payload root replaced during the final metadata observation', async context => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload(1);
  let directoryReads = 0, changed = false;
  await expect(f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
    if (path === f.paths.directoryPath && ++directoryReads === 4) {
      await rename(f.roots[1]!.rootPath, join(f.root, 'retained-original-root'));
      await f.addPayload(1);
      changed = true;
    }
    return nativeReads.directoryIdentity(path, guard);
  } })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect(await readFile(join(f.root, 'retained-original-root', 'retained-data'), 'utf8')).toBe('synthetic-1');
  expect(await readFile(join(f.roots[1]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-1');
});

it.for(['present', 'absent'] as const)('rechecks writer closure after the last %s root observation', async (mode, context) => {
  const f = await fixture(context);
  await f.publish();
  if (mode === 'present') await f.addPayload(3);
  let lastRootReads = 0, changed = false;
  await expect(f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
    try { return await nativeReads.directoryIdentity(path, guard); }
    finally {
      if (path === f.roots[3]!.rootPath && ++lastRootReads === (mode === 'present' ? 4 : 2)) {
        f.unsettled(); changed = true;
      }
    }
  } })).rejects.toThrow('SYNTHETIC_WRITER_UNSETTLED');
  expect(changed).toBe(true);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it.for(['capture', 'recheck'] as const)('rejects a second owner appearing during the final payload read in %s', async (mode, context) => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload(3);
  const other = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
  const otherPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(other));
  await mkdir(otherPaths.directoryPath, { recursive: true, mode: 0o700 });
  let armed = mode === 'capture', lastRootReads = 0, changed = false;
  const reads = { ...nativeReads, async directoryIdentity(path: string, guard: () => void) {
    const result = await nativeReads.directoryIdentity(path, guard);
    if (armed && path === f.roots[3]!.rootPath && ++lastRootReads === 4) {
      await writeFile(otherPaths.currentPath, serializeWorkspaceRemnantBinding(other), { mode: 0o600 });
      changed = true;
    }
    return result;
  } };
  if (mode === 'capture') await expect(f.capture(reads)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  else {
    const selected = await f.capture(reads);
    armed = true;
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    await rm(otherPaths.currentPath);
    await expect(f.capture()).resolves.toMatchObject({ binding: f.binding });
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  }
  expect(changed).toBe(true);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  expect(await readFile(join(f.roots[3]!.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-3');
});
