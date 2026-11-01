import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceInspectionRemnantSelection as capture } from './workspaceInspectionRemnantSelection.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext, index = 0) {
  const f = await remnantBindingFixture(context, 'profileInspection');
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding);
  for (const path of paths) await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  const location = paths[index]!;
  await mkdir(location.rootPath, { mode: 0o700 });
  await writeFile(join(location.rootPath, 'retained'), 'synthetic-copy', { mode: 0o600 });
  const binding = captureWorkspaceRemnantBinding({ ...f.binding,
    rootIdentity: await identity(location.rootPath, f.authority.assertAuthority),
    parentIdentity: await identity(location.parentPath, f.authority.assertAuthority) });
  await f.store().publish(binding, f.authority);
  const workspace = deriveWorkspaceRoot(f.root, header.workspaceId, 1);
  const coveringWorkspace = captureDeletionInventoryRecord({ role: 'workspace', ownerOperationId: null,
    generationId: null, member: null, bindingSha256: null,
    rootIdentity: await identity(workspace.workspaceRoot, f.authority.assertAuthority),
    parentIdentity: await identity(workspace.workspacesRoot, f.authority.assertAuthority) });
  let writersAbsent = true;
  const authority = { ...f.authority, async assertWritersAbsent() {
    if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED');
  } };
  return { ...f, binding, locations: paths, location, coveringWorkspace, authority,
    dependencies: { coveringWorkspace, fileSystem: f.fileSystem },
    unsettledWriter() { writersAbsent = false; } };
}

for (const index of [0, 1, 2, 3]) {
  it(`selects only the creation-bound copy at location ${index} without changing any payload or metadata`, async context => {
    const f = await fixture(context, index);
    const before = await f.snapshot();
    const proof = await capture(f.root, header, f.binding, f.authority, f.dependencies);
    expect(proof.record).toEqual({ role: index < 2 ? 'inspectionEvidence' : 'inspection',
      ownerOperationId: f.binding.operationId, generationId: id(3), member: null,
      rootIdentity: f.binding.owner === 'profileInspection' ? f.binding.rootIdentity : null,
      parentIdentity: f.binding.owner === 'profileInspection' ? f.binding.parentIdentity : null,
      bindingSha256: workspaceRemnantBindingSha256(f.binding) });
    await proof.assertSelected();
    expect(Object.isFrozen(proof.record)).toBe(true);
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.location.rootPath, 'retained'), 'utf8')).toBe('synthetic-copy');
  });
}

it.for(['missing', 'wrongRoot', 'wrongParent', 'wrongRole'] as const)(
  'requires the real covering workspace for an internal evidence row: %s', async (kind, context) => {
    const f = await fixture(context);
    const coveringWorkspace = kind === 'missing' ? undefined : kind === 'wrongRole'
      ? { ...f.coveringWorkspace, role: 'inspection', ownerOperationId: id(1), generationId: id(3), bindingSha256: hash('wrong') }
      : { ...f.coveringWorkspace, [kind === 'wrongRoot' ? 'rootIdentity' : 'parentIdentity']: hash('wrong') };
    const before = await f.snapshot();
    await expect(capture(f.root, header, f.binding, f.authority,
      { fileSystem: f.fileSystem, coveringWorkspace })).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
  });

it('does not require a covering workspace record for an external physical copy', async context => {
  const f = await fixture(context, 3);
  const proof = await capture(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem });
  expect(proof.record.role).toBe('inspection');
  await proof.assertSelected();
});

it.for(['workspace', 'lineage', 'owner'] as const)('refuses a foreign %s before reading roots', async (kind, context) => {
  const f = await fixture(context);
  const reads = { ...workspaceInspectionRemnantReads, directoryIdentity: vi.fn(workspaceInspectionRemnantReads.directoryIdentity) };
  const target = kind === 'workspace' ? { ...header, workspaceId: id(77) }
    : kind === 'lineage' ? { ...header, lineageIdentity: { formatVersion: 1, profileId: hash('other') } } : header;
  const binding = kind === 'owner' ? { formatVersion: 1, owner: 'workspaceImport', operationId: id(1),
    workspaceId: id(2), lineageIdentity: header.lineageIdentity } : f.binding;
  await expect(capture(f.root, target, binding, f.authority, { ...f.dependencies, reads })).rejects.toThrow();
  expect(reads.directoryIdentity).not.toHaveBeenCalled();
});

it.for(['missing', 'copied', 'duplicate'] as const)('refuses an unproven or ambiguous %s copy', async (kind, context) => {
  const f = await fixture(context);
  if (kind === 'duplicate') await mkdir(f.locations[2]!.rootPath, { mode: 0o700 });
  else {
    await rename(f.location.rootPath, join(f.root, 'retained-original'));
    if (kind === 'copied') {
      await mkdir(f.location.rootPath, { mode: 0o700 });
      await writeFile(join(f.location.rootPath, 'retained'), 'synthetic-copy', { mode: 0o600 });
    }
  }
  const before = await f.snapshot();
  await expect(capture(f.root, header, f.binding, f.authority, f.dependencies)).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  if (kind !== 'duplicate') expect(await readFile(join(f.root, 'retained-original', 'retained'), 'utf8')).toBe('synthetic-copy');
});

it('pins changed ancestors even when the original directory is subsequently restored', async context => {
  const f = await fixture(context);
  const proof = await capture(f.root, header, f.binding, f.authority, f.dependencies);
  const retained = join(f.root, 'retained-parent');
  await rename(f.location.parentPath, retained);
  await mkdir(f.location.parentPath, { mode: 0o700 });
  await expect(proof.assertSelected()).rejects.toThrow();
  await rm(f.location.parentPath, { recursive: true });
  await rename(retained, f.location.parentPath);
  await expect(proof.assertSelected()).rejects.toThrow();
  expect(await readFile(join(f.location.rootPath, 'retained'), 'utf8')).toBe('synthetic-copy');
});

it.for(['sideAdded', 'rawBytes', 'currentReplaced', 'nextOnly', 'backupOnly'] as const)(
  'pins all original slot bytes and identities: %s', async (kind, context) => {
    const f = await fixture(context);
    const proof = await capture(f.root, header, f.binding, f.authority, f.dependencies);
    const bytes = serializeWorkspaceRemnantBinding(f.binding);
    if (kind === 'sideAdded') await writeFile(f.paths.nextPath, bytes, { mode: 0o600 });
    else if (kind === 'nextOnly' || kind === 'backupOnly') await rename(f.paths.currentPath,
      kind === 'nextOnly' ? f.paths.nextPath : f.paths.backupPath);
    else if (kind === 'rawBytes') await writeFile(f.paths.currentPath, ` ${bytes.toString('utf8')}`, { mode: 0o600 });
    else {
      await rename(f.paths.currentPath, join(f.root, 'retained-binding'));
      await writeFile(f.paths.currentPath, bytes, { mode: 0o600 });
    }
    const changed = await f.snapshot();
    await expect(proof.assertSelected()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(changed);
    if (kind === 'nextOnly' || kind === 'backupOnly') {
      await expect(capture(f.root, header, f.binding, f.authority, f.dependencies)).rejects.toThrow();
    }
  });

it.for(['authority', 'selection', 'writers'] as const)('rejects %s loss and retains the first cause', async (kind, context) => {
  const f = await fixture(context);
  const proof = await capture(f.root, header, f.binding, f.authority, f.dependencies);
  if (kind === 'authority') f.expire();
  if (kind === 'selection') f.changeTarget();
  if (kind === 'writers') f.unsettledWriter();
  await expect(proof.assertSelected()).rejects.toThrow(kind === 'authority' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'selection' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
  expect(await readFile(join(f.location.rootPath, 'retained'), 'utf8')).toBe('synthetic-copy');
});

it('joins a pending root read before returning authority loss', async context => {
  const f = await fixture(context);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let inject = false, settled = false;
  const proof = await capture(f.root, header, f.binding, f.authority, { ...f.dependencies, reads: {
    ...workspaceInspectionRemnantReads, async directoryIdentity(...args) {
      if (inject && args[0] === f.location.rootPath) { enter(); await pending; }
      return workspaceInspectionRemnantReads.directoryIdentity(...args);
    },
  } });
  inject = true;
  const work = proof.assertSelected().finally(() => { settled = true; });
  await entered; f.expire();
  expect(settled).toBe(false);
  release();
  await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  expect(settled).toBe(true);
});

it('retains an original root read error rather than mapping it to absence', async context => {
  const f = await fixture(context);
  const first = Object.assign(new Error('SYNTHETIC_COPY_UNREADABLE'), { code: 'EACCES' });
  await expect(capture(f.root, header, f.binding, f.authority, { ...f.dependencies, reads: {
    ...workspaceInspectionRemnantReads, async directoryIdentity(...args) {
      if (args[0] === f.location.rootPath) throw first;
      return workspaceInspectionRemnantReads.directoryIdentity(...args);
    },
  } })).rejects.toBe(first);
});

it('rejects a redirected copy instead of reading another payload', async context => {
  const f = await fixture(context);
  const retained = join(f.root, 'retained-linked-copy');
  await rename(f.location.rootPath, retained);
  await symlink(retained, f.location.rootPath, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(capture(f.root, header, f.binding, f.authority, f.dependencies)).rejects.toThrow();
  expect(await readFile(join(retained, 'retained'), 'utf8')).toBe('synthetic-copy');
});

it('preserves the foreign company binding, copy and their original identities in a shared parent', async context => {
  const f = await fixture(context, 2);
  const original = await capture(f.root, header, f.binding, f.authority, f.dependencies);
  const foreignValue = captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(77), generationId: id(900),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } });
  const foreign = deriveWorkspaceInspectionRemnantPaths(f.root, foreignValue)[2]!;
  await mkdir(foreign.rootPath, { mode: 0o700 });
  await writeFile(join(foreign.rootPath, 'retained'), 'foreign-payload', { mode: 0o600 });
  const store = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(foreignValue));
  const published = await store.publish(foreignValue, f.authority);
  const rootIdentity = await identity(foreign.rootPath, f.authority.assertAuthority);
  const before = await f.snapshot();
  await original.assertSelected();
  const fresh = await capture(f.root, header, f.binding, f.authority, f.dependencies);
  expect(fresh.record).toEqual(original.record);
  const selected = await store.inspect(f.authority);
  expect(selected.mode).toBe('published');
  expect(selected.slots.current!.identity).toEqual(published.identity);
  expect(await identity(foreign.rootPath, f.authority.assertAuthority)).toBe(rootIdentity);
  expect(await readFile(join(foreign.rootPath, 'retained'), 'utf8')).toBe('foreign-payload');
  expect(await f.snapshot()).toEqual(before);
  expect(await readdir(f.location.rootPath)).toEqual(['retained']);
});

it.for([['slot', 'root'], ['writers', 'root'], ['slot', 'ancestor'], ['writers', 'ancestor']] as const)(
  'rejects metadata or writer changes during awaited filesystem observations: %s', async ([kind, phase], context) => {
  const f = await fixture(context, 3);
  let inject = false, reads = 0;
  const proof = await capture(f.root, header, f.binding, f.authority, { ...f.dependencies, reads: {
    ...workspaceInspectionRemnantReads, async directoryIdentity(...args) {
      const value = await workspaceInspectionRemnantReads.directoryIdentity(...args);
      const selectedPath = phase === 'root' ? f.location.rootPath : f.location.parentPath;
      if (inject && args[0] === selectedPath && ++reads === (phase === 'root' ? 2 : 4)) {
        if (kind === 'slot') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
        else f.unsettledWriter();
      }
      return value;
    },
  } });
  inject = true;
  await expect(proof.assertSelected()).rejects.toThrow();
  expect(reads).toBe(phase === 'root' ? 2 : 4);
  expect(await readFile(join(f.location.rootPath, 'retained'), 'utf8')).toBe('synthetic-copy');
  await expect(proof.assertSelected()).rejects.toThrow();
});

it('rejects root replacement during the final post-root ancestor await', async context => {
  const f = await fixture(context, 3);
  let inject = false, reads = 0;
  const retained = join(f.root, 'retained-final-copy');
  const proof = await capture(f.root, header, f.binding, f.authority, { ...f.dependencies, reads: {
    ...workspaceInspectionRemnantReads, async directoryIdentity(...args) {
      const value = await workspaceInspectionRemnantReads.directoryIdentity(...args);
      if (inject && args[0] === f.location.parentPath && ++reads === 4) {
        await rename(f.location.rootPath, retained);
        await mkdir(f.location.rootPath, { mode: 0o700 });
      }
      return value;
    },
  } });
  inject = true;
  await expect(proof.assertSelected()).rejects.toThrow();
  expect(reads).toBe(4);
  expect(await readFile(join(retained, 'retained'), 'utf8')).toBe('synthetic-copy');
  await expect(proof.assertSelected()).rejects.toThrow();
});
