import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { observeWorkspaceDeletionRemnants as observe, workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context);
  let absent = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!absent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const retained: string[] = [];
  const publish = async (value: unknown) => {
    const binding = captureWorkspaceRemnantBinding(value);
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    retained.push(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath);
    return binding;
  };
  const payload = async (root: string) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, 'retained-payload');
    await writeFile(path, 'synthetic retained bytes', { mode: 0o600 }); retained.push(path);
    return root;
  };
  const collect = async (reads = nativeReads) => {
    const work = (async () => {
      const result = [];
      for await (const row of observe(f.root, authority, reads)) result.push(row);
      return result;
    })();
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    return work;
  };
  return { ...f, authority, publish, payload, collect, unsettled() { absent = false; },
    async preserved() { return Promise.all(retained.map(path => readFile(path, 'hex'))); } };
}

it('includes all five missing metadata directories and every shared payload parent without creating them', async context => {
  const f = await fixture(context), rows = await f.collect();
  expect(rows.filter(row => row.kind === 'metadataDirectory').map(row => row.observation.owner)).toEqual(workspaceRemnantBindingOwners);
  expect(rows.filter(row => row.kind === 'metadataDirectory').every(row => !row.observation.selection.present)).toBe(true);
  expect(rows.filter(row => row.kind === 'replacementSource')).toHaveLength(4);
  expect(rows.filter(row => row.kind === 'candidateSource')).toHaveLength(1);
  expect(rows.filter(row => row.kind === 'legacySource')).toHaveLength(1);
  expect(await readdir(f.root)).toEqual([]);
});

it.for(workspaceRemnantBindingOwners)('preserves payloadless %s metadata as an explicit observation, never a cleanup grant', async (owner, context) => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding(owner));
  const before = await f.preserved(), rows = await f.collect();
  const paired = rows.filter(row => 'hasPayload' in row);
  expect(paired).toHaveLength(1);
  expect(paired[0]).toMatchObject({ observation: { binding: { value: binding } }, hasPayload: false });
  expect(paired[0]).not.toHaveProperty('record');
  expect(await f.preserved()).toEqual(before);
});

it('pairs all owner kinds with actual roots and retains a foreign candidate and internal inspection', async context => {
  const f = await fixture(context), parents = deriveWorkspaceReplacementRemnantParents(f.root);
  const replacement = await f.publish(remnantTestBinding('workspaceReplacement'));
  await f.payload(join(parents[0]!.parentPath, replacement.operationId));
  const migration = await f.publish({ ...remnantTestBinding('workspaceActivationMigration'), operationId: id(10) });
  await f.payload(join(parents[1]!.parentPath, migration.operationId));
  const imported = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(20), workspaceId: id(22) });
  await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(imported.operationId), imported.workspaceId).candidateRoot);
  const adopted = await f.publish({ ...remnantTestBinding('workspaceLegacyAdoption'), operationId: id(30) });
  const legacyPath = join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames[0]!);
  await mkdir(dirname(legacyPath), { recursive: true, mode: 0o700 });
  await writeFile(legacyPath, 'synthetic legacy bytes', { mode: 0o600 });
  const initial = remnantTestBinding('profileInspection'), location = deriveWorkspaceInspectionRemnantPaths(f.root, initial)[0]!;
  await f.payload(location.rootPath);
  const inspection = await f.publish({ ...initial,
    rootIdentity: await nativeReads.directoryIdentity(location.rootPath, authorityCheck),
    parentIdentity: await nativeReads.directoryIdentity(location.parentPath, authorityCheck) });
  const before = await f.preserved(), rows = await f.collect();
  expect(rows.filter(row => 'hasPayload' in row).map(row => [row.observation.binding.value.owner, row.hasPayload]))
    .toEqual(workspaceRemnantBindingOwners.map(owner => [owner, true]));
  expect(rows.filter(row => row.kind === 'metadataCandidate').map(row => row.selection.binding.workspaceId)).toEqual([imported.workspaceId, adopted.workspaceId]);
  const observed = rows.find(row => row.kind === 'metadataInspection');
  expect(observed).toMatchObject({ selection: { binding: inspection, selected: { location: { scope: 'workspace' } } } });
  expect(rows.filter(row => row.kind === 'replacementSource' && row.observation.kind === 'replacement')).toHaveLength(2);
  expect(rows.filter(row => row.kind === 'candidateSource' && row.observation.kind === 'candidate')).toHaveLength(1);
  expect(await f.preserved()).toEqual(before);
  expect(await readFile(legacyPath, 'utf8')).toBe('synthetic legacy bytes');
  function authorityCheck() { f.authority.assertAuthority(); }
});

it.for(['replacement', 'candidate', 'legacy'] as const)('rejects unindexed %s payload found only by the actual-parent pass', async (kind, context) => {
  const f = await fixture(context);
  const root = kind === 'replacement' ? join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(99))
    : kind === 'candidate' ? deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(id(99)), validateWorkspaceId(id(98))).candidateRoot
      : join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames[0]!);
  await f.payload(root); const before = await f.preserved();
  await expect(f.collect()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});

it.for(['absent', 'internal'] as const)('rejects two operations claiming one %s inspection generation', async (kind, context) => {
  const f = await fixture(context), initial = remnantTestBinding('profileInspection');
  let binding = initial;
  if (kind === 'internal') {
    const location = deriveWorkspaceInspectionRemnantPaths(f.root, initial)[0]!;
    await f.payload(location.rootPath);
    binding = captureWorkspaceRemnantBinding({ ...initial,
      rootIdentity: await nativeReads.directoryIdentity(location.rootPath, f.authority.assertAuthority),
      parentIdentity: await nativeReads.directoryIdentity(location.parentPath, f.authority.assertAuthority) });
  }
  await f.publish(binding); await f.publish({ ...binding, operationId: id(50) });
  const before = await f.preserved();
  await expect(f.collect()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});

it('retains raw next and backup slots and rejects a change while the paired metadata observation is held', async context => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding('workspaceImport'));
  const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
  for (const slot of ['next', 'backup'] as const) await writeFile(paths[`${slot}Path`], serializeWorkspaceRemnantBinding(binding), { mode: 0o600 });
  const source = observe(f.root, f.authority);
  context.onTestFinished(async () => { await source.return(undefined); });
  for (;;) {
    const next = await source.next(); if (next.done) throw new Error('MISSING_PAIRED_ROW');
    if (next.value.kind !== 'metadataCandidate') continue;
    for (const slot of ['current', 'next', 'backup'] as const) {
      expect(Buffer.from(next.value.observation.binding.slots[slot]!.bytes)).toEqual(serializeWorkspaceRemnantBinding(binding));
    }
    break;
  }
  await writeFile(paths.nextPath, ` ${serializeWorkspaceRemnantBinding(binding).toString('utf8')}`, { mode: 0o600 });
  const changed = await readFile(paths.nextPath);
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(paths.nextPath)).toEqual(changed);
});

it('pins an earlier absent metadata parent through the end of the actual-payload pass', async context => {
  const f = await fixture(context), source = observe(f.root, f.authority);
  context.onTestFinished(async () => { await source.return(undefined); });
  for (;;) { const next = await source.next(); if (next.done) throw new Error('MISSING_LEGACY_ROW'); if (next.value.kind === 'legacySource') break; }
  await mkdir(f.paths.directoryPath, { recursive: true, mode: 0o700 });
  await expect(source.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it.for(['lease', 'target', 'writers'] as const)('joins an original directory read and closes it after %s loss', async (kind, context) => {
  const f = await fixture(context); await f.publish(f.binding);
  let enter!: () => void, release!: () => void, settled = false;
  const closeCounts: number[] = [];
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const work = f.collect({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    const index = closeCounts.push(0) - 1;
    return { async read() { enter(); await pending; return directory.read(); },
      async close() { await directory.close(); closeCounts[index] = closeCounts[index]! + 1; } };
  } }).finally(() => { settled = true; });
  const expected = expect(work).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
  try {
    await entered;
    if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
    expect(settled).toBe(false);
    expect(closeCounts).toEqual([0]);
  } finally { release(); }
  await expected;
  expect(closeCounts.length).toBeGreaterThan(0);
  expect(closeCounts.every(count => count === 1)).toBe(true);
  if (kind !== 'target') expect(closeCounts).toEqual([1]);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it.for(['beforeObservation', 'afterObservation'] as const)(
  'stops the inspection uniqueness read at %s when writer closure is lost', async (phase, context) => {
    const f = await fixture(context), binding = await f.publish(remnantTestBinding('profileInspection'));
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
    let opened = 0, reads = 0, closed = 0, armed = false, settled = false;
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const source = observe(f.root, f.authority, { ...nativeReads, async openDirectory(path) {
      const directory = await nativeReads.openDirectory(path);
      if (path !== paths.directoryPath) return directory;
      opened++;
      // First open is the outer metadata reader; the next is the first uniqueness scan.
      const selected = phase === 'beforeObservation' ? opened === 2 : armed;
      if (!selected) return directory;
      return {
        async read() { reads++; if (reads === 1) { enter(); await pending; } return directory.read(); },
        async close() { await directory.close(); closed++; },
      };
    } });
    const work = (async () => {
      for await (const row of source) if (row.kind === 'metadataInspection') armed = true;
    })().finally(() => { settled = true; });
    context.onTestFinished(async () => { release(); await work.catch(() => undefined); });
    const expected = expect(work).rejects.toThrow('SYNTHETIC_WRITER_UNSETTLED');
    try { await entered; f.unsettled(); expect(settled).toBe(false); }
    finally { release(); }
    await expected;
    expect({ reads, closed }).toEqual({ reads: 1, closed: 1 });
    expect(await readFile(paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(binding));
  });
