import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize as pageSize } from './workspaceDeletionDirectoryEntries.js';
import { captureDeletionInventoryRecord as record, deletionInventoryRecordKey } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import * as census from './workspaceDeletionRemnantCensus.js';
import { deletionRoleSourceFixture as fixture } from './workspaceDeletionRolesTestSupport.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

type Observation = ReturnType<typeof census.observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer Row> ? Row : never;
type CandidateObservation = Extract<Observation, { kind: 'metadataCandidate' }>;

async function seed(context: TestContext) {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding('workspaceImport'));
  await f.payload(deriveWorkspaceBackupImportPaths(f.root,
    validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot);
  return { f, binding, paths: createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)) };
}

it.for([1, pageSize - 1, pageSize, pageSize + 1])('preserves bounded page behavior for %s projected rows and three consumptions', async (count, context) => {
  const { f } = await seed(context);
  let specimen: CandidateObservation | undefined;
  for await (const row of census.observeWorkspaceDeletionRemnants(f.root, f.authority)) {
    if (row.kind === 'metadataCandidate') specimen = row;
  }
  if (specimen === undefined) throw new Error('SYNTHETIC_CANDIDATE_MISSING');
  const original = specimen;
  // Only the page-boundary unit uses projected observations; native readers have separate regressions.
  const synthetic: CandidateObservation[] = Array.from({ length: count - 1 }, (_, index) => {
    const binding = captureWorkspaceRemnantBinding({ ...original.selection.binding, operationId: id(100 + index) });
    const bindingSha256 = workspaceRemnantBindingSha256(binding);
    return { ...original, observation: { ...original.observation,
      key: workspaceRemnantBindingKey(binding), binding: { ...original.observation.binding, value: binding, bindingSha256 } },
      selection: { ...original.selection, binding, bindingSha256, rootIdentity: hash('root-' + index) } };
  });
  let scans = 0;
  vi.spyOn(census, 'observeWorkspaceDeletionRemnants').mockImplementation(async function* (_root, authority) {
    scans++; authority.assertAuthority();
    for (const row of synthetic) { authority.assertAuthority(); yield row; authority.assertAuthority(); }
  });
  context.onTestFinished(() => { vi.restoreAllMocks(); });
  const source = await f.capture();
  expect(scans).toBe(1);
  const expected = [source.workspace, ...synthetic.map(row => record({ role: 'importCandidate',
    ownerOperationId: row.selection.binding.operationId, generationId: null, member: null,
    bindingSha256: row.selection.bindingSha256, rootIdentity: row.selection.rootIdentity,
    parentIdentity: row.selection.parentIdentity }))].sort((a, b) => {
    const left = deletionInventoryRecordKey(a), right = deletionInventoryRecordKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (let pass = 1; pass <= 3; pass++) {
    const rows = await f.collect(source.records());
    expect(rows).toEqual(expected);
    expect(new Set(rows.map(deletionInventoryRecordKey)).size).toBe(count);
    expect(rows.every(Object.isFrozen)).toBe(true);
    expect(scans).toBe(count < pageSize ? 1 + pass : pass * 3);
  }
});

it.for(['secondRaw', 'thirdRaw', 'next', 'root', 'foreign', 'newRoot'] as const)(
  'rejects persistent %s in a later consumption and preserves affected bytes', async (kind, context) => {
    const { f, paths } = await seed(context);
    let changedPaths = paths;
    if (kind === 'foreign') {
      const binding = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(90), workspaceId: id(99) });
      await f.payload(deriveWorkspaceBackupImportPaths(f.root,
        validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot);
      changedPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
    }
    const source = await f.capture();
    await f.collect(source.records());
    if (kind === 'thirdRaw') await f.collect(source.records());
    const original = await readFile(changedPaths.currentPath);
    let retainedPath = changedPaths.currentPath;
    if (kind === 'secondRaw' || kind === 'thirdRaw' || kind === 'foreign') {
      await writeFile(changedPaths.currentPath, Buffer.concat([Buffer.from(' '), original]));
    }
    if (kind === 'next') { retainedPath = paths.nextPath; await writeFile(retainedPath, original, { flag: 'wx' }); }
    if (kind === 'root') {
      retainedPath = join(f.root, 'original-workspace');
      await rename(f.workspace.workspaceRoot, retainedPath); await mkdir(f.workspace.workspaceRoot, { mode: 0o700 });
    }
    if (kind === 'newRoot') {
      retainedPath = join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(99));
      await f.payload(retainedPath);
    }
    const path = kind === 'root' || kind === 'newRoot' ? join(retainedPath, 'retained-payload') : retainedPath;
    const before = await readFile(path);
    await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(path)).toEqual(before);
    await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  });

it.for([2, 3])('rejects a cursor-behind addition after the first row in consumption %s', async (pass, context) => {
  const { f } = await seed(context), source = await f.capture();
  for (let prior = 1; prior < pass; prior++) await f.collect(source.records());
  const rows = source.records();
  try {
    const first = await rows.next();
    if (first.done) throw new Error('SYNTHETIC_SOURCE_EMPTY');
    expect(first.value.role).toBe('importCandidate');
    const late = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(0), workspaceId: id(99) });
    const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(late)).currentPath;
    const bytes = await readFile(path), before = await f.preserved();
    await expect(f.collect(rows)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(path)).toEqual(bytes);
    expect(await f.preserved()).toEqual(before);
    await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  } finally { await rows.return(undefined); }
});

it('invalidates an abandoned second expected-page consumption', async context => {
  const { f } = await seed(context), source = await f.capture();
  await f.collect(source.records());
  const rows = source.records();
  expect((await rows.next()).done).toBe(false);
  await rows.return(undefined);
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it.for([false, true])('joins a real later-read close and preserves the first failure, including undefined: %s', async (undefinedFirst, context) => {
  const { f } = await seed(context);
  let armed = false, entered!: () => void, release!: () => void, closed = 0, settled = false;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = undefinedFirst ? undefined : new Error('SYNTHETIC_FIRST_READ');
  const close = new Error('SYNTHETIC_REAL_CLOSE');
  const source = await f.capture({ ...census.workspaceDeletionRemnantReads, async openDirectory(path) {
    const directory = await census.workspaceDeletionRemnantReads.openDirectory(path);
    if (!armed) return directory;
    return { async read() { throw first; }, async close() { entered(); await held; await directory.close(); closed++; throw close; } };
  } });
  await f.collect(source.records()); armed = true;
  const work = f.collect(source.records()).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
    .finally(() => { settled = true; });
  try { await Promise.race([reached, work]); expect(settled).toBe(false); expect(closed).toBe(0); }
  finally { release(); await work; }
  const result = await work;
  expect(result.ok).toBe(false);
  if (!result.ok) { expect(result.error).toBeInstanceOf(AggregateError); expect(result.error.errors).toEqual([first, close]); }
  expect(closed).toBe(1);
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it('rejects rewritten binding identity even after its original bytes are restored', async context => {
  const { f, binding, paths } = await seed(context), source = await f.capture();
  await f.collect(source.records());
  const original = await readFile(paths.currentPath);
  const metadata = await stat(paths.currentPath);
  await writeFile(paths.currentPath, serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({
    ...binding, lineageIdentity: { formatVersion: 1, profileId: hash('temporary-lineage') },
  })));
  await writeFile(paths.currentPath, original);
  await utimes(paths.currentPath, metadata.atime, new Date(metadata.mtimeMs + 2_000));
  expect((await stat(paths.currentPath)).mtimeMs).not.toBe(metadata.mtimeMs);
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(paths.currentPath)).toEqual(original);
});

it('compares expected rows against a fresh EOF after a completely removed transient foreign root', async context => {
  const { f, binding } = await seed(context), before = await f.preserved();
  const store = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
  let source!: Awaited<ReturnType<typeof f.capture>>;
  async function* initial() { source = await f.capture(); yield* source.records(); }
  const selected = await store.publish(header, initial(), f.authority);
  const own = deriveWorkspaceBackupImportPaths(f.root,
    validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot;
  const extra = join(dirname(own), id(99));
  await expect(readFile(extra)).rejects.toMatchObject({ code: 'ENOENT' });
  await mkdir(extra, { mode: 0o700 });
  const restore = () => rm(extra, { recursive: true, force: true });
  async function* temporary() {
    const rows = source.records();
    try {
      const first = await rows.next();
      await restore();
      if (!first.done) yield first.value;
      yield* rows;
    } finally { await restore(); await rows.return(undefined); }
  }
  const work = store.assertRecords(selected, temporary(), f.authority);
  context.onTestFinished(async () => { await work.catch(() => undefined); await restore(); });
  await expect(work).resolves.toBeUndefined();
  expect(await f.preserved()).toEqual(before);
  await expect(readFile(extra)).rejects.toMatchObject({ code: 'ENOENT' });
});
