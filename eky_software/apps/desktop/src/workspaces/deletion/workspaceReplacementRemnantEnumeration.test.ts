import { lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { observeWorkspaceReplacementRemnants as observe } from './workspaceReplacementRemnantEnumeration.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';
import * as replacementSelection from './workspaceReplacementRemnantSelection.js';
import * as directoryEntries from './workspaceDeletionDirectoryEntries.js';

const nativeReads = { ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads };
async function collect(source: ReturnType<typeof observe>) {
  const rows = [];
  for await (const row of source) rows.push(row);
  return rows;
}
async function nextPayload(source: ReturnType<typeof observe>) {
  while (true) {
    const next = await source.next();
    if (next.done || next.value.kind !== 'parent') return next;
  }
}
async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context);
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const parents = deriveWorkspaceReplacementRemnantParents(f.root);
  const publish = async (value: unknown) => {
    const binding = captureWorkspaceRemnantBinding(value);
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    return binding;
  };
  const payload = async (index: number, name: string) => {
    const root = join(parents[index]!.parentPath, name);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(join(root, 'keep'), name, { mode: 0o600 }); return root;
  };
  const inspection = async (index = 1, workspaceId = id(2), operationId = id(20), generationId = id(30)) => {
    const root = await payload(index, profileInspectionCopyDirectoryName(generationId));
    const binding = await publish({ ...remnantTestBinding('profileInspection'), workspaceId, operationId, generationId,
      lineageIdentity: { formatVersion: 1, profileId: hash(workspaceId) },
      rootIdentity: await nativeReads.directoryIdentity(root, authority.assertAuthority),
      parentIdentity: await nativeReads.directoryIdentity(parents[index]!.parentPath, authority.assertAuthority) });
    return { root, binding, paths: createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)) };
  };
  return { ...f, authority, parents, publish, payload, inspection,
    unsettled() { writersAbsent = false; }, observe: (reads = nativeReads) => observe(f.root, authority, reads) };
}

it('observes all four absent parents without creating them', async context => {
  const f = await fixture(context), rows = await collect(f.observe());
  expect(rows.map(row => row.kind)).toEqual(['parent', 'parent', 'parent', 'parent']);
  for (const row of rows) {
    if (row.kind !== 'parent') throw new Error('UNEXPECTED_PAYLOAD');
    expect(row.ancestorIdentities.at(-1)).toBeNull();
    await expect(lstat(row.rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

it('retains empty known parents without manufacturing payloads or bindings', async context => {
  const f = await fixture(context);
  for (const parent of f.parents) await mkdir(parent.parentPath, { recursive: true, mode: 0o700 });
  const rows = await collect(f.observe());
  expect(rows).toHaveLength(4);
  expect(rows.every(row => row.kind === 'parent' && row.ancestorIdentities.every(value => typeof value === 'string'))).toBe(true);
  for (const parent of f.parents) expect(await readdir(parent.parentPath)).toEqual([]);
});

it('pairs real replacement, migration and foreign inspection roots without merging their ownership', async context => {
  const f = await fixture(context);
  await f.publish(f.binding);
  const imported = await f.payload(0, f.binding.operationId);
  const migration = await f.publish({ ...f.binding, owner: 'workspaceActivationMigration', operationId: id(8), workspaceId: id(9) });
  const staged = await f.payload(1, migration.operationId);
  const foreign = await f.inspection(1, id(77));
  const rows = await collect(f.observe());
  expect(rows.flatMap(row => row.kind === 'replacement' ? [row.selection.binding.owner] : []))
    .toEqual(['workspaceReplacement', 'workspaceActivationMigration']);
  const copies = rows.flatMap(row => row.kind === 'inspection' ? [row.selection] : []);
  expect(copies).toHaveLength(1);
  expect(copies[0]!.binding.workspaceId).toBe(id(77));
  expect(copies[0]!.location.rootPath).toBe(foreign.root);
  expect(copies[0]).not.toHaveProperty('record');
  for (const root of [imported, staged, foreign.root]) expect(await readdir(root)).toEqual(['keep']);
  expect(await readFile(foreign.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(foreign.binding));
});

it('selects all four roots of one operation once, then rechecks them after the consumer', async context => {
  const f = await fixture(context);
  await f.publish(f.binding);
  const roots = [];
  for (let index = 0; index < f.parents.length; index++) roots.push(await f.payload(index, f.binding.operationId));
  const capture = vi.spyOn(replacementSelection, 'captureWorkspaceReplacementRemnantSelection');
  context.onTestFinished(() => { capture.mockRestore(); });
  const source = f.observe();
  context.onTestFinished(async () => { await source.return(); });
  const first = await nextPayload(source);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(first.value).toMatchObject({ kind: 'replacement', selection: { roots: f.parents.map(parent => ({ role: parent.role })) } });
  const saved = join(f.root, 'retained-root');
  await rename(roots[2]!, saved);
  await f.payload(2, f.binding.operationId);
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(saved, 'keep'), 'utf8')).toBe(f.binding.operationId);
  expect(await readFile(join(roots[2]!, 'keep'), 'utf8')).toBe(f.binding.operationId);
});

it('rejects a buffered next operation moved to another parent before it is selected', async context => {
  const f = await fixture(context);
  for (const parent of f.parents) await mkdir(parent.parentPath, { recursive: true, mode: 0o700 });
  await f.publish(f.binding); await f.payload(0, f.binding.operationId);
  const second = await f.publish({ ...f.binding, operationId: id(8) });
  const from = await f.payload(1, second.operationId), to = join(f.parents[2]!.parentPath, second.operationId);
  const source = f.observe();
  context.onTestFinished(async () => { await source.return(); });
  expect((await nextPayload(source)).value).toMatchObject({ kind: 'replacement', selection: { binding: f.binding } });
  await rename(from, to);
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(to, 'keep'), 'utf8')).toBe(second.operationId);
  expect(await readFile(join(f.parents[0]!.parentPath, f.binding.operationId, 'keep'), 'utf8')).toBe(f.binding.operationId);
});

it.for(['earlyReturn', 'laterReadFailure'] as const)(
  'closes every initialized name reader on %s even when the first close fails', async (mode, context) => {
    const f = await fixture(context);
    await f.publish(f.binding);
    for (let i = 0; i < f.parents.length; i++) await f.payload(i, f.binding.operationId);
    const first = new Error('SYNTHETIC_LATER_READER_FAILED'), closing = new Error('SYNTHETIC_FIRST_CLOSE_FAILED');
    const closed: number[] = [];
    const mocked = vi.spyOn(directoryEntries, 'observeWorkspaceDeletionDirectoryEntries').mockImplementation(path => {
      const index = f.parents.findIndex(parent => parent.parentPath === path);
      const source = (async function* () {
        if (index === 2 && mode === 'laterReadFailure') throw first;
        yield f.binding.operationId;
      })();
      const close = source.return.bind(source);
      source.return = async value => {
        closed.push(index);
        const result = await close(value);
        if (index === 0) throw closing;
        return result;
      };
      return source;
    });
    context.onTestFinished(() => { mocked.mockRestore(); });
    const source = f.observe();
    if (mode === 'earlyReturn') {
      expect((await nextPayload(source)).value?.kind).toBe('replacement');
      await expect(source.return()).rejects.toBe(closing);
    } else {
      await expect(nextPayload(source)).rejects.toMatchObject({ errors: [first, closing] });
    }
    expect(closed).toEqual([0, 1, 2, 3]);
    for (const parent of f.parents) expect(await readFile(join(parent.parentPath, f.binding.operationId, 'keep'), 'utf8')).toBe(f.binding.operationId);
  });

it('merges real 64/65-name directory pages with a controlled selection reader', { timeout: 10_000 }, async context => {
  const f = await fixture(context), count = directoryEntries.workspaceDeletionDirectoryEntryPageSize + 1;
  for (const parent of f.parents) {
    await mkdir(parent.parentPath, { recursive: true, mode: 0o700 });
    for (let n = count; n > 0; n--) await mkdir(join(parent.parentPath, id(n + 100)), { mode: 0o700 });
  }
  const ancestors: string[][] = [];
  for (const parent of f.parents) {
    const values = [];
    for (const path of parent.ancestors) values.push(await nativeReads.directoryIdentity(path, f.authority.assertAuthority));
    ancestors.push(values);
  }
  // Isolate the merge/page contract; the independent native-owner test validates actual root selections.
  const mocked = vi.spyOn(replacementSelection, 'captureWorkspaceReplacementRemnantSelection').mockImplementation(async (_, value) => {
    const binding = captureWorkspaceRemnantBinding({ ...f.binding, operationId: value });
    return { binding, bindingSha256: workspaceRemnantBindingSha256(binding),
      ownerSlots: { current: undefined, next: undefined, backup: undefined },
      roots: f.parents.map((parent, i) => ({ role: parent.role, rootPath: join(parent.parentPath, binding.operationId),
        rootIdentity: hash(`${parent.role}:${binding.operationId}`), parentIdentity: ancestors[i]!.at(-1)!, ancestors: ancestors[i]! })),
      async assertSelected() { f.authority.assertAuthority(); },
      async assertPayloadsAbsent() { throw new Error('PAYLOAD_CLEANUP_NOT_PART_OF_THIS_TEST'); } };
  });
  let opened = 0, closed = 0, active = 0;
  const work = collect(f.observe({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    opened++; active++; expect(active).toBe(1);
    return { read: () => directory.read(), async close() { await directory.close(); active--; closed++; } };
  } }));
  context.onTestFinished(async () => {
    try { await work.catch(() => undefined); } finally { mocked.mockRestore(); }
  });
  const rows = await work;
  expect(rows.flatMap(row => row.kind === 'replacement' ? [row.selection.binding.operationId] : []))
    .toEqual(Array.from({ length: count }, (_, n) => id(n + 101)));
  expect(mocked).toHaveBeenCalledTimes(count);
  expect({ opened, closed, active }).toEqual({ opened: 12, closed: 12, active: 0 });
  for (const parent of f.parents) expect(await readdir(parent.parentPath)).toHaveLength(count);
});

it.for(['unknown', 'unbound', 'file', 'link', 'doubleOwner', 'migrationImport', 'nextOnly'] as const)(
  'rejects %s operation roots instead of skipping or deleting them', async (kind, context) => {
    const f = await fixture(context), name = kind === 'unknown' ? 'unknown' : f.binding.operationId;
    const index = kind === 'migrationImport' ? 0 : 1;
    const root = await f.payload(index, name);
    if (kind === 'doubleOwner' || kind === 'migrationImport') {
      await f.publish({ ...f.binding, owner: 'workspaceActivationMigration' });
      if (kind === 'doubleOwner') await f.publish(f.binding);
    }
    if (kind === 'nextOnly') {
      await f.publish(f.binding); await rename(f.paths.currentPath, f.paths.nextPath);
    }
    const retained = join(f.root, 'retained');
    if (kind === 'file' || kind === 'link') {
      await rename(root, retained);
      if (kind === 'file') await writeFile(root, 'retained-file', { mode: 0o600 });
      else await symlink(retained, root, process.platform === 'win32' ? 'junction' : 'dir');
      await f.publish(f.binding);
    }
    await expect(collect(f.observe())).rejects.toThrow();
    expect(await readFile(join(kind === 'file' || kind === 'link' ? retained : root, 'keep'), 'utf8')).toBe(name);
  });

it.for(['unbound', 'duplicateGeneration', 'wrongParent', 'changedIdentity', 'wrongRole', 'sideOnly'] as const)(
  'rejects %s inspection selection and preserves the copy', async (kind, context) => {
    const f = await fixture(context), copy = await f.inspection(kind === 'wrongRole' ? 2 : 3);
    if (kind === 'unbound') await rename(copy.paths.currentPath, join(f.root, 'retained-binding'));
    if (kind === 'sideOnly') await rename(copy.paths.currentPath, copy.paths.backupPath);
    if (kind === 'duplicateGeneration') await f.publish({ ...copy.binding, operationId: id(21), workspaceId: id(78) });
    if (kind === 'wrongParent') {
      const value = captureWorkspaceRemnantBinding({ ...copy.binding, parentIdentity: hash('wrong') });
      await writeFile(copy.paths.currentPath, serializeWorkspaceRemnantBinding(value), { mode: 0o600 });
    }
    if (kind === 'changedIdentity') {
      await rename(copy.root, join(f.root, 'retained-copy'));
      await mkdir(copy.root, { mode: 0o700 });
    }
    await expect(collect(f.observe())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(join(kind === 'changedIdentity' ? join(f.root, 'retained-copy') : copy.root, 'keep'), 'utf8'))
      .toBe(profileInspectionCopyDirectoryName(id(30)));
  });

it('rejects a shared copy when the same generation is also present inside its owning workspace', async context => {
  const f = await fixture(context), copy = await f.inspection();
  const internal = deriveWorkspaceInspectionRemnantPaths(f.root, copy.binding)[0]!;
  await mkdir(internal.rootPath, { recursive: true, mode: 0o700 });
  await expect(collect(f.observe())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readdir(copy.root)).toEqual(['keep']);
  expect((await lstat(internal.rootPath)).isDirectory()).toBe(true);
});

it.for(['parent', 'payload', 'inspectionSlot', 'duplicateGeneration'] as const)(
  'rechecks %s after yielding without adopting changed state', async (kind, context) => {
    const f = await fixture(context), copy = await f.inspection();
    const source = f.observe();
    context.onTestFinished(async () => { await source.return(); });
    for (;;) { const next = await source.next(); if (next.done) throw new Error('MISSING_INSPECTION'); if (next.value.kind === 'inspection') break; }
    if (kind === 'parent' || kind === 'payload') {
      const path = kind === 'parent' ? f.parents[1]!.parentPath : copy.root;
      await rename(path, join(f.root, 'retained-original'));
      await mkdir(path, { mode: 0o700 });
    } else if (kind === 'inspectionSlot') await writeFile(copy.paths.nextPath, serializeWorkspaceRemnantBinding(copy.binding), { mode: 0o600 });
    else await f.publish({ ...copy.binding, operationId: id(21) });
    await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    const retained = kind === 'parent' ? join(f.root, 'retained-original', profileInspectionCopyDirectoryName(id(30)))
      : kind === 'payload' ? join(f.root, 'retained-original') : copy.root;
    expect(await readdir(retained)).toEqual(['keep']);
  });

it('rejects a previously absent parent created after its source observation', async context => {
  const f = await fixture(context), source = f.observe();
  await source.next();
  await mkdir(f.parents[0]!.parentPath, { recursive: true, mode: 0o700 });
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it('rejects a wholly new raw parent selection before the outer parent is rechecked', async context => {
  const f = await fixture(context); await f.publish(f.binding);
  const payload = await f.payload(0, f.binding.operationId), parent = f.parents[0]!;
  const calls: string[] = [];
  const control = f.observe({ ...nativeReads, async directoryIdentity(path, check) {
    calls.push(path); return nativeReads.directoryIdentity(path, check);
  } });
  expect((await nextPayload(control)).value?.kind).toBe('replacement');
  await control.return();
  const sourceStart = calls.indexOf(payload) - parent.ancestors.length;
  let finalParentStart = -1;
  for (let i = 0; i <= calls.length - parent.ancestors.length; i++) {
    if (parent.ancestors.every((path, offset) => path === calls[i + offset])) finalParentStart = i;
  }
  expect(calls.slice(sourceStart, calls.indexOf(payload))).toEqual(parent.ancestors);
  expect(calls.slice(finalParentStart, finalParentStart + parent.ancestors.length)).toEqual(parent.ancestors);
  expect(sourceStart).toBeGreaterThan(0);
  let index = 0, changed = false, restored = false;
  const retained = join(f.root, 'old-import-parent'), replacement = join(f.root, 'new-import-parent');
  const source = f.observe({ ...nativeReads, async directoryIdentity(path, check) {
    const at = index++;
    if (at === sourceStart) {
      await rename(parent.parentPath, retained); await f.payload(0, f.binding.operationId); changed = true;
    }
    // Without the raw ancestor comparison an outer recheck alone would accept the restored parent.
    if (at === finalParentStart) {
      await rename(parent.parentPath, replacement); await rename(retained, parent.parentPath); restored = true;
    }
    return nativeReads.directoryIdentity(path, check);
  } });
  context.onTestFinished(async () => { await source.return(); });
  await expect(nextPayload(source)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true); expect(restored).toBe(false); expect(index).toBeLessThanOrEqual(finalParentStart);
  expect(await readFile(join(retained, f.binding.operationId, 'keep'), 'utf8')).toBe(f.binding.operationId);
  expect(await readFile(join(payload, 'keep'), 'utf8')).toBe(f.binding.operationId);
});

it('rechecks an earlier parent after all four parent observations, before EOF', async context => {
  const f = await fixture(context);
  for (const parent of f.parents) await mkdir(parent.parentPath, { recursive: true, mode: 0o700 });
  const source = f.observe();
  for (const parent of f.parents) expect((await source.next()).value).toMatchObject({ kind: 'parent', role: parent.role });
  await rename(f.parents[0]!.parentPath, join(f.root, 'old-import-parent'));
  await mkdir(f.parents[0]!.parentPath, { mode: 0o700 });
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readdir(join(f.root, 'old-import-parent'))).toEqual([]);
});

it.for(['lease', 'target', 'writers'] as const)('joins the original directory read and close after losing %s', async (kind, context) => {
  const f = await fixture(context);
  await mkdir(f.parents[0]!.parentPath, { recursive: true, mode: 0o700 });
  let enter!: () => void, release!: () => void, settled = false, closed = 0, asserted = false;
  const started = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const source = f.observe({ ...nativeReads, async openDirectory(path) {
    const handle = await nativeReads.openDirectory(path);
    return { async read() { enter(); await pending; return handle.read(); }, async close() { await handle.close(); closed++; } };
  } });
  for (let index = 0; index < f.parents.length; index++) await source.next();
  const work = source.next();
  void work.then(() => { settled = true; }, () => { settled = true; });
  context.onTestFinished(async () => {
    release(); try { await work; } catch (error) { if (!asserted && error !== context.signal.reason) throw error; }
  });
  await started;
  if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
  expect(settled).toBe(false); expect(closed).toBe(0); release();
  await expect(work).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
  asserted = true; expect(closed).toBe(1);
});

it('preserves first read and close errors and leaves no open handle at a yield', async context => {
  const f = await fixture(context); await f.publish(f.binding); await f.payload(0, f.binding.operationId);
  let open = 0;
  const source = f.observe({ ...nativeReads, async openDirectory(path) {
    const handle = await nativeReads.openDirectory(path); open++;
    return { read: () => handle.read(), async close() { await handle.close(); open--; } };
  } });
  await nextPayload(source); expect(open).toBe(0); await source.return(); expect(open).toBe(0);
  const first = new Error('SYNTHETIC_READ'), last = new Error('SYNTHETIC_CLOSE');
  await expect(collect(f.observe({ ...nativeReads, async openDirectory() {
    return { async read() { throw first; }, async close() { throw last; } };
  } }))).rejects.toMatchObject({ errors: [first, last] });
  expect(await readFile(join(f.parents[0]!.parentPath, f.binding.operationId, 'keep'), 'utf8')).toBe(f.binding.operationId);
});
