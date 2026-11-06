import { mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { observeWorkspaceCandidateRemnants as observe } from './workspaceCandidateRemnantEnumeration.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

const nativeReads = { ...workspaceDeletionDirectoryReads, ...workspaceInspectionRemnantReads };
async function collect(source: ReturnType<typeof observe>) {
  const rows = [];
  for await (const row of source) rows.push(row);
  return rows;
}
async function fixture(context: TestContext, owner: 'workspaceImport' | 'workspaceLegacyAdoption' = 'workspaceImport') {
  const f = await remnantBindingFixture(context, owner);
  let writersAbsent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const paths = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId);
  return { ...f, authority, candidate: paths,
    unsettled() { writersAbsent = false; },
    async publish() { await f.store().publish(f.binding, authority); },
    async payload() { await mkdir(paths.candidateRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(paths.candidateRoot, 'keep'), 'synthetic-candidate', { mode: 0o600 }); },
    observe: (reads = nativeReads) => observe(f.root, f.binding.operationId, authority, reads) };
}

it.for(['workspaceImport', 'workspaceLegacyAdoption'] as const)(
  'enumerates the actual %s candidate and leaves its bytes unchanged', async (owner, context) => {
    const f = await fixture(context, owner); await f.publish(); await f.payload();
    const before = await f.snapshot();
    const rows = await collect(f.observe());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.binding).toEqual(f.binding);
    expect(rows[0]!.rootPath).toBe(f.candidate.candidateRoot);
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.candidate.candidateRoot, 'keep'), 'utf8')).toBe('synthetic-candidate');
  });

it('does not create missing operation parents or infer payload absence from metadata', async context => {
  const f = await fixture(context); await f.publish();
  expect(await collect(f.observe())).toEqual([]);
  await expect(readdir(f.candidate.operationsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it('includes proven foreign candidates instead of filtering them out', async context => {
  const f = await fixture(context, 'workspaceLegacyAdoption'); await f.publish(); await f.payload();
  const foreign = captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(8) });
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(foreign)).publish(foreign, f.authority);
  const foreignRoot = join(f.candidate.operationRoot, foreign.workspaceId);
  await mkdir(foreignRoot, { mode: 0o700 }); await writeFile(join(foreignRoot, 'keep'), 'foreign', { mode: 0o600 });
  expect((await collect(f.observe())).map(row => row.binding.workspaceId)).toEqual([f.binding.workspaceId, foreign.workspaceId]);
  expect(await readFile(join(foreignRoot, 'keep'), 'utf8')).toBe('foreign');
});

it.for(['unbound', 'unknownName', 'regularFile', 'link'] as const)(
  'refuses %s actual entries even beside a valid candidate', async (kind, context) => {
    const f = await fixture(context); await f.publish(); await f.payload();
    const extra = join(f.candidate.operationRoot, kind === 'unknownName' ? 'unknown' : id(8));
    if (kind === 'regularFile') await writeFile(extra, 'retained-file', { mode: 0o600 });
    else if (kind === 'link') await symlink(f.candidate.candidateRoot, extra, process.platform === 'win32' ? 'junction' : 'dir');
    else await mkdir(extra, { mode: 0o700 });
    const before = await readdir(f.candidate.operationRoot);
    await expect(collect(f.observe())).rejects.toThrow();
    expect(await readdir(f.candidate.operationRoot)).toEqual(before);
    expect(await readFile(join(f.candidate.candidateRoot, 'keep'), 'utf8')).toBe('synthetic-candidate');
    if (kind === 'regularFile') expect(await readFile(extra, 'utf8')).toBe('retained-file');
  });

it.for(['root', 'parent', 'binding'] as const)(
  'rejects %s changed while the consumer holds a candidate', async (kind, context) => {
    const f = await fixture(context); await f.publish(); await f.payload();
    const source = f.observe();
    expect((await source.next()).done).toBe(false);
    if (kind === 'root') { await rename(f.candidate.candidateRoot, join(f.root, 'saved-root')); await f.payload(); }
    else if (kind === 'parent') {
      const saved = join(f.root, 'saved-parent');
      await rename(f.candidate.operationRoot, saved); await mkdir(f.candidate.operationRoot, { mode: 0o700 });
      await rename(join(saved, f.binding.workspaceId), f.candidate.candidateRoot);
    } else await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(join(f.candidate.candidateRoot, 'keep'), 'utf8')).toBe('synthetic-candidate');
  });

it('rejects a candidate disappearing after its name was observed', async context => {
  const f = await fixture(context); await f.publish(); await f.payload();
  let changed = false;
  await expect(collect(f.observe({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    return { read: () => directory.read(), async close() {
      await directory.close();
      if (!changed) { await rename(f.candidate.candidateRoot, join(f.root, 'saved-candidate')); changed = true; }
    } };
  } }))).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect(await readFile(join(f.root, 'saved-candidate', 'keep'), 'utf8')).toBe('synthetic-candidate');
});

it.for(['lease', 'target', 'writer'] as const)(
  'joins a pending directory read and closes its handle after %s loss', async (kind, context) => {
    const f = await fixture(context); await f.publish(); await f.payload();
    let enter!: () => void, release!: () => void, settled = false, closed = 0, asserted = false;
    const entering = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const source = f.observe({ ...nativeReads, async openDirectory(path) {
      const directory = await nativeReads.openDirectory(path);
      return { async read() { enter(); await pending; return directory.read(); },
        async close() { await directory.close(); closed++; } };
    } });
    const work = source.next();
    void work.then(() => { settled = true; }, () => { settled = true; });
    context.onTestFinished(async () => {
      release();
      try { await work; } catch (error) { if (!asserted && error !== context.signal.reason) throw error; }
    });
    await entering;
    if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
    expect(settled).toBe(false); expect(closed).toBe(0); release();
    await expect(work).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
      : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
    asserted = true;
    expect(closed).toBe(1);
    expect(await readFile(join(f.candidate.candidateRoot, 'keep'), 'utf8')).toBe('synthetic-candidate');
  });

it('retains both a directory read failure and its close failure', async context => {
  const f = await fixture(context); await f.publish(); await f.payload();
  const first = new Error('SYNTHETIC_READ'), last = new Error('SYNTHETIC_CLOSE');
  await expect(collect(f.observe({ ...nativeReads, async openDirectory() {
    return { async read() { throw first; }, async close() { throw last; } };
  } }))).rejects.toMatchObject({ errors: [first, last] });
  expect((await readFile(f.paths.currentPath)).equals(serializeWorkspaceRemnantBinding(f.binding))).toBe(true);
});

it('has no open directory handle when the consumer stops after one candidate', async context => {
  const f = await fixture(context); await f.publish(); await f.payload();
  let opened = 0, closed = 0;
  const source = f.observe({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path); opened++;
    return { read: () => directory.read(), async close() { await directory.close(); closed++; } };
  } });
  expect((await source.next()).done).toBe(false);
  await source.return(undefined);
  expect(opened).toBeGreaterThan(0); expect(opened).toBe(closed);
});
