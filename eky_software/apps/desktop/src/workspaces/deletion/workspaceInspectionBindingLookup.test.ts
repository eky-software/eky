import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize, workspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { observeWorkspaceRemnantBindings } from './workspaceRemnantBindingEnumeration.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { captureWorkspaceRemnantParents } from './workspaceRemnantParentSelection.js';
import { findUniqueWorkspaceInspectionBinding as lookup } from './workspaceReplacementRemnantEnumeration.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

const nativeReads = { ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads };
const invalidCode = 'WORKSPACE_REMNANT_BINDING_INVALID';

async function fixture(context: TestContext, count = 2) {
  const f = await remnantBindingFixture(context, 'profileInspection');
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const bindings: Extract<WorkspaceRemnantBindingV1, { owner: 'profileInspection' }>[] = [];
  const paths: ReturnType<typeof createWorkspaceRemnantBindingPaths>[] = [];
  for (let n = 0; n < count; n++) {
    const binding = captureWorkspaceRemnantBinding({ ...remnantTestBinding('profileInspection'),
      operationId: id(100 + n), generationId: id(200 + n), workspaceId: id(300 + n) });
    if (binding.owner !== 'profileInspection') throw new Error('SYNTHETIC_INSPECTION_BINDING_REQUIRED');
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    bindings.push(binding); paths.push(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)));
  }
  return { ...f, authority, bindings, bindingPaths: paths, unsettled() { writersAbsent = false; },
    lookup: (reads = nativeReads) => lookup(f.root, bindings[0]!.generationId, authority, reads) };
}

it('reads matching current and side slots without treating unrelated slot contents as a complete census', async context => {
  const f = await fixture(context), target = f.bindings[0]!, paths = f.bindingPaths[0]!;
  const bytes = serializeWorkspaceRemnantBinding(target);
  for (const slot of ['next', 'backup'] as const) await writeFile(paths[`${slot}Path`], bytes, { mode: 0o600 });
  await writeFile(f.bindingPaths[1]!.currentPath, '{');
  const selected = await f.lookup();
  expect(selected.value).toEqual(target);
  for (const slot of ['current', 'next', 'backup'] as const) expect(Buffer.from(selected.slots[slot]!.bytes)).toEqual(bytes);
  const complete = async () => { for await (const row of observeWorkspaceRemnantBindings(f.root, 'profileInspection', f.authority)) void row; };
  await expect(complete()).rejects.toThrow(invalidCode);
  expect(await readFile(f.bindingPaths[1]!.currentPath, 'utf8')).toBe('{');
});

it.for(['bytes', 'identity', 'wrongKey'] as const)('rejects matching %s changes between slot observations', async (kind, context) => {
  const f = await fixture(context, 1), target = f.bindings[0]!, paths = f.bindingPaths[0]!;
  const original = WorkspaceRemnantBindingStore.prototype.inspect;
  let changed = false;
  const inspect = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementation(async function(this: WorkspaceRemnantBindingStore, authority) {
    const result = await original.call(this, authority);
    if (!changed && result.mode === 'published') {
      changed = true;
      if (kind === 'identity') {
        const bytes = await readFile(paths.currentPath);
        await rename(paths.currentPath, join(f.root, 'retained-binding'));
        await writeFile(paths.currentPath, bytes, { flag: 'wx', mode: 0o600 });
      } else if (kind === 'bytes') await writeFile(paths.nextPath,
        serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...target, rootIdentity: hash('changed') })), { mode: 0o600 });
      else await writeFile(paths.currentPath,
        serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...target, generationId: id(999) })));
    }
    return result;
  });
  context.onTestFinished(() => inspect.mockRestore());
  await expect(f.lookup()).rejects.toThrow(invalidCode);
  expect(changed).toBe(true);
  expect((await readdir(dirname(paths.currentPath))).length).toBeGreaterThan(0);
});

it.for(['unknownName', 'unmatchedSideOnly', 'laterPageDuplicate'] as const)(
  'rejects %s after the first matching name without accepting an early result', async (kind, context) => {
    const f = await fixture(context, 1), target = f.bindings[0]!;
    const directory = dirname(f.bindingPaths[0]!.currentPath);
    if (kind === 'unknownName') await writeFile(join(directory, 'zz-invalid.json'), 'retained', { mode: 0o600 });
    else if (kind === 'unmatchedSideOnly') {
      const value = captureWorkspaceRemnantBinding({ ...target, operationId: id(999), generationId: id(998) });
      const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(value));
      await writeFile(path.backupPath, serializeWorkspaceRemnantBinding(value), { mode: 0o600 });
    } else {
      for (let n = 0; n < workspaceDeletionDirectoryEntryPageSize; n++) {
        const value = captureWorkspaceRemnantBinding({ ...target, operationId: id(400 + n), generationId: id(500 + n) });
        const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(value));
        await writeFile(path.currentPath, serializeWorkspaceRemnantBinding(value), { mode: 0o600 });
      }
      const value = captureWorkspaceRemnantBinding({ ...target, operationId: id(999), workspaceId: id(888) });
      const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(value));
      await writeFile(path.currentPath, serializeWorkspaceRemnantBinding(value), { mode: 0o600 });
    }
    const names = await readdir(directory), bytes = await readFile(f.bindingPaths[0]!.currentPath);
    await expect(f.lookup()).rejects.toThrow(invalidCode);
    expect(await readdir(directory)).toEqual(names); expect(await readFile(f.bindingPaths[0]!.currentPath)).toEqual(bytes);
  });

it('carries an unmatched current stem across the page boundary onto both side slots', async context => {
  const f = await fixture(context, 1), target = f.bindings[0]!, paths: string[] = [];
  for (const slot of ['next', 'backup'] as const) {
    const path = f.bindingPaths[0]![`${slot}Path`]; paths.push(path);
    await writeFile(path, serializeWorkspaceRemnantBinding(target), { flag: 'wx', mode: 0o600 });
  }
  for (let n = 0; n < 22; n++) {
    const value = captureWorkspaceRemnantBinding({ ...target, operationId: id(400 + n), generationId: id(500 + n) });
    const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(value));
    for (const slot of ['current', 'next', 'backup'] as const) {
      const file = path[`${slot}Path`]; paths.push(file);
      await writeFile(file, serializeWorkspaceRemnantBinding(value), { flag: 'wx', mode: 0o600 });
    }
  }
  const names = (await readdir(dirname(f.bindingPaths[0]!.currentPath))).sort();
  const last = workspaceDeletionDirectoryEntryPageSize - 1;
  expect(names).toHaveLength(69); expect(names[last]!.endsWith('.json')).toBe(true);
  expect(names[last + 1]).toBe(names[last] + '.backup'); expect(names[last + 2]).toBe(names[last] + '.next');
  const before = await Promise.all(paths.map(path => readFile(path, 'hex')));
  expect((await f.lookup()).value).toEqual(target);
  expect(await Promise.all(paths.map(path => readFile(path, 'hex')))).toEqual(before);
});

it.for(['parentChanged', 'writerReturned'] as const)('retains the original caller guard after %s during a read', async (kind, context) => {
  const f = await fixture(context, 1), parent = deriveWorkspaceReplacementRemnantParents(f.root)[1]!;
  await mkdir(parent.parentPath, { recursive: true, mode: 0o700 });
  const retained = join(f.root, 'retained-payload-parent');
  await writeFile(join(parent.parentPath, 'keep'), 'retained', { mode: 0o600 });
  const selected = await captureWorkspaceRemnantParents(parent.ancestors, f.authority, nativeReads);
  const authority = { ...f.authority, assertExternalSelection: selected.assertSelected };
  let calls = 0, closes = 0, restored = false;
  const reads = { ...nativeReads, async openDirectory(path: string) {
    const directory = await nativeReads.openDirectory(path);
    return { async read() {
      calls++;
      if (kind === 'writerReturned') f.unsettled();
      else if (calls === 1) { await rename(parent.parentPath, retained); await mkdir(parent.parentPath, { mode: 0o700 }); }
      else if (calls === 2) {
        await rename(parent.parentPath, join(f.root, 'replacement-parent'));
        await rename(retained, parent.parentPath); restored = true;
      }
      return directory.read();
    }, async close() { closes++; await directory.close(); } };
  } };
  await expect(lookup(f.root, f.bindings[0]!.generationId, authority, reads))
    .rejects.toThrow(kind === 'parentChanged' ? invalidCode : 'SYNTHETIC_WRITER_UNSETTLED');
  expect({ calls, closes, restored }).toEqual({ calls: 1, closes: 1, restored: false });
  expect(await readFile(join(kind === 'parentChanged' ? retained : parent.parentPath, 'keep'), 'utf8')).toBe('retained');
});

it('joins late read and close failures with the original error identities and order', async context => {
  const f = await fixture(context, 1), before = await readFile(f.bindingPaths[0]!.currentPath);
  const first = new Error('SYNTHETIC_LOOKUP_READ'), second = new Error('SYNTHETIC_LOOKUP_CLOSE');
  let opens = 0, closes = 0;
  const reads = { ...nativeReads, async openDirectory(path: string) {
    const directory = await nativeReads.openDirectory(path), fail = ++opens === 2;
    return { async read() { if (fail) throw first; return directory.read(); },
      async close() { closes++; await directory.close(); if (fail) throw second; } };
  } };
  const error = await f.lookup(reads).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toHaveLength(2);
  expect(error.errors[0]).toBe(first); expect(error.errors[1]).toBe(second);
  expect({ opens, closes }).toEqual({ opens: 2, closes: 2 });
  expect(await readFile(f.bindingPaths[0]!.currentPath)).toEqual(before);
});

it.for(['heldRead', 'heldClose'] as const)('joins the original %s promise after revocation', async (kind, context) => {
  const f = await fixture(context, 1), before = await readFile(f.bindingPaths[0]!.currentPath);
  const failure = new Error('SYNTHETIC_LOOKUP_REVOKED');
  let revoked = false, enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let opens = 0, closes = 0, settled = false;
  const authority = { ...f.authority, assertAuthority() { if (revoked) throw failure; f.authority.assertAuthority(); } };
  const reads = { ...nativeReads, async openDirectory(path: string) {
    const directory = await nativeReads.openDirectory(path), second = ++opens === 2;
    return { async read() { if (second && kind === 'heldRead') { enter(); await held; } return directory.read(); },
      async close() { closes++; await directory.close(); if (second && kind === 'heldClose') { enter(); await held; } } };
  } };
  const work = lookup(f.root, f.bindings[0]!.generationId, authority, reads);
  const outcome = work.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  context.onTestFinished(async () => { release(); await outcome; });
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('LOOKUP_SETTLED_BEFORE_GATE'); })]);
    expect(settled).toBe(false); revoked = true;
    await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await outcome; }
  const result = await outcome;
  expect('error' in result && result.error).toBe(failure);
  expect({ opens, closes }).toEqual({ opens: 2, closes: 2 });
  expect(await readFile(f.bindingPaths[0]!.currentPath)).toEqual(before);
});
