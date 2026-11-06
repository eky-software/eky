import { chmod, link, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyAdoptionPaths, deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { deletionInventoryFileIdentity, deletionPayloadFileIdentity } from './workspaceDeletionInventoryFile.js';
import { captureWorkspaceLegacyRemnantSelection as capture, workspaceLegacyRemnantReads as nativeReads } from './workspaceLegacyRemnantSelection.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context, 'workspaceLegacyAdoption');
  const paths = deriveWorkspaceLegacyRuntimePaths(f.root);
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const payload = async (name = 'data', file = false) => {
    await mkdir(paths.legacyRuntimeRoot, { recursive: true, mode: 0o700 });
    const root = join(paths.legacyRuntimeRoot, name);
    if (file) await writeFile(root, `synthetic-${name}`, { mode: 0o600 });
    else {
      await mkdir(root, { mode: 0o700 });
      await writeFile(join(root, 'keep'), `synthetic-${name}`, { mode: 0o600 });
    }
    return root;
  };
  const publish = async (input = f.binding) => {
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(input)).publish(input, authority);
  };
  return { ...f, authority, runtime: paths.legacyRuntimeRoot, payload, publish,
    unsettled() { writersAbsent = false; }, capture: (reads = nativeReads) => capture(f.root, authority, reads) };
}

it('uses the normal adoption path owner and validates roots before any I/O', async context => {
  const f = await fixture(context);
  expect(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot)
    .toBe(deriveWorkspaceLegacyAdoptionPaths(f.root, f.binding.operationId, f.binding.workspaceId).legacyRuntimeRoot);
  for (const root of ['relative', `${f.root}\0`]) {
    await expect(capture(root, f.authority)).rejects.toThrow('WORKSPACE_ADOPTION_INVALID');
  }
  expect(await readdir(f.root)).toEqual([]);
});

it('captures all 13 allowed entries once without opening a database or selecting installation files', async context => {
  const f = await fixture(context); await f.publish();
  for (const [index, name] of workspaceOwnedEntryNames.entries()) await f.payload(name, index % 2 === 1);
  const logs = await f.payload('logs', true), update = await f.payload('update-state', true);
  const foreign = join(f.root, 'workspaces', id(90));
  await mkdir(foreign, { recursive: true, mode: 0o700 });
  await writeFile(join(foreign, 'keep'), 'foreign-company', { mode: 0o600 });
  const before = await f.snapshot(), selected = await f.capture();
  expect(selected.entries.map(entry => entry.member)).toEqual(workspaceOwnedEntryNames);
  expect(selected.entries.every(entry => entry.value !== null)).toBe(true);
  expect(new Set(selected.entries.map(entry => entry.value?.identity)).size).toBe(workspaceOwnedEntryNames.length);
  expect(selected.binding).toEqual(f.binding);
  expect(selected).not.toHaveProperty('record');
  await selected.assertSelected();
  expect(await f.snapshot()).toEqual(before);
  for (const [index, name] of workspaceOwnedEntryNames.entries()) {
    expect(await readFile(join(f.runtime, name, ...(index % 2 === 1 ? [] : ['keep'])), 'utf8')).toBe(`synthetic-${name}`);
  }
  expect(await readFile(logs, 'utf8')).toBe('synthetic-logs');
  expect(await readFile(update, 'utf8')).toBe('synthetic-update-state');
  expect(await readFile(join(foreign, 'keep'), 'utf8')).toBe('foreign-company');
});

it.for(['missingParent', 'emptyParent', 'unrelatedOnly'] as const)(
  'retains the %s context without creating company roots or selecting an owner', async (kind, context) => {
    const f = await fixture(context);
    if (kind !== 'missingParent') await mkdir(f.runtime, { mode: 0o700 });
    if (kind === 'unrelatedOnly') await f.payload('installation-state', true);
    const selected = await f.capture();
    expect(selected.entries).toHaveLength(workspaceOwnedEntryNames.length);
    expect(selected.entries.every(entry => entry.value === null)).toBe(true);
    expect(selected.binding).toBeUndefined();
    expect(selected.parentIdentity === null).toBe(kind === 'missingParent');
    await selected.assertSelected();
    if (kind === 'missingParent') expect(await readdir(f.root)).toEqual([]);
    else expect(await readdir(f.runtime)).toEqual(kind === 'emptyParent' ? [] : ['installation-state']);
  });

it('does not clear adoption metadata when legacy entries are absent and a candidate remains', async context => {
  const f = await fixture(context); await f.publish();
  const candidate = deriveWorkspaceLegacyAdoptionPaths(f.root, f.binding.operationId, f.binding.workspaceId).candidateRoot;
  await mkdir(candidate, { recursive: true, mode: 0o700 });
  await writeFile(join(candidate, 'keep'), 'candidate', { mode: 0o600 });
  const selected = await f.capture();
  expect(selected.binding).toBeUndefined();
  await selected.assertSelected();
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  expect(await readFile(join(candidate, 'keep'), 'utf8')).toBe('candidate');
});

it.for(['missing', 'twoCompanies', 'nextOnly', 'backupOnly', 'conflictingSide', 'unknownName'] as const)(
  'rejects %s metadata with actual legacy content and retains all bytes', async (kind, context) => {
    const f = await fixture(context), root = await f.payload();
    if (kind !== 'missing') await f.publish();
    if (kind === 'twoCompanies') await f.publish(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(9) }));
    if (kind === 'nextOnly' || kind === 'backupOnly') await rename(f.paths.currentPath,
      kind === 'nextOnly' ? f.paths.nextPath : f.paths.backupPath);
    if (kind === 'conflictingSide') await writeFile(f.paths.nextPath,
      serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(8) })), { mode: 0o600 });
    if (kind === 'unknownName') await writeFile(join(f.paths.directoryPath, 'unknown'), 'retain', { mode: 0o600 });
    const before = kind === 'missing' ? undefined : await f.snapshot();
    await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(join(root, 'keep'), 'utf8')).toBe('synthetic-data');
    if (before !== undefined) expect(await f.snapshot()).toEqual(before);
  });

it('keeps the uniquely bound foreign company in the source result, without target filtering', async context => {
  const f = await fixture(context), foreign = captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(99) });
  await f.publish(foreign); await f.payload();
  expect((await f.capture()).binding).toEqual(foreign);
});

it.for(['root', 'parent', 'newEntry', 'sideSlot', 'rawBytes', 'secondOwner', 'metadataParent'] as const)(
  'invalidates the original selection after %s changes', async (kind, context) => {
    const f = await fixture(context); await f.publish(); const root = await f.payload();
    const selected = await f.capture();
    if (kind === 'root') { await rename(root, join(f.root, 'retained-root')); await f.payload(); }
    else if (kind === 'parent') {
      const saved = join(f.root, 'retained-parent'); await rename(f.runtime, saved);
      await mkdir(f.runtime, { mode: 0o700 }); await rename(join(saved, 'data'), root);
    } else if (kind === 'newEntry') await f.payload('secrets', true);
    else if (kind === 'sideSlot') await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    else if (kind === 'rawBytes') await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.binding).toString()}`, { mode: 0o600 });
    else if (kind === 'secondOwner') await f.publish(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(9) }));
    else {
      const saved = join(f.root, 'retained-metadata'); await rename(f.paths.directoryPath, saved);
      await mkdir(f.paths.directoryPath, { mode: 0o700 });
      await rename(join(saved, f.paths.currentPath.split(/[\\/]/).at(-1)!), f.paths.currentPath);
    }
    const before = await f.snapshot();
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(root, 'keep'), 'utf8')).toBe('synthetic-data');
  });

it('invalidates a previously absent legacy parent when content appears', async context => {
  const f = await fixture(context); await f.publish();
  const selected = await f.capture(); await f.payload();
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it('does not revive an invalidated receipt after a conflicting side slot is removed', async context => {
  const f = await fixture(context); await f.publish(); await f.payload();
  const selected = await f.capture();
  await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  await expect(selected.assertSelected()).rejects.toThrow(); await rm(f.paths.nextPath);
  await expect(f.capture()).resolves.toMatchObject({ binding: f.binding });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it.for(['rootLink', 'parentLink', 'hardlink', 'parentFile'] as const)(
  'rejects %s without following or deleting it', async (kind, context) => {
    const f = await fixture(context); await f.publish();
    if (kind === 'parentFile') await writeFile(f.runtime, 'retain', { mode: 0o600 });
    else if (kind === 'hardlink') {
      const original = await f.payload('archive', true); await link(original, join(f.root, 'linked-original'));
    } else {
      const root = await f.payload(), original = kind === 'parentLink' ? f.runtime : root, saved = join(f.root, 'retain');
      await rename(original, saved); await symlink(saved, original, process.platform === 'win32' ? 'junction' : 'dir');
    }
    await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    if (kind === 'parentFile') expect(await readFile(f.runtime, 'utf8')).toBe('retain');
    else if (kind === 'hardlink') expect(await readFile(join(f.root, 'linked-original'), 'utf8')).toBe('synthetic-archive');
    else expect(await readFile(join(f.root, 'retain', ...(kind === 'parentLink' ? ['data'] : []), 'keep'), 'utf8')).toBe('synthetic-data');
  });

it.skipIf(process.platform === 'win32')('preserves legacy mode compatibility without relaxing inventory-file permissions', async context => {
  const f = await fixture(context); await f.publish(); const file = await f.payload('archive', true);
  await chmod(f.runtime, 0o755); await chmod(file, 0o644);
  const metadata = await lstat(file, { bigint: true }), selected = await f.capture();
  expect(selected.entries.find(entry => entry.member === 'archive')?.value?.identity).toBe(deletionPayloadFileIdentity(metadata));
  expect(() => deletionInventoryFileIdentity(metadata)).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  await f.payload(); await chmod(join(f.runtime, 'data'), 0o755);
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it.for(['lease', 'target', 'writer'] as const)('rejects lost %s authority', async (kind, context) => {
  const f = await fixture(context); await f.publish(); const root = await f.payload(), selected = await f.capture();
  if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
  await expect(selected.assertSelected()).rejects.toThrow(/SYNTHETIC_/);
  expect(await readFile(join(root, 'keep'), 'utf8')).toBe('synthetic-data');
});

it('rejects a root changed during the metadata read before returning a selection', async context => {
  const f = await fixture(context); await f.publish(); const root = await f.payload(); let changed = false;
  await expect(f.capture({ ...nativeReads, async openDirectory(path) {
    if (!changed && path === f.paths.directoryPath) {
      changed = true; await rename(root, join(f.root, 'retained-original')); await f.payload();
    }
    return nativeReads.openDirectory(path);
  } })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect(await readFile(join(f.root, 'retained-original', 'keep'), 'utf8')).toBe('synthetic-data');
});

it('joins the original pending entry read after revocation', async context => {
  const f = await fixture(context); await f.publish(); const root = await f.payload();
  let release!: () => void, entered!: () => void, settled = false, observed = false;
  const pending = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const work = f.capture({ ...nativeReads, async entryIdentity(path, guard) {
    if (path === root) { entered(); await pending; }
    return nativeReads.entryIdentity(path, guard);
  } });
  void work.then(() => { settled = true; }, () => { settled = true; });
  context.onTestFinished(async () => { release(); try { await work; } catch (error) { if (!observed) throw error; } });
  await ready; f.expire(); expect(settled).toBe(false); release();
  await expect(work).rejects.toThrow('SYNTHETIC_LEASE_LOST'); observed = true;
  expect(await readFile(join(root, 'keep'), 'utf8')).toBe('synthetic-data');
});

it.for(['capture', 'recheck'] as const)('rejects a root replaced during the final owner read in %s', async (mode, context) => {
  const f = await fixture(context); await f.publish(); const root = await f.payload();
  let armed = mode === 'capture', opens = 0, changed = false;
  const reads = { ...nativeReads, async openDirectory(path: string) {
    // One binding uses the data page and its empty EOF page; the third open starts the second owner scan.
    if (armed && path === f.paths.directoryPath && ++opens === 3) {
      await rename(root, join(f.root, 'retained-final-root')); await f.payload(); changed = true;
    }
    return nativeReads.openDirectory(path);
  } };
  if (mode === 'capture') await expect(f.capture(reads)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  else {
    const selected = await f.capture(reads); armed = true;
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  }
  expect(changed).toBe(true);
  expect(await readFile(join(f.root, 'retained-final-root', 'keep'), 'utf8')).toBe('synthetic-data');
  expect(await readFile(join(root, 'keep'), 'utf8')).toBe('synthetic-data');
});

it('retains a late second adoption owner even when it appears during the second root pass', async context => {
  const f = await fixture(context); await f.publish(); await f.payload();
  let passes = 0;
  const foreign = captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(99) });
  await expect(f.capture({ ...nativeReads, async entryIdentity(path, guard) {
    const value = await nativeReads.entryIdentity(path, guard);
    if (path === join(f.runtime, workspaceOwnedEntryNames.at(-1)!) && ++passes === 2) await f.publish(foreign);
    return value;
  } })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign)).currentPath))
    .toEqual(serializeWorkspaceRemnantBinding(foreign));
});
