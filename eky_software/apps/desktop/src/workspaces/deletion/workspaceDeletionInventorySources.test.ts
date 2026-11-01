import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id,
  deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import { deletionInventoryRecordKey, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionInventorySources as capture } from './workspaceDeletionInventorySources.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

async function fixture(context: TestContext) {
  const f = await remnantBindingFixture(context);
  const workspace = deriveWorkspaceRoot(f.root, header.workspaceId, 1);
  const retained: string[] = [];
  let writersAbsent = true;
  const authority = { ...f.authority,
    assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); },
  };
  const payload = async (root: string) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, 'retained-payload');
    await writeFile(path, 'retained synthetic bytes', { mode: 0o600 }); retained.push(path);
  };
  await payload(workspace.workspaceRoot);
  const identity = nativeReads.directoryIdentity.bind(nativeReads);
  const rootIdentity = await identity(workspace.workspaceRoot, authority.assertAuthority);
  const publish = async (value: unknown) => {
    const binding = captureWorkspaceRemnantBinding(value);
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    retained.push(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath);
    return binding;
  };
  const inspection = async (number: number, location: number, foreign = false) => {
    const initial = captureWorkspaceRemnantBinding({ ...remnantTestBinding('profileInspection'), operationId: id(number),
      generationId: id(number + 1000), ...(foreign ? { workspaceId: id(99), lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } } : {}) });
    const paths = deriveWorkspaceInspectionRemnantPaths(f.root, initial)[location]!;
    await payload(paths.rootPath);
    return publish({ ...initial, rootIdentity: await identity(paths.rootPath, authority.assertAuthority),
      parentIdentity: await identity(paths.parentPath, authority.assertAuthority) });
  };
  const collect = async (source: AsyncIterable<WorkspaceDeletionInventoryRecord>) => {
    const work = (async () => { const rows = []; for await (const row of source) rows.push(row); return rows; })();
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    return work;
  };
  return { ...f, workspace, rootIdentity, authority, payload, publish, inspection, collect,
    capture: (reads = nativeReads) => {
      const work = capture(f.root, header, rootIdentity, authority, reads);
      context.onTestFinished(async () => { await work.catch(() => undefined); });
      return work;
    },
    unsettled() { writersAbsent = false; },
    async preserved() { return Promise.all(retained.map(path => readFile(path, 'hex'))); } };
}

it('binds the real workspace and parent without opening business data, and compares real inventory bytes', async context => {
  const f = await fixture(context), before = await f.preserved();
  let source!: Awaited<ReturnType<typeof f.capture>>;
  async function* records() {
    // The existing store prepares its own state directory before requesting any source rows.
    source = await f.capture();
    yield* source.records();
  }
  const store = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
  const published = await store.publish(header, records(), f.authority);
  expect(source.workspace).toMatchObject({ role: 'workspace', rootIdentity: f.rootIdentity,
    parentIdentity: await nativeReads.directoryIdentity(f.workspace.workspacesRoot, f.authority.assertAuthority) });
  await expect(store.assertRecords(published, source.records(), f.authority)).resolves.toBeUndefined();
  await source.assertUnchanged();
  expect(await f.preserved()).toEqual(before);
});

it.for([false, true])('proves the proposed final source comparison with a change during backup checking: %s', async (change, context) => {
  const f = await fixture(context), before = await f.preserved();
  let source!: Awaited<ReturnType<typeof f.capture>>;
  async function* records() { source = await f.capture(); yield* source.records(); }
  const inventory = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
  const selected = await inventory.publish(header, records(), f.authority);
  const journal = new WorkspaceDeletionJournalStore(f.root), paths = createWorkspaceDeletionJournalPaths(f.root);
  const observations: string[] = [];
  // Only this synthetic boundary uses the proposed sequence. No production publisher is enabled here.
  const work = journal.publish({ ...deletionTestJournal(), ...selected }, {
    slots: (await journal.inspect(f.authority.assertAuthority)).slots, ...f.authority,
  }, async () => {
    observations.push('initialSourceComparison');
    await inventory.assertRecords(selected, source.records(), f.authority);
    observations.push('simulatedBackupRead');
    if (change) await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(99)));
    observations.push('finalSourceComparison');
    await inventory.assertRecords(selected, source.records(), f.authority);
  });
  context.onTestFinished(async () => { await work.catch(() => undefined); });
  if (change) {
    await expect(work).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    await expect(readFile(paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(paths.nextPath)).not.toHaveLength(0);
    expect((await f.preserved()).slice(0, before.length)).toEqual(before);
  } else {
    await work;
    expect((await journal.inspect(f.authority.assertAuthority)).plan.mode).toBe('published');
    expect(await f.preserved()).toEqual(before);
  }
  expect(observations).toEqual(['initialSourceComparison', 'simulatedBackupRead', 'finalSourceComparison']);
});

it('projects all ten roles once, excludes foreign sources, and preserves every source byte', { timeout: 20_000 }, async context => {
  const f = await fixture(context), parents = deriveWorkspaceReplacementRemnantParents(f.root);
  const replacement = await f.publish(remnantTestBinding());
  for (const parent of parents) await f.payload(join(parent.parentPath, replacement.operationId));
  const migration = await f.publish({ ...remnantTestBinding('workspaceActivationMigration'), operationId: id(10) });
  await f.payload(join(parents[1]!.parentPath, migration.operationId));
  for (const [owner, number] of [['workspaceImport', 20], ['workspaceLegacyAdoption', 30]] as const) {
    const binding = await f.publish({ ...remnantTestBinding(owner), operationId: id(number) });
    await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot);
  }
  const legacy = join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames[0]!);
  await mkdir(dirname(legacy), { recursive: true, mode: 0o700 });
  await writeFile(legacy, 'retained legacy bytes', { mode: 0o600 });
  await f.inspection(40, 0); await f.inspection(41, 2);
  const foreign = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(50), workspaceId: id(99),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } });
  await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(foreign.operationId), foreign.workspaceId).candidateRoot);
  await f.inspection(51, 3, true);
  const before = await f.preserved(), source = await f.capture(), rows = await f.collect(source.records());
  expect(rows.map(row => row.role)).toEqual(['activationFailed', 'activationRollback', 'activationStaging', 'activationStaging',
    'adoptionCandidate', 'importCandidate', 'inspection', 'inspectionEvidence', 'legacyEntry', 'replacementImport', 'workspace']);
  expect(rows.map(deletionInventoryRecordKey)).toEqual([...rows.map(deletionInventoryRecordKey)].sort());
  expect(rows.some(row => row.ownerOperationId === foreign.operationId || row.ownerOperationId === id(51))).toBe(false);
  expect(rows.find(row => row.role === 'replacementImport')?.bindingSha256).toBe(workspaceRemnantBindingSha256(replacement));
  expect(await f.preserved()).toEqual(before);
  expect(await readFile(legacy, 'utf8')).toBe('retained legacy bytes');
});

it.for(workspaceRemnantBindingOwners)('refuses payloadless target %s metadata until its owner clears it', async (owner, context) => {
  const f = await fixture(context);
  await f.publish(remnantTestBinding(owner));
  const before = await f.preserved();
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});

it('does not clear or include a foreign payloadless owner', async context => {
  const f = await fixture(context);
  await f.publish({ ...remnantTestBinding('workspaceImport'), workspaceId: id(99) });
  const before = await f.preserved(), source = await f.capture();
  expect(await f.collect(source.records())).toEqual([source.workspace]);
  expect(await f.preserved()).toEqual(before);
});

it('rejects a binding with the target workspace id but a different lineage', async context => {
  const f = await fixture(context), parent = deriveWorkspaceReplacementRemnantParents(f.root)[1]!;
  const binding = await f.publish({ ...remnantTestBinding(), lineageIdentity: { formatVersion: 1, profileId: hash('different') } });
  await f.payload(join(parent.parentPath, binding.operationId));
  const before = await f.preserved();
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});

it('rejects an unowned actual payload even though no metadata row would project it', async context => {
  const f = await fixture(context), source = await f.capture();
  await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, id(99)));
  const before = await f.preserved();
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});

it.for([0, 1])('observes internal inspection location %s independently of its missing metadata', async (location, context) => {
  const f = await fixture(context);
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, remnantTestBinding('profileInspection'))[location]!;
  await mkdir(paths.parentPath, { recursive: true, mode: 0o700 });
  const source = await f.capture();
  await f.payload(paths.rootPath);
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(paths.rootPath, 'retained-payload'), 'utf8')).toBe('retained synthetic bytes');
  await expect(f.capture()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
});

it('pins internal inspection parents without classifying ordinary workspace content as an inspection', async context => {
  const f = await fixture(context);
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, remnantTestBinding('profileInspection'))[0]!;
  await f.payload(join(paths.parentPath, id(20)));
  const source = await f.capture();
  expect(await f.collect(source.records())).toEqual([source.workspace]);
  await rename(paths.parentPath, join(f.root, 'retained-inspection-parent'));
  await mkdir(paths.parentPath, { mode: 0o700 });
  await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(f.root, 'retained-inspection-parent', id(20), 'retained-payload'), 'utf8')).toBe('retained synthetic bytes');
});

it.for(['root', 'parent'] as const)('pins the real %s identity rather than its pathname', async (kind, context) => {
  const f = await fixture(context), source = await f.capture();
  if (kind === 'root') {
    await rename(f.workspace.workspaceRoot, join(f.root, 'retained-original'));
    await f.payload(f.workspace.workspaceRoot);
  } else {
    await rename(f.workspace.workspacesRoot, join(f.root, 'retained-parent'));
    await mkdir(f.workspace.workspacesRoot, { mode: 0o700 });
    await rename(join(f.root, 'retained-parent', header.workspaceId), f.workspace.workspaceRoot);
  }
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(f.workspace.workspaceRoot, 'retained-payload'), 'utf8')).toBe('retained synthetic bytes');
});

it('rejects the wrong workspace identity before scanning metadata', async context => {
  const f = await fixture(context);
  let scans = 0;
  await expect(capture(f.root, header, hash('wrong'), f.authority, { ...nativeReads,
    async openDirectory(path) { scans++; return nativeReads.openDirectory(path); },
  })).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(scans).toBe(0);
});

it('rejects new foreign metadata behind the source cursor at final comparison', async context => {
  const f = await fixture(context), source = await f.capture(), rows = source.records();
  const first = await rows.next();
  expect(first.value).toEqual(source.workspace);
  const foreign = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(99), workspaceId: id(98) });
  const before = await f.preserved();
  await expect(rows.next()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
  expect(foreign.workspaceId).toBe(id(98));
});

it('retains a changed raw side slot after its output row has already been observed', async context => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding());
  await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
  const source = await f.capture(), rows = source.records();
  expect((await rows.next()).done).toBe(false);
  const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
  await writeFile(paths.nextPath, serializeWorkspaceRemnantBinding(binding), { mode: 0o600 });
  await expect(f.collect(rows)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(paths.nextPath)).toEqual(serializeWorkspaceRemnantBinding(binding));
});

it.for(['lease', 'target', 'writers'] as const)('rejects %s loss and never writes a source file', async (kind, context) => {
  const f = await fixture(context), source = await f.capture();
  if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
  const before = await f.preserved();
  await expect(f.collect(source.records())).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
    : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED');
  expect(await f.preserved()).toEqual(before);
});

it('invalidates an abandoned partial source instead of silently starting it again', async context => {
  const f = await fixture(context), source = await f.capture(), rows = source.records();
  expect((await rows.next()).done).toBe(false);
  await rows.return(undefined);
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readdir(f.workspace.workspaceRoot)).toEqual(['retained-payload']);
});

it('uses the captured page once and rereads the entire source on the next consumption', async context => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding());
  await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
  let opened = 0;
  const source = await f.capture({ ...nativeReads, async openDirectory(path) {
    opened++; return nativeReads.openDirectory(path);
  } });
  const initialReads = opened;
  const first = await f.collect(source.records());
  expect(initialReads).toBeGreaterThan(0);
  expect(opened).toBe(initialReads * 2);
  expect(await f.collect(source.records())).toEqual(first);
  expect(opened).toBe(initialReads * 4);
});

it('rejects changed binding bytes after capture even before the captured page is consumed', async context => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding());
  await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
  const source = await f.capture(), path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath;
  const changed = ` ${serializeWorkspaceRemnantBinding(binding).toString('utf8')}`;
  await writeFile(path, changed, { mode: 0o600 });
  await expect(f.collect(source.records())).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(path, 'utf8')).toBe(changed);
});

it('orders more than one page from real owners without dropping or repeating a root', { timeout: 30_000 }, async context => {
  const f = await fixture(context), parents = deriveWorkspaceReplacementRemnantParents(f.root);
  const operations = Math.floor(workspaceDeletionDirectoryEntryPageSize / parents.length) + 1;
  const expected: string[] = [];
  for (let number = operations; number > 0; number--) {
    const binding = await f.publish({ ...remnantTestBinding(), operationId: id(100 + number) });
    for (const parent of parents) {
      await f.payload(join(parent.parentPath, binding.operationId));
      expected.push(`${parent.role}:${binding.operationId}`);
    }
  }
  const before = await f.preserved(), source = await f.capture(), rows = await f.collect(source.records());
  expect(rows.length).toBeGreaterThan(workspaceDeletionDirectoryEntryPageSize);
  expect(rows.filter(row => row.role !== 'workspace').map(row => `${row.role}:${row.ownerOperationId}`)).toEqual(expected.sort());
  expect(rows.at(-1)).toEqual(source.workspace);
  expect(new Set(rows.map(deletionInventoryRecordKey)).size).toBe(rows.length);
  expect(await f.preserved()).toEqual(before);
});

it.for(['lease', 'target', 'writers'] as const)(
  'joins an inventory source read before returning after %s loss', async (kind, context) => {
    const f = await fixture(context), binding = await f.publish(remnantTestBinding());
    await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
    let armed = false, enter!: () => void, release!: () => void;
    let opened = 0, closed = 0, settled = false;
    const reached = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const source = await f.capture({ ...nativeReads, async openDirectory(path) {
      const directory = await nativeReads.openDirectory(path);
      if (!armed) return directory;
      opened++;
      return { async read() { enter(); await pending; return directory.read(); },
        async close() { await directory.close(); closed++; } };
    } });
    armed = true;
    const before = await f.preserved();
    const work = f.collect(source.records()).then(() => undefined, error => error).finally(() => { settled = true; });
    try {
      await Promise.race([reached, work]);
      expect(opened).toBe(1);
      if (kind === 'lease') f.expire(); else if (kind === 'target') f.changeTarget(); else f.unsettled();
      expect(settled).toBe(false);
      expect(closed).toBe(0);
    } finally { release(); await work; }
    expect(await work).toMatchObject({ message: kind === 'lease' ? 'SYNTHETIC_LEASE_LOST'
      : kind === 'target' ? 'SYNTHETIC_TARGET_CHANGED' : 'SYNTHETIC_WRITER_UNSETTLED' });
    expect(closed).toBe(opened);
    await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await f.preserved()).toEqual(before);
  });

it('keeps the source read failure ahead of a pending close failure and never returns early', async context => {
  const f = await fixture(context), binding = await f.publish(remnantTestBinding());
  await f.payload(join(deriveWorkspaceReplacementRemnantParents(f.root)[1]!.parentPath, binding.operationId));
  let armed = false, enter!: () => void, release!: () => void, settled = false, closed = 0;
  const reached = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = new Error('SYNTHETIC_SOURCE_READ_FAILED'), closing = new Error('SYNTHETIC_SOURCE_CLOSE_FAILED');
  const source = await f.capture({ ...nativeReads, async openDirectory(path) {
    const directory = await nativeReads.openDirectory(path);
    if (!armed) return directory;
    return { async read() { throw first; }, async close() {
      enter(); await pending; await directory.close(); closed++; throw closing;
    } };
  } });
  const before = await f.preserved();
  armed = true;
  const work = f.collect(source.records()).then(() => undefined, error => error).finally(() => { settled = true; });
  try { await Promise.race([reached, work]); expect(settled).toBe(false); expect(closed).toBe(0); }
  finally { release(); await work; }
  expect(await work).toBeInstanceOf(AggregateError);
  expect((await work as AggregateError).errors).toEqual([first, closing]);
  expect(closed).toBe(1);
  await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.preserved()).toEqual(before);
});
