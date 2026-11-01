import { lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportOperationPaths, deriveWorkspaceBackupImportOperationsPaths } from '../import/workspaceBackupImportPaths.js';
import { workspaceBackupPlaintextQuarantineDirectoryName as quarantineName } from '../import/workspaceBackupPlaintextQuarantine.js';
import { observeWorkspaceCandidateOperations as observe } from './workspaceCandidateRemnantEnumeration.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

const nativeReads = { ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads };
async function collect(source: ReturnType<typeof observe>) {
  const rows = [];
  for await (const row of source) rows.push(row);
  return rows;
}
async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context, 'workspaceImport');
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const paths = deriveWorkspaceBackupImportOperationsPaths(f.root);
  return { ...f, authority, paths, quarantine: join(paths.operationsRoot, quarantineName),
    unsettled() { writersAbsent = false; },
    async operation(operationId: unknown = f.binding.operationId) {
      const path = deriveWorkspaceBackupImportOperationPaths(f.root, operationId).operationRoot;
      await mkdir(path, { recursive: true, mode: 0o700 }); return path;
    },
    async candidate(operationId: unknown = f.binding.operationId, workspaceId: unknown = f.binding.workspaceId) {
      const binding = captureWorkspaceRemnantBinding({ ...f.binding, operationId, workspaceId });
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
      const path = join(deriveWorkspaceBackupImportOperationPaths(f.root, binding.operationId).operationRoot, binding.workspaceId);
      await mkdir(path, { recursive: true, mode: 0o700 });
      await writeFile(join(path, 'keep'), binding.operationId, { mode: 0o600 }); return path;
    },
    observe: (reads = nativeReads) => observe(f.root, authority, reads) };
}

it('observes absent shared parents without creating them', async context => {
  const f = await fixture(context);
  const rows = await collect(f.observe());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'operationsParent', rootPath: f.paths.operationsRoot, ancestorIdentities: [expect.any(String), null] });
  await expect(lstat(f.paths.operationsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retains empty shared and operation parents and the empty installation quarantine', async context => {
  const f = await fixture(context), root = await f.operation();
  await mkdir(f.quarantine, { mode: 0o700 });
  const rows = await collect(f.observe());
  expect(rows.map(row => row.kind)).toEqual(['operationsParent', 'operation', 'installationQuarantine']);
  expect(rows[1]).toMatchObject({ operationId: f.binding.operationId, rootPath: root, rootIdentity: expect.any(String) });
  expect(await readdir(root)).toEqual([]); expect(await readdir(f.quarantine)).toEqual([]);
  expect(Object.isFrozen(rows[0])).toBe(true);
});

it('enumerates actual payloads across operations including a different workspace', async context => {
  const f = await fixture(context), first = await f.candidate();
  const other = await f.candidate(id(8), id(9));
  const before = await f.snapshot();
  const rows = await collect(f.observe());
  expect(rows.map(row => row.kind)).toEqual(['operationsParent', 'operation', 'candidate', 'operation', 'candidate']);
  const candidates = rows.flatMap(row => row.kind === 'candidate' ? [row.selection] : []);
  expect(candidates.map(row => row.rootPath)).toEqual([first, other]);
  expect(candidates[1]!.binding.workspaceId).toBe(id(9));
  expect(await readFile(join(first, 'keep'), 'utf8')).toBe(f.binding.operationId);
  expect(await readFile(join(other, 'keep'), 'utf8')).toBe(id(8));
  expect(await f.snapshot()).toEqual(before);
});

it.for(['unboundCandidate', 'unknownName', 'regularFile', 'link', 'stalePlaintext'] as const)(
  'rejects %s and preserves actual bytes instead of skipping them', async (kind, context) => {
    const f = await fixture(context), root = await f.operation();
    const payload = join(f.root, 'outside'); await mkdir(payload, { mode: 0o700 });
    await writeFile(join(payload, 'keep'), 'foreign', { mode: 0o600 });
    if (kind === 'unboundCandidate') await mkdir(join(root, id(8)), { mode: 0o700 });
    if (kind === 'unknownName') await mkdir(join(f.paths.operationsRoot, 'unknown'), { mode: 0o700 });
    if (kind === 'regularFile') await writeFile(join(f.paths.operationsRoot, id(8)), 'keep', { mode: 0o600 });
    if (kind === 'link') await symlink(payload, join(f.paths.operationsRoot, id(8)), process.platform === 'win32' ? 'junction' : 'dir');
    if (kind === 'stalePlaintext') {
      await mkdir(f.quarantine, { mode: 0o700 });
      await writeFile(join(f.quarantine, `workspace-import-${id(8)}.payload`), 'synthetic-plaintext', { mode: 0o600 });
    }
    const before = await readdir(f.paths.operationsRoot);
    await expect(collect(f.observe())).rejects.toThrow();
    expect(await readdir(f.paths.operationsRoot)).toEqual(before);
    expect(await readFile(join(payload, 'keep'), 'utf8')).toBe('foreign');
    if (kind === 'stalePlaintext') expect(await readFile(join(f.quarantine, `workspace-import-${id(8)}.payload`), 'utf8')).toBe('synthetic-plaintext');
    if (kind === 'regularFile') expect(await readFile(join(f.paths.operationsRoot, id(8)), 'utf8')).toBe('keep');
  });

it.for(['parent', 'operation', 'quarantine'] as const)(
  'rejects replaced %s identity after yielding its observation', async (kind, context) => {
    const f = await fixture(context), operation = await f.operation();
    if (kind === 'quarantine') await mkdir(f.quarantine, { mode: 0o700 });
    const source = f.observe();
    expect((await source.next()).value?.kind).toBe('operationsParent');
    if (kind !== 'parent') expect((await source.next()).value?.kind).toBe('operation');
    if (kind === 'quarantine') expect((await source.next()).value?.kind).toBe('installationQuarantine');
    const changed = kind === 'parent' ? f.paths.operationsRoot : kind === 'operation' ? operation : f.quarantine;
    await rename(changed, join(f.root, 'retained'));
    await mkdir(changed, { mode: 0o700 });
    await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect((await lstat(join(f.root, 'retained'))).isDirectory()).toBe(true);
  });

it('does not adopt a replacement shared parent while selecting an operation', async context => {
  const f = await fixture(context); await f.operation();
  let changed = false;
  const reads = { ...nativeReads, async directoryIdentity(path: string, check: () => void) {
    if (path.endsWith(f.binding.operationId) && !changed) {
      changed = true;
      await rename(f.paths.operationsRoot, join(f.root, 'retained'));
      await f.operation();
    }
    return nativeReads.directoryIdentity(path, check);
  } };
  await expect(collect(f.observe(reads))).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
});

it('rejects a new ancestor prefix before yielding an operation selected entirely after replacement', async context => {
  const f = await fixture(context), operation = await f.operation();
  const identityCalls: string[] = [];
  await collect(f.observe({ ...nativeReads, async directoryIdentity(path, check) {
    identityCalls.push(path); return nativeReads.directoryIdentity(path, check);
  } }));
  const firstChild = identityCalls.indexOf(operation);
  const prefixStart = firstChild - 2;
  expect(prefixStart).toBeGreaterThan(0);
  expect(identityCalls.slice(prefixStart, firstChild + 1)).toEqual([f.root, f.paths.operationsRoot, operation]);
  let index = 0, changed = false;
  const source = f.observe({ ...nativeReads, async directoryIdentity(path, check) {
    if (index++ === prefixStart) {
      expect(path).toBe(f.root);
      await rename(f.paths.operationsRoot, join(f.root, 'original-parent'));
      await f.operation();
      changed = true;
    }
    return nativeReads.directoryIdentity(path, check);
  } });
  context.onTestFinished(async () => { await source.return(); });
  expect((await source.next()).value?.kind).toBe('operationsParent');
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect((await lstat(join(f.root, 'original-parent', f.binding.operationId))).isDirectory()).toBe(true);
  expect((await lstat(operation)).isDirectory()).toBe(true);
});

it('reads more than one page without imposing a total operation count limit', async context => {
  const f = await fixture(context);
  for (let index = 100; index >= 36; index--) await f.operation(id(index));
  const work = collect(f.observe());
  let completed = false;
  context.onTestFinished(async () => {
    try { await work; } catch (error) { if (!completed && error !== context.signal.reason) throw error; }
  });
  const rows = await work;
  completed = true;
  expect(rows).toHaveLength(66);
  expect(rows.flatMap(row => row.kind === 'operation' ? [row.operationId] : []))
    .toEqual(Array.from({ length: 65 }, (_, index) => id(index + 36)));
});

it('requires a fresh whole-source scan to see a name introduced behind the cursor', async context => {
  const f = await fixture(context); await f.operation(id(8));
  const source = f.observe();
  await source.next();
  expect((await source.next()).value).toMatchObject({ kind: 'operation', operationId: id(8) });
  await f.operation(id(7));
  expect((await source.next()).done).toBe(true);
  expect((await collect(f.observe())).flatMap(row => row.kind === 'operation' ? [row.operationId] : []))
    .toEqual([id(7), id(8)]);
});

it.for(['lease', 'target', 'writer'] as const)(
  'joins an original shared-parent read and closes it after %s loss', async (kind, context) => {
    const f = await fixture(context); await f.operation();
    let enter!: () => void, release!: () => void, settled = false, closed = 0, asserted = false;
    const entering = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const source = f.observe({ ...nativeReads, async openDirectory(path) {
      const directory = await nativeReads.openDirectory(path);
      return { async read() { enter(); await pending; return directory.read(); },
        async close() { await directory.close(); closed++; } };
    } });
    await source.next();
    const work = source.next();
    void work.then(() => { settled = true; }, () => { settled = true; });
    context.onTestFinished(async () => {
      release(); try { await work; } catch (error) { if (!asserted && error !== context.signal.reason) throw error; }
    });
    await entering;
    if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
    expect(settled).toBe(false); expect(closed).toBe(0); release();
    await expect(work).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
      : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
    asserted = true;
    expect(closed).toBe(1);
  });

it('closes every directory before yielding and preserves read and close errors', async context => {
  const f = await fixture(context); await f.operation();
  let opened = 0, closed = 0;
  const source = f.observe({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path); opened++;
    return { read: () => directory.read(), async close() { await directory.close(); closed++; } };
  } });
  await source.next(); await source.next(); await source.return();
  expect(opened).toBeGreaterThan(0); expect(closed).toBe(opened);
  const first = new Error('SYNTHETIC_READ'), last = new Error('SYNTHETIC_CLOSE');
  await expect(collect(f.observe({ ...nativeReads, async openDirectory() {
    return { async read() { throw first; }, async close() { throw last; } };
  } }))).rejects.toMatchObject({ errors: [first, last] });
});
