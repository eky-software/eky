import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { clearAbsentWorkspaceInspectionBinding } from './workspaceInspectionBindingCleanup.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext, owner: 'profileInspection') {
  const value = await remnantBindingFixture(context, owner);
  return { ...value, authority: { ...value.authority, async assertWritersAbsent() {} } };
}

for (const sides of [[], ['next'], ['backup'], ['next', 'backup']] as const) {
  it(`clears only the exact observed metadata with sides ${sides.join('+')}`, async context => {
    const f = await fixture(context, 'profileInspection');
    await f.store().publish(f.binding, f.authority);
    for (const slot of sides) await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    const paths = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding);
    for (const path of paths) await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
    const other = join(paths[2]!.parentPath, `profile-inspection-${id(900)}`);
    await mkdir(other, { mode: 0o700 });
    await writeFile(join(other, 'retained'), 'other-company', { mode: 0o600 });
    await clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem });
    expect(await readdir(f.paths.directoryPath)).toEqual([]);
    expect(await readFile(join(other, 'retained'), 'utf8')).toBe('other-company');
  });
}

it.for(['workspace', 'lineage', 'owner'] as const)('rejects a foreign %s before reading payload roots', async (kind, context) => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  const before = await f.snapshot();
  const read = vi.fn(workspaceInspectionRemnantReads.directoryIdentity);
  const binding = kind === 'owner' ? { formatVersion: 1, owner: 'workspaceImport', operationId: id(1),
    workspaceId: id(2), lineageIdentity: header.lineageIdentity } : f.binding;
  const target = kind === 'workspace' ? { ...header, workspaceId: id(99) }
    : kind === 'lineage' ? { ...header, lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } } : header;
  await expect(clearAbsentWorkspaceInspectionBinding(f.root, target, binding, f.authority,
    { fileSystem: f.fileSystem, reads: { ...workspaceInspectionRemnantReads, directoryIdentity: read } })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['nextOnly', 'conflict', 'copyPresent', 'targetChanged'] as const)('preserves uncertain %s metadata and payload', async (kind, context) => {
  const f = await fixture(context, 'profileInspection');
  if (kind !== 'nextOnly') await f.store().publish(f.binding, f.authority);
  else await f.prepare();
  if (kind === 'nextOnly' || kind === 'conflict') await writeFile(f.paths.nextPath,
    kind === 'nextOnly' ? serializeWorkspaceRemnantBinding(f.binding)
      : serializeWorkspaceRemnantBinding({ ...f.binding, lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } }), { mode: 0o600 });
  const before = await f.snapshot();
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[0]!;
  if (kind === 'copyPresent') {
    await mkdir(path.rootPath, { recursive: true, mode: 0o700 });
    await writeFile(join(path.rootPath, 'retained'), 'synthetic-copy', { mode: 0o600 });
  }
  if (kind === 'targetChanged') f.changeTarget();
  await expect(clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem })).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  if (kind === 'copyPresent') expect(await readFile(join(path.rootPath, 'retained'), 'utf8')).toBe('synthetic-copy');
});

it('rejects a new slot introduced inside the low-level removal guard', async context => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  let changed = false;
  const spy = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(), async beforeMutation() {
      if (!changed) { changed = true; await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 }); }
      await guard!.beforeMutation();
    },
  }));
  try {
    await expect(clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem })).rejects.toThrow();
  } finally { spy.mockRestore(); }
  expect(changed).toBe(true);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
  expect((await readFile(f.paths.nextPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it('refuses a copy appearing at the actual metadata-removal guard', async context => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[3]!;
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  let changed = false;
  const spy = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(), async beforeMutation() {
      if (!changed) {
        changed = true;
        await mkdir(path.rootPath, { mode: 0o700 });
        await writeFile(join(path.rootPath, 'retained'), 'late-copy', { mode: 0o600 });
      }
      await guard!.beforeMutation();
    },
  }));
  try {
    await expect(clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem })).rejects.toThrow();
  } finally { spy.mockRestore(); }
  expect(changed).toBe(true);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
  expect(await readFile(join(path.rootPath, 'retained'), 'utf8')).toBe('late-copy');
});

it('preserves another company binding and payload under the same shared parent', async context => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  const other = captureWorkspaceRemnantBinding({ ...f.binding, generationId: id(900), workspaceId: id(91),
    lineageIdentity: { formatVersion: 1, profileId: hash('other-company') } });
  const store = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other));
  const receipt = await store.publish(other, f.authority);
  const parent = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[2]!.parentPath;
  const otherRoot = join(parent, `profile-inspection-${id(900)}`);
  await mkdir(otherRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(otherRoot, 'retained'), 'other-company', { mode: 0o600 });
  await clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem });
  const after = await store.inspect(f.authority);
  expect(after.mode).toBe('published');
  if (after.mode === 'published') {
    expect(after.bindingSha256).toBe(receipt.bindingSha256);
    expect(after.value).toEqual(other);
    expect(after.slots.current!.bytes.byteLength).toBe(receipt.identity.size);
    expect(after.slots.current!.identity).toEqual(receipt.identity);
  }
  expect(await readFile(join(otherRoot, 'retained'), 'utf8')).toBe('other-company');
});

it('requires the separate writer-absence proof at the actual removal boundary', async context => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  let stopped = true;
  const authority = { ...f.authority, async assertWritersAbsent() {
    if (!stopped) throw new Error('SYNTHETIC_WRITER_UNSETTLED');
  } };
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  const spy = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(), async beforeMutation() { stopped = false; await guard!.beforeMutation(); },
  }));
  try {
    await expect(clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, authority, { fileSystem: f.fileSystem }))
      .rejects.toThrow('SYNTHETIC_WRITER_UNSETTLED');
  } finally { spy.mockRestore(); }
  expect(stopped).toBe(false);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it('retains metadata if the final absence await replaces its selected parent', async context => {
  const f = await fixture(context, 'profileInspection');
  await f.store().publish(f.binding, f.authority);
  const path = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[3]!;
  await mkdir(path.parentPath, { recursive: true, mode: 0o700 });
  let inject = false;
  let checks = 0;
  const remove = f.fileSystem.removeSlot.bind(f.fileSystem);
  const spy = vi.spyOn(f.fileSystem, 'removeSlot').mockImplementation(async (slot, guard) => remove(slot, {
    assertAuthority: () => guard!.assertAuthority(), async beforeMutation() { inject = true; await guard!.beforeMutation(); },
  }));
  try {
    await expect(clearAbsentWorkspaceInspectionBinding(f.root, header, f.binding, f.authority, {
      fileSystem: f.fileSystem, reads: { ...workspaceInspectionRemnantReads, async assertAbsent(...args) {
        await workspaceInspectionRemnantReads.assertAbsent(...args);
        if (inject && args[0] === path.rootPath && ++checks === 2) {
          await rename(path.parentPath, join(f.root, 'retained-final-parent'));
          await mkdir(path.parentPath, { mode: 0o700 });
        }
      } },
    })).rejects.toThrow();
  } finally { spy.mockRestore(); }
  expect(checks).toBeGreaterThanOrEqual(2);
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});
