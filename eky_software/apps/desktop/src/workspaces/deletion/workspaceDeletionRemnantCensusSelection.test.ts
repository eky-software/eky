import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deletionTestDigest as hash, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import * as census from './workspaceDeletionRemnantCensus.js';
import { captureWorkspaceDeletionRemnantCensus as capture } from './workspaceDeletionRemnantCensusSelection.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context, 'workspaceImport');
  let writers = false;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (writers) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const track = <T>(work: Promise<T>) => {
    context.onTestFinished(async () => { await work.catch(() => undefined); }); return work;
  };
  return { ...f, authority, track, unsettled() { writers = true; },
    async capture(reads = nativeReads) { return track(capture(f.root, authority, reads)); } };
}

it('compares missing and empty sources without creating state or exporting a deletion grant', async context => {
  const f = await fixture(context), selected = await f.capture();
  await f.track(selected.assertUnchanged());
  expect(Object.keys(selected)).toEqual(['assertUnchanged']);
  expect(await readdir(f.root)).toEqual([]);
});

it('compares every raw side slot and the same native identities without modifying them', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  for (const slot of ['next', 'backup'] as const) await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  const before = await f.snapshot(), selected = await f.capture();
  await f.track(selected.assertUnchanged());
  expect(await f.snapshot()).toEqual(before);
});

it.for(['rawBytes', 'sideAdded', 'identity', 'emptyParent', 'newBehindCursor', 'foreignLineage', 'payloadAppeared'] as const)(
  'rejects %s in a fresh full pass without adopting the changed selection', async (kind, context) => {
    const f = await fixture(context); await f.store().publish(f.binding, f.authority);
    const selected = await f.capture();
    if (kind === 'rawBytes') await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.binding).toString('utf8')}`, { mode: 0o600 });
    if (kind === 'sideAdded') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    if (kind === 'identity') {
      await rename(f.paths.currentPath, join(f.root, 'retained-original'));
      await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    }
    if (kind === 'emptyParent') {
      const paths = createWorkspaceRemnantBindingPaths(f.root, { owner: 'workspaceActivationMigration', operationId: id(20) });
      await mkdir(paths.directoryPath, { mode: 0o700 });
    }
    if (kind === 'newBehindCursor') {
      const other = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(0), workspaceId: id(8) });
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(other)).publish(other, f.authority);
    }
    if (kind === 'foreignLineage') {
      const other = captureWorkspaceRemnantBinding({ ...f.binding, lineageIdentity: { formatVersion: 1, profileId: hash('changed-lineage') } });
      await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(other), { mode: 0o600 });
    }
    if (kind === 'payloadAppeared') {
      const paths = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId);
      await mkdir(paths.candidateRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(paths.candidateRoot, 'retained'), 'synthetic', { mode: 0o600 });
    }
    const before = await f.snapshot();
    await expect(f.track(selected.assertUnchanged())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.snapshot()).toEqual(before);
  });

it('does not rehabilitate a failed receipt after the old bytes are restored', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  let reads = 0;
  const selected = await f.capture({ ...nativeReads, async directoryIdentity(path, check) {
    reads++; return nativeReads.directoryIdentity(path, check);
  } });
  await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  await rename(f.paths.nextPath, join(f.root, 'retained-side'));
  const afterFailure = reads;
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(reads).toBe(afterFailure);
  const fresh = await f.capture(); await f.track(fresh.assertUnchanged());
});

it.for(['lease', 'target', 'writers'] as const)('retains the first %s failure instead of replacing it with a digest mismatch', async (kind, context) => {
  const f = await fixture(context), selected = await f.capture();
  if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
  expect(await readdir(f.root)).toEqual([]);
});

it('retains both directory read and close failures, with no successful partial census', async context => {
  const f = await fixture(context); await f.store().publish(f.binding, f.authority);
  const first = new Error('SYNTHETIC_READ_FAILURE'), cleanup = new Error('SYNTHETIC_CLOSE_FAILURE');
  let closed = false;
  await expect(f.capture({ ...nativeReads, async openDirectory() {
    return { async read() { throw first; }, async close() { closed = true; throw cleanup; } };
  } })).rejects.toMatchObject({ errors: [first, cleanup] });
  expect(closed).toBe(true);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('projects only the initial full pass without filtering the final source comparison', async context => {
  const f = await fixture(context);
  let count = 0;
  const selected = await f.track(capture(f.root, f.authority, nativeReads, () => { count++; }));
  const initial = count;
  expect(initial).toBeGreaterThan(5);
  await f.track(selected.assertUnchanged());
  expect(count).toBe(initial);
  await f.store().publish(f.binding, f.authority);
  await expect(f.track(selected.assertUnchanged())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(count).toBe(initial);
});

it('joins and retains a source close failure when initial projection throws', async context => {
  const f = await fixture(context);
  const original = census.observeWorkspaceDeletionRemnants(f.root, f.authority);
  const first = await original.next();
  await original.return(undefined);
  if (first.done) throw new Error('SYNTHETIC_MISSING_SOURCE_ROW');
  const projectionFailure = new Error('SYNTHETIC_PROJECTION_FAILED'), closeFailure = new Error('SYNTHETIC_CLOSE_FAILED');
  let closed = false;
  const mocked = vi.spyOn(census, 'observeWorkspaceDeletionRemnants').mockImplementation(async function* () {
    try { yield first.value; } finally { closed = true; throw closeFailure; }
  });
  context.onTestFinished(() => { mocked.mockRestore(); });
  await expect(f.track(capture(f.root, f.authority, nativeReads, () => { throw projectionFailure; })))
    .rejects.toMatchObject({ errors: [projectionFailure, closeFailure] });
  expect(closed).toBe(true);
});
