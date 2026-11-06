import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyAdoptionPaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { captureWorkspaceCandidateRemnantSelection as capture } from './workspaceCandidateRemnantSelection.js';
import { deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { workspaceInspectionRemnantReads as nativeReads } from './workspaceInspectionRemnantAbsence.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext, owner: 'workspaceImport' | 'workspaceLegacyAdoption' = 'workspaceImport') {
  const f = await remnantBindingFixture(context, owner);
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const paths = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId);
  const other = captureWorkspaceRemnantBinding({ ...f.binding,
    owner: owner === 'workspaceImport' ? 'workspaceLegacyAdoption' : 'workspaceImport' });
  const otherPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(other));
  const addPayload = async () => {
    await mkdir(paths.candidateRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(paths.candidateRoot, 'retained-data'), 'synthetic-candidate', { mode: 0o600 });
  };
  return { ...f, authority, paths: f.paths, candidate: paths, other, otherPaths, addPayload,
    async publish() { await f.store().publish(f.binding, authority); },
    async publishOther() { await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other)).publish(other, authority); },
    unsettled() { writersAbsent = false; },
    capture: (reads = nativeReads) => capture(f.root, f.binding.operationId, f.binding.workspaceId, authority, reads) };
}

it.for(['workspaceImport', 'workspaceLegacyAdoption'] as const)(
  'selects the actual %s candidate without selecting its shared parent or another company', async (owner, context) => {
    const f = await fixture(context, owner);
    await f.publish(); await f.addPayload();
    const foreign = join(f.candidate.operationRoot, id(8));
    await mkdir(foreign, { mode: 0o700 }); await writeFile(join(foreign, 'keep'), 'other-company', { mode: 0o600 });
    const before = await f.snapshot();
    const selected = await f.capture();
    const expected = owner === 'workspaceImport' ? f.candidate
      : deriveWorkspaceLegacyAdoptionPaths(f.root, f.binding.operationId, f.binding.workspaceId);
    expect(selected.rootPath).toBe(expected.candidateRoot);
    expect(selected.parentPath).toBe(expected.operationRoot);
    expect(selected.role).toBe(owner === 'workspaceImport' ? 'importCandidate' : 'adoptionCandidate');
    expect(selected.binding).toEqual(f.binding);
    expect(selected.rootIdentity).not.toBeNull();
    await selected.assertSelected();
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(foreign, 'keep'), 'utf8')).toBe('other-company');
    expect(await readFile(join(selected.rootPath, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
  });

it.for(['workspaceImport', 'workspaceLegacyAdoption'] as const)(
  'observes a missing %s candidate without creating parents or clearing its binding', async (owner, context) => {
    const f = await fixture(context, owner);
    await f.publish();
    const before = await f.snapshot();
    const selected = await f.capture();
    expect(selected.rootIdentity).toBeNull(); expect(selected.parentIdentity).toBeNull();
    await selected.assertSelected();
    expect(await f.snapshot()).toEqual(before);
    await expect(readdir(f.candidate.operationsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

it.for(['absent', 'both', 'nextOnly', 'backupOnly', 'conflict', 'wrongWorkspace', 'wrongOperation'] as const)(
  'rejects %s ownership without deleting the candidate', async (mode, context) => {
    const f = await fixture(context, mode === 'wrongOperation' ? 'workspaceLegacyAdoption' : 'workspaceImport');
    await f.addPayload();
    if (mode === 'nextOnly' || mode === 'backupOnly') {
      await f.prepare();
      await writeFile(mode === 'nextOnly' ? f.paths.nextPath : f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    } else if (mode === 'wrongWorkspace' || mode === 'wrongOperation') {
      const value = captureWorkspaceRemnantBinding({ ...f.binding,
        ...(mode === 'wrongWorkspace' ? { workspaceId: id(8) } : { operationId: id(8) }) });
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(value)).publish(value, f.authority);
    } else if (mode !== 'absent') {
      await f.publish();
      if (mode === 'both') await f.publishOther();
      else await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({
        ...f.binding, lineageIdentity: { formatVersion: 1, profileId: hash('other') },
      })), { mode: 0o600 });
    }
    await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
  });

it('keeps a legacy binding from another operation but does not use it to own an import candidate', async context => {
  const f = await fixture(context);
  await f.publish(); await f.addPayload();
  const legacy = captureWorkspaceRemnantBinding({ ...f.other, operationId: id(8) });
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(legacy)).publish(legacy, f.authority);
  const selected = await f.capture();
  expect(selected.role).toBe('importCandidate');
  await selected.assertSelected();
  expect((await readFile(f.otherPaths.currentPath)).equals(serializeWorkspaceRemnantBinding(legacy))).toBe(true);
});

it('rejects a competing owner introduced by the final absence read', async context => {
  const f = await fixture(context); await f.publish();
  let armed = false, reads = 0;
  const selected = await f.capture({ ...nativeReads, async assertAbsent(path, guard) {
    await nativeReads.assertAbsent(path, guard);
    if (armed && path === f.candidate.candidateRoot && ++reads === 4) await f.publishOther();
  } });
  armed = true;
  const work = selected.assertPayloadsAbsent();
  context.onTestFinished(async () => { await work.catch(() => undefined); });
  await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(reads).toBe(4);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('rejects a foreign-workspace import even when adoption matches the requested candidate', async context => {
  const f = await fixture(context, 'workspaceLegacyAdoption');
  await f.publish(); await f.addPayload();
  const foreign = captureWorkspaceRemnantBinding({ ...f.other, workspaceId: id(8) });
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(foreign)).publish(foreign, f.authority);
  const foreignRoot = deriveWorkspaceBackupImportPaths(f.root,
    validateWorkspaceBackupImportOperationId(foreign.operationId), foreign.workspaceId).candidateRoot;
  await mkdir(foreignRoot, { mode: 0o700 });
  await writeFile(join(foreignRoot, 'keep'), 'foreign-import', { mode: 0o600 });
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.snapshot()).toEqual(before);
  expect((await readFile(f.otherPaths.currentPath)).equals(serializeWorkspaceRemnantBinding(foreign))).toBe(true);
  expect(await readFile(join(foreignRoot, 'keep'), 'utf8')).toBe('foreign-import');
  expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it.for(['root', 'ancestor', 'newPayload', 'sideSlot', 'rawBytes', 'otherOwner'] as const)(
  'invalidates a selection after %s changes while retaining the actual files', async (mode, context) => {
    const f = await fixture(context);
    await f.publish(); if (mode !== 'newPayload') await f.addPayload();
    const selected = await f.capture();
    if (mode === 'root') {
      await rename(f.candidate.candidateRoot, join(f.root, 'retained-root')); await f.addPayload();
    } else if (mode === 'ancestor') {
      const saved = join(f.root, 'retained-parent');
      await rename(f.candidate.operationRoot, saved); await mkdir(f.candidate.operationRoot, { mode: 0o700 });
      await rename(join(saved, f.binding.workspaceId), f.candidate.candidateRoot);
    } else if (mode === 'newPayload') await f.addPayload();
    else if (mode === 'sideSlot') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    else if (mode === 'rawBytes') await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.binding).toString()}`, { mode: 0o600 });
    else await f.publishOther();
    const before = await f.snapshot();
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
  });

it.for(['root', 'parent'] as const)('rejects a linked %s without touching its target', async (mode, context) => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  const original = mode === 'root' ? f.candidate.candidateRoot : f.candidate.operationRoot;
  const saved = join(f.root, 'retained-linked-root');
  await rename(original, saved); await symlink(saved, original, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(f.capture()).rejects.toThrow();
  expect(await readFile(join(mode === 'root' ? saved : join(saved, f.binding.workspaceId), 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it.for(['lease', 'target', 'writer'] as const)('rejects lost %s authority', async (mode, context) => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  const selected = await f.capture();
  if (mode === 'lease') f.expire(); else if (mode === 'target') f.changeTarget(); else f.unsettled();
  await expect(selected.assertSelected()).rejects.toThrow(/SYNTHETIC_/);
  expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it('does not revive a failed selection when the original metadata state returns', async context => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  await mkdir(f.otherPaths.directoryPath, { recursive: true, mode: 0o700 });
  const selected = await f.capture();
  await f.publishOther();
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  await rm(f.otherPaths.currentPath);
  await expect(f.capture()).resolves.toMatchObject({ binding: f.binding });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it.for(['capture', 'recheck'] as const)('rejects a second owner during the final root read in %s', async (mode, context) => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  await mkdir(f.otherPaths.directoryPath, { recursive: true, mode: 0o700 });
  let armed = mode === 'capture', rootReads = 0, changed = false;
  const reads = { ...nativeReads, async directoryIdentity(path: string, guard: () => void) {
    const value = await nativeReads.directoryIdentity(path, guard);
    if (armed && path === f.candidate.candidateRoot && ++rootReads === 4) {
      await writeFile(f.otherPaths.currentPath, serializeWorkspaceRemnantBinding(f.other), { mode: 0o600 }); changed = true;
    }
    return value;
  } };
  if (mode === 'capture') await expect(f.capture(reads)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  else {
    const selected = await f.capture(reads); armed = true;
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  }
  expect(changed).toBe(true);
  expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it('rejects a root replaced during the intermediate metadata check', async context => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  let directoryReads = 0, changed = false;
  await expect(f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
    if (path === f.paths.directoryPath && ++directoryReads === 4) {
      await rename(f.candidate.candidateRoot, join(f.root, 'retained-first-root')); await f.addPayload(); changed = true;
    }
    return nativeReads.directoryIdentity(path, guard);
  } })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect(await readFile(join(f.root, 'retained-first-root', 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it('joins the original pending read after authority expires', async context => {
  const f = await fixture(context); await f.publish(); await f.addPayload();
  let release!: () => void, enter!: () => void, settled = false, asserted = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const work = f.capture({ ...nativeReads, async directoryIdentity(path, guard) {
    if (path === f.candidate.candidateRoot) { enter(); await pending; }
    return nativeReads.directoryIdentity(path, guard);
  } });
  void work.then(() => { settled = true; }, () => { settled = true; });
  context.onTestFinished(async () => {
    release();
    try { await work; } catch (error) { if (!asserted && error !== context.signal.reason) throw error; }
  });
  await entered; f.expire(); expect(settled).toBe(false); release();
  await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST'); asserted = true;
  expect(await readFile(join(f.candidate.candidateRoot, 'retained-data'), 'utf8')).toBe('synthetic-candidate');
});

it('validates path inputs without creating any directories', async context => {
  const f = await fixture(context);
  for (const [root, operationId, workspaceId] of [
    ['relative', id(1), id(2)], [f.root, '../escape', id(2)], [f.root, id(1), '../escape'],
  ]) await expect(capture(root!, operationId, workspaceId, f.authority)).rejects.toThrow();
  expect(await readdir(f.root)).toEqual([]);
  expect(validateWorkspaceId(id(2))).toBe(f.binding.workspaceId);
});
