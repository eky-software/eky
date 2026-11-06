import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES } from '../import/workspaceBackupImportJournalValidation.js';
import { createImportedWorkspaceEntry, publishImportedWorkspaceEntry } from '../import/workspaceBackupImportRegistry.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import * as cleanup from './workspaceDeletionBindingCleanup.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import * as census from './workspaceDeletionRemnantCensus.js';
import { workspaceDeletionRemnantReads as nativeCensusReads } from './workspaceDeletionRemnantCensus.js';
import { prepareWorkspaceDeletionRemnantBindings as prepare } from './workspaceDeletionRemnantCensusSelection.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord, deletionInventoryRecordKey,
  type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionInventorySources } from './workspaceDeletionInventorySources.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionOriginalJournals } from './workspaceDeletionOriginalJournalSelection.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners, workspaceRemnantBindingSha256, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext, owner: WorkspaceRemnantBindingV1['owner'] = 'workspaceImport') {
  const f = await remnantBindingFixture(context, owner);
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() {} };
  const work: Promise<unknown>[] = [];
  const restores: (() => void)[] = [];
  context.onTestFinished(async () => {
    try { for (const pending of work) await pending.catch(() => undefined); }
    finally { for (const restore of restores) restore(); }
  });
  const run = () => { const pending = prepare(f.root, header, authority); work.push(pending); return pending; };
  const publish = async (value: unknown = f.binding) => {
    const binding = captureWorkspaceRemnantBinding(value);
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    return createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
  };
  const originalClear = cleanup.clearAbsentWorkspaceDeletionBinding;
  const intercept = (callback: (...args: Parameters<typeof originalClear>) => ReturnType<typeof originalClear>) => {
    const spy = vi.spyOn(cleanup, 'clearAbsentWorkspaceDeletionBinding').mockImplementation(callback);
    restores.push(() => spy.mockRestore()); return spy;
  };
  return { ...f, authority, run, publish, intercept, originalClear, restores,
    track<T>(pending: Promise<T>) { work.push(pending); return pending; } };
}

async function originalJournalFixture(context: TestContext) {
  const f = await fixture(context);
  return f.track((async () => {
    await f.publish();
    const importPath = join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
    const imported = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: importPath });
    const paths = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId);
    await mkdir(paths.candidateRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(paths.candidateRoot, 'retained-business'), 'synthetic imported company', { flag: 'wx', mode: 0o600 });
    const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: join(f.root, WORKSPACE_REGISTRY_FILE_NAME) });
    const createdAt = '2026-11-02T00:00:00.000Z';
    const entry = createImportedWorkspaceEntry({ workspaceId: f.binding.workspaceId, workspaceLabel: 'Synthetic original cut',
      lineageIdentity: f.binding.lineageIdentity, createdAt });
    const initial = { formatVersion: 2 as const, activeWorkspaceId: null, workspaces: [] };
    await registry.write(initial);
    for (const state of WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES) {
      f.authority.assertAuthority();
      if (state === 'registryPublished') break;
      if (state === 'rootPublished') {
        await mkdir(paths.workspacesRoot, { recursive: true, mode: 0o700 }); await rename(paths.candidateRoot, paths.finalRoot);
      }
      await imported.write({ formatVersion: 2, operationId: f.binding.operationId, workspaceId: f.binding.workspaceId,
        workspaceLabel: entry.workspaceLabel, previousActiveWorkspaceId: null, createdAt, state,
        lineageIdentity: ['candidateValidated', 'rootPublished'].includes(state) ? f.binding.lineageIdentity : null });
    }
    await registry.write(publishImportedWorkspaceEntry(initial, entry));
    const target = captureDeletionInventoryHeader({ ...header, registryEntrySha256: workspaceRegistryEntrySha256(entry) });
    const original = await captureWorkspaceDeletionOriginalJournals(f.root, target, f.authority);
    f.restores.push(() => original.revoke());
    const journalBytes = await readFile(importPath), bindingBytes = await readFile(f.paths.currentPath);
    return { ...f, target, original, importPath, importPaths: paths, registry, entry,
      runOriginal() { return f.track(prepare(f.root, target, f.authority, undefined, original)); },
      async preserved() {
        expect(await readFile(importPath)).toEqual(journalBytes); expect(await readFile(f.paths.currentPath)).toEqual(bindingBytes);
        expect(await readFile(join(paths.finalRoot, 'retained-business'), 'utf8')).toBe('synthetic imported company');
      },
    };
  })());
}

async function originalPublicationFixture(context: TestContext) {
  const f = await originalJournalFixture(context);
  return f.track((async () => {
    const selected = await captureDeletionTarget({ installationRoot: f.root, workspaceId: f.binding.workspaceId,
      typedLabel: f.entry.workspaceLabel, registry: f.registry, assertAuthority: f.authority.assertAuthority });
    const publication = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
      assertWritersAbsent: f.authority.assertWritersAbsent });
    const backup = vi.fn(async () => {});
    const context = Object.freeze({ operationId: id(250), target: selected.target, backupDisposition: 'explicitDataLoss' as const });
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), registryBytes = await readFile(registryPath);
    return { ...f, backup, selected, journalPaths: createWorkspaceDeletionJournalPaths(f.root),
      start() { return f.track(publication(f.authority.assertAuthority, backup, selected.target, context, selected.assertCurrent)); },
      async preservedPublication() { await f.preserved(); expect(await readFile(registryPath)).toEqual(registryBytes); },
    };
  })());
}

it('publishes selected original proof through all three comparisons without a physical metadata row', { timeout: 10_000 }, async context => {
  const f = await originalPublicationFixture(context);
  await f.track((async () => {
    const events: string[] = [], compare = WorkspaceDeletionInventoryStore.prototype.assertRecords;
    const spy = vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
      await compare.apply(this, args); events.push('sources');
    });
    f.restores.push(() => spy.mockRestore());
    f.backup.mockImplementation(async () => { events.push('backup'); });
    const result = await f.start();
    expect(events).toEqual(['sources', 'backup', 'sources', 'sources']);
    expect(result.journal).toMatchObject({ formatVersion: 2, phase: 'authorized', originalJournalProofs: f.original.proofs });
    expect(result.journal.inventory.recordCount).toBe(1);
    const rows: WorkspaceDeletionInventoryRecord[] = [];
    const inventory = new WorkspaceDeletionInventoryStore(f.root, id(250));
    const selection = { target: result.journal.target, inventory: result.journal.inventory,
      inventoryFileIdentity: result.journal.inventoryFileIdentity, operationRootIdentity: result.journal.operationRootIdentity,
      operationParentIdentity: result.journal.operationParentIdentity };
    await inventory.consumeSelectedRecords(selection, f.authority, async row => { rows.push(row); });
    expect(rows.map(row => row.role)).toEqual(['workspace']);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(serializeWorkspaceDeletionJournal(result.journal));
    await expect(readFile(f.journalPaths.nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(f.journalPaths.backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.preservedPublication();
  })());
});

it.for(['original', 'foreign'] as const)('retains initial-next when selected %s changes during the backup read', { timeout: 10_000 }, async (changed, context) => {
  const f = await originalPublicationFixture(context);
  await f.track((async () => {
    const foreign = await f.publish({ ...f.binding, operationId: id(91), workspaceId: id(92) });
    const foreignBytes = await readFile(foreign.currentPath);
    f.backup.mockImplementation(async () => {
      if (changed === 'foreign') await writeFile(foreign.nextPath, foreignBytes, { flag: 'wx', mode: 0o600 });
      else {
        await rename(f.importPath, join(f.root, 'retained-original-import'));
        await writeFile(f.importPath, await readFile(join(f.root, 'retained-original-import')), { flag: 'wx', mode: 0o600 });
      }
    });
    await expect(f.start()).rejects.toThrow(); expect(f.backup).toHaveBeenCalledOnce();
    await expect(readFile(f.journalPaths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const next = await readFile(f.journalPaths.nextPath);
    expect(JSON.parse(next.toString('utf8'))).toMatchObject({ formatVersion: 2, originalJournalProofs: f.original.proofs });
    expect(await readFile(foreign.currentPath)).toEqual(foreignBytes);
    if (changed === 'foreign') expect(await readFile(foreign.nextPath)).toEqual(foreignBytes);
    else expect(await readFile(join(f.root, 'retained-original-import'))).toEqual(await readFile(f.importPath));
    await f.preservedPublication();
  })());
});

it('rejects a selected original replacement after publication and retains committed-current', { timeout: 10_000 }, async context => {
  const f = await originalPublicationFixture(context);
  await f.track((async () => {
    const publish = WorkspaceDeletionJournalStore.prototype.publish;
    const spy = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
      const identity = await publish.apply(this, args);
      await rename(f.importPath, join(f.root, 'retained-original-import'));
      await writeFile(f.importPath, await readFile(join(f.root, 'retained-original-import')), { flag: 'wx', mode: 0o600 });
      return identity;
    });
    f.restores.push(() => spy.mockRestore());
    await expect(f.start()).rejects.toThrow();
    const observed = await new WorkspaceDeletionJournalStore(f.root).inspect(f.authority.assertAuthority);
    expect(observed.plan.mode).toBe('published');
    expect(observed.slots.current?.value).toMatchObject({ formatVersion: 2, originalJournalProofs: f.original.proofs });
    expect(observed.slots.next).toBeUndefined(); expect(observed.slots.backup).toBeUndefined();
    expect(await readFile(join(f.root, 'retained-original-import'))).toEqual(await readFile(f.importPath));
    await f.preservedPublication();
  })());
});

it('rejects an original change after inventory publication before writing initial-next', async context => {
  const f = await originalPublicationFixture(context);
  await f.track((async () => {
    const publish = WorkspaceDeletionInventoryStore.prototype.publish;
    let inventoryBytes: Buffer | undefined, inventoryPath: string | undefined;
    let currentIdentity: number[] | undefined, retainedIdentity: number[] | undefined;
    const identity = async (path: string) => {
      const value = await lstat(path); return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs];
    };
    const spy = vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'publish').mockImplementationOnce(async function (this: WorkspaceDeletionInventoryStore, ...args) {
      const result = await publish.apply(this, args);
      inventoryPath = createWorkspaceDeletionInventoryPaths(f.root, id(250)).currentPath;
      inventoryBytes = await readFile(inventoryPath);
      await rename(f.importPath, join(f.root, 'retained-original-import'));
      await writeFile(f.importPath, await readFile(join(f.root, 'retained-original-import')), { flag: 'wx', mode: 0o600 });
      currentIdentity = await identity(f.importPath); retainedIdentity = await identity(join(f.root, 'retained-original-import'));
      return result;
    });
    f.restores.push(() => spy.mockRestore());
    await expect(f.start()).rejects.toThrow();
    expect(f.backup).not.toHaveBeenCalled(); expect(inventoryPath).toBeDefined(); expect(inventoryBytes).toBeDefined();
    expect(await readFile(inventoryPath!)).toEqual(inventoryBytes);
    for (const path of [f.journalPaths.currentPath, f.journalPaths.nextPath, f.journalPaths.backupPath]) {
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(join(f.root, 'retained-original-import'))).toEqual(await readFile(f.importPath));
    expect(await identity(f.importPath)).toEqual(currentIdentity);
    expect(await identity(join(f.root, 'retained-original-import'))).toEqual(retainedIdentity);
    await f.preservedPublication();
  })());
});

it.for([false, true])('keeps retained metadata in every controlled inventory rescan: changed=%s', async (changed, context) => {
  const f = await originalJournalFixture(context);
  await f.track((async () => {
    type Row = ReturnType<typeof census.observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer R> ? R : never;
    const nativeRows: Row[] = [];
    for await (const row of census.observeWorkspaceDeletionRemnants(f.root, f.authority, undefined, f.binding.workspaceId)) nativeRows.push(row);
    const retainedIndex = nativeRows.findIndex(row => row.kind === 'metadataCandidate' && row.observation.binding.value.operationId === f.binding.operationId);
    const retained = nativeRows[retainedIndex];
    if (retained?.kind !== 'metadataCandidate' || retained.observation.binding.slots.current?.identity === undefined) throw new Error('SYNTHETIC_MISSING_ORIGINAL');
    const identity = retained.observation.binding.slots.current.identity;
    // The extra rows control page projection only; their ownership is not a native fixture claim.
    const syntheticRows: Row[] = [], expected: WorkspaceDeletionInventoryRecord[] = [];
    for (let index = 0; index <= workspaceDeletionDirectoryEntryPageSize; index++) {
      const binding = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(300 + index) });
      const digest = workspaceRemnantBindingSha256(binding), bytes = serializeWorkspaceRemnantBinding(binding);
      const paths = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId);
      const rootIdentity = hash(`controlled-root-${index}`), parentIdentity = hash(`controlled-parent-${index}`);
      const slots = { current: { bytes, value: binding, identity: { ...identity, size: bytes.byteLength } }, next: undefined, backup: undefined };
      syntheticRows.unshift({ ...retained, hasPayload: true,
        observation: { ...retained.observation, key: workspaceRemnantBindingKey(binding), binding: { ...retained.observation.binding, value: binding, bindingSha256: digest, slots } },
        selection: { ...retained.selection, binding, bindingSha256: digest, role: 'importCandidate', rootPath: paths.candidateRoot,
          parentPath: paths.operationRoot, rootIdentity, parentIdentity } });
      expected.push(captureDeletionInventoryRecord({ role: 'importCandidate', ownerOperationId: binding.operationId,
        generationId: null, member: null, bindingSha256: digest, rootIdentity, parentIdentity }));
    }
    let scans = 0, open = 0, retainedVisits = 0;
    const spy = vi.spyOn(census, 'observeWorkspaceDeletionRemnants').mockImplementation(async function* () {
      scans++; open++;
      try { for (let index = 0; index < nativeRows.length; index++) { if (index === retainedIndex) retainedVisits++; yield nativeRows[index]!; } yield* syntheticRows; }
      finally { open--; }
    });
    f.restores.push(() => spy.mockRestore());
    const rootIdentity = await census.workspaceDeletionRemnantReads.directoryIdentity(f.importPaths.finalRoot, f.authority.assertAuthority);
    if (rootIdentity === null) throw new Error('SYNTHETIC_MISSING_WORKSPACE');
    const source = await captureWorkspaceDeletionInventorySources(f.root, f.target, rootIdentity, f.authority, undefined, f.original);
    const emitted: WorkspaceDeletionInventoryRecord[] = [];
    const consume = (async () => {
      for await (const row of source.records()) {
        emitted.push(row);
        if (changed && emitted.length === workspaceDeletionDirectoryEntryPageSize) {
          const current = retained.observation.binding.slots.current!;
          const bytes = Buffer.concat([Buffer.from(current.bytes), Buffer.from(' ')]);
          nativeRows[retainedIndex] = { ...retained, observation: { ...retained.observation, binding: { ...retained.observation.binding,
            slots: { ...retained.observation.binding.slots, current: { ...current, bytes, identity: { ...identity, size: bytes.byteLength } } } } } };
        }
      }
    })();
    if (changed) await expect(consume).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    else {
      await consume;
      const wanted = [...expected, source.workspace].sort((a, b) => deletionInventoryRecordKey(a) < deletionInventoryRecordKey(b) ? -1 : 1);
      expect(emitted).toEqual(wanted); expect(emitted).toHaveLength(66);
      expect(new Set(emitted.map(deletionInventoryRecordKey)).size).toBe(66);
      expect(emitted.some(row => row.ownerOperationId === f.binding.operationId)).toBe(false);
      expect(scans).toBe(3); await source.assertUnchanged(); expect(scans).toBe(4);
    }
    expect(scans).toBeGreaterThanOrEqual(3); expect(retainedVisits).toBe(scans); expect(open).toBe(0); await f.preserved();
  })());
});

it('retains a selected published-import binding while acknowledging only an unrelated orphan', async context => {
  const f = await originalJournalFixture(context);
  await f.track((async () => {
    const extra = await f.publish({ ...f.binding, operationId: id(90) });
    const foreign = await f.publish({ ...f.binding, operationId: id(91), workspaceId: id(92) });
    const foreignBytes = await readFile(foreign.currentPath), clear = f.intercept(f.originalClear);
    const selected = await f.runOriginal();
    expect(clear).toHaveBeenCalledOnce(); expect(captureWorkspaceRemnantBinding(clear.mock.calls[0]![2]).operationId).toBe(id(90));
    await expect(readFile(extra.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.track(selected.assertUnchanged()); await f.preserved(); expect(await readFile(foreign.currentPath)).toEqual(foreignBytes);
  })());
});

it.for(['binding', 'original'] as const)('rejects a late selected %s replacement before orphan cleanup', async (changed, context) => {
  const f = await originalJournalFixture(context);
  await f.track((async () => {
    const extra = await f.publish({ ...f.binding, operationId: id(90) });
    f.intercept(async (...args) => {
      const path = changed === 'binding' ? f.paths.currentPath : f.importPath;
      const bytes = await readFile(path); await rename(path, join(f.root, `retained-${changed}`));
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); return f.originalClear(...args);
    });
    await expect(f.runOriginal()).rejects.toThrow(); expect(await readFile(extra.currentPath)).toBeDefined(); await f.preserved();
  })());
});

it.for(['original', 'foreign'] as const)('includes a late %s source change in the prepared receipt', async (changed, context) => {
  const f = await originalJournalFixture(context);
  await f.track((async () => {
    const foreign = await f.publish({ ...f.binding, operationId: id(91), workspaceId: id(92) });
    const selected = await f.runOriginal();
    if (changed === 'original') {
      const bytes = await readFile(f.importPath); await rename(f.importPath, join(f.root, 'retained-import'));
      await writeFile(f.importPath, bytes, { flag: 'wx', mode: 0o600 });
    } else await writeFile(foreign.nextPath, await readFile(foreign.currentPath), { flag: 'wx', mode: 0o600 });
    await expect(f.track(selected.assertUnchanged())).rejects.toThrow(); await f.preserved();
  })());
});

it('rejects an original selection from another root or target before clearing any metadata', async context => {
  const f = await originalJournalFixture(context), other = await fixture(context);
  await f.track((async () => {
    const clear = f.intercept(f.originalClear);
    await expect(prepare(other.root, f.target, other.authority, undefined, f.original)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    await expect(prepare(f.root, { ...f.target, registryEntrySha256: hash('other') }, f.authority, undefined, f.original)).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(clear).not.toHaveBeenCalled(); await f.preserved();
  })());
});

it('finishes an empty complete census without preparing directories or granting deletion', async context => {
  const f = await fixture(context), selected = await f.run();
  await selected.assertUnchanged();
  expect(Object.keys(selected)).toEqual(['assertUnchanged', 'captureInventoryCensus']);
  expect(await readdir(f.root)).toEqual([]);
});

it.for(workspaceRemnantBindingOwners)('acknowledges exact payloadless %s slots and preserves every foreign slot', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  const foreign = await f.publish({ ...f.binding, operationId: id(99), workspaceId: id(98),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign') },
    ...(owner === 'profileInspection' ? { generationId: id(97) } : {}) });
  const bytes = await readFile(foreign.currentPath);
  await writeFile(foreign.nextPath, bytes, { mode: 0o600 });
  const selected = await f.run();
  await expect(readFile(f.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(f.paths.backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(foreign.currentPath)).toEqual(bytes);
  expect(await readFile(foreign.nextPath)).toEqual(bytes);
  await selected.assertUnchanged();
});

it('keeps owned live payload and its binding while clearing a different payloadless binding', async context => {
  const f = await fixture(context); await f.publish();
  const live = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(20) });
  const paths = await f.publish(live);
  const payload = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(live.operationId), live.workspaceId).candidateRoot;
  await mkdir(payload, { recursive: true, mode: 0o700 });
  await writeFile(join(payload, 'retained'), 'retained payload', { mode: 0o600 });
  const selected = await f.run();
  expect(await readFile(paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(live));
  expect(await readFile(join(payload, 'retained'), 'utf8')).toBe('retained payload');
  await selected.assertUnchanged();
});

it.for(['unknownPayload', 'wrongLineage', 'nextOnly'] as const)('rejects %s before any metadata cleanup', async (kind, context) => {
  const f = await fixture(context); await f.publish();
  if (kind === 'unknownPayload') {
    const path = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(id(20)), header.workspaceId).candidateRoot;
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, 'retained'), 'unknown payload', { mode: 0o600 });
  } else if (kind === 'wrongLineage') await f.publish({ ...f.binding, operationId: id(20),
    lineageIdentity: { formatVersion: 1, profileId: hash('wrong') } });
  else await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  if (kind === 'nextOnly') await rename(f.paths.currentPath, join(f.root, 'retained-current'));
  const before = await f.snapshot(), clear = f.intercept(f.originalClear);
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(clear).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it.for(workspaceRemnantBindingOwners)('does not adopt replaced %s slots between census and cleanup', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  const bytes = await readFile(f.paths.currentPath);
  f.intercept(async (...args) => {
    await rename(f.paths.currentPath, join(f.root, 'retained-original'));
    await writeFile(f.paths.currentPath, bytes, { mode: 0o600 });
    return f.originalClear(...args);
  });
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(bytes);
  expect(await readFile(join(f.root, 'retained-original'))).toEqual(bytes);
});

it.for(['foreignSlot', 'newTarget', 'unknownPayload', 'emptyParent'] as const)(
  'rejects %s after acknowledged cleanup instead of capturing it as a new baseline', async (kind, context) => {
    const f = await fixture(context); await f.publish();
    const foreign = await f.publish({ ...f.binding, operationId: id(99), workspaceId: id(98) });
    const bytes = await readFile(foreign.currentPath);
    const clear = f.intercept(async (...args) => {
      await f.originalClear(...args);
      if (kind === 'foreignSlot') await writeFile(foreign.nextPath, bytes, { mode: 0o600 });
      else if (kind === 'newTarget') await f.publish({ ...f.binding, operationId: id(0) });
      else if (kind === 'emptyParent') {
        const path = createWorkspaceRemnantBindingPaths(f.root, { owner: 'workspaceReplacement', operationId: id(20) });
        await mkdir(path.directoryPath, { mode: 0o700 });
      } else {
        const path = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), header.workspaceId).candidateRoot;
        await mkdir(path, { recursive: true, mode: 0o700 });
      }
    });
    await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(clear).toHaveBeenCalledOnce();
    expect(await readFile(foreign.currentPath)).toEqual(bytes);
  });

it('does not replace a missing cleanup acknowledgement with a later absence observation', async context => {
  const f = await fixture(context); await f.publish();
  const first = new Error('SYNTHETIC_CLEANUP_ACK_LOST');
  const clear = f.intercept(async (...args) => { await f.originalClear(...args); throw first; });
  await expect(f.run()).rejects.toBe(first);
  expect(clear).toHaveBeenCalledOnce();
  await expect(readFile(f.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.for([0, 1])('rejects an internal inspection leaf recreated in location %s after its acknowledged cleanup', async (location, context) => {
  const f = await fixture(context, 'profileInspection'); await f.publish();
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[location]!;
  await mkdir(paths.parentPath, { recursive: true, mode: 0o700 });
  f.intercept(async (...args) => {
    await f.originalClear(...args);
    await mkdir(paths.rootPath, { mode: 0o700 });
    await writeFile(join(paths.rootPath, 'retained'), 'late synthetic copy', { mode: 0o600 });
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readFile(join(paths.rootPath, 'retained'), 'utf8')).toBe('late synthetic copy');
});

it.runIf(process.platform === 'win32').for([0, 1])('rejects an internal inspection case alias in location %s after cleanup', async (location, context) => {
  const f = await fixture(context, 'profileInspection'); await f.publish();
  const paths = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding)[location]!;
  await mkdir(paths.parentPath, { recursive: true, mode: 0o700 });
  const alias = join(paths.parentPath, basename(paths.rootPath).toUpperCase());
  f.intercept(async (...args) => { await f.originalClear(...args); await mkdir(alias, { mode: 0o700 }); });
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await readdir(paths.parentPath)).toContain(basename(alias));
});

it('settles more than one real metadata owner before capturing the unchanged remainder', async context => {
  const f = await fixture(context); await f.publish();
  const second = await f.publish({ ...f.binding, operationId: id(20) });
  const clear = f.intercept(f.originalClear);
  const selected = await f.run();
  expect(clear).toHaveBeenCalledTimes(2);
  await expect(readFile(f.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(second.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await selected.assertUnchanged();
});

it.for(['secondAck', 'lease'] as const)('does not continue the batch after %s loss', async (kind, context) => {
  const f = await fixture(context); await f.publish();
  const second = await f.publish({ ...f.binding, operationId: id(20) });
  const first = new Error('SYNTHETIC_SECOND_ACK_LOST');
  let count = 0;
  const clear = f.intercept(async (...args) => {
    count++;
    await f.originalClear(...args);
    if (kind === 'lease') f.expire();
    else if (count === 2) throw first;
  });
  await expect(f.run()).rejects.toThrow(kind === 'lease' ? 'SYNTHETIC_LEASE_LOST' : first.message);
  expect(clear).toHaveBeenCalledTimes(kind === 'lease' ? 1 : 2);
  if (kind === 'lease') expect(await readFile(second.currentPath)).toHaveLength(serializeWorkspaceRemnantBinding({ ...f.binding, operationId: id(20) }).length);
  else await expect(readFile(second.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retains a complete-census close failure and performs no cleanup', async context => {
  const f = await fixture(context); await f.publish();
  const original = census.observeWorkspaceDeletionRemnants, failure = new Error('SYNTHETIC_CENSUS_CLOSE_FAILED');
  const spy = vi.spyOn(census, 'observeWorkspaceDeletionRemnants').mockImplementation(async function* (...args) {
    yield* original(...args); throw failure;
  });
  f.restores.push(() => spy.mockRestore());
  const clear = f.intercept(f.originalClear);
  await expect(f.run()).rejects.toBe(failure);
  expect(clear).not.toHaveBeenCalled();
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
});

it('bounds acknowledged batches without imposing an overall binding-count limit', async context => {
  const f = await fixture(context); await f.publish();
  type Row = ReturnType<typeof census.observeWorkspaceDeletionRemnants> extends AsyncGenerator<infer R> ? R : never;
  let template: Extract<Row, { kind: 'metadataCandidate' }> | undefined;
  for await (const row of census.observeWorkspaceDeletionRemnants(f.root, f.authority)) {
    if (row.kind === 'metadataCandidate') template = row;
  }
  if (template === undefined) throw new Error('SYNTHETIC_MISSING_TEMPLATE');
  const rows = Array.from({ length: workspaceDeletionDirectoryEntryPageSize + 1 }, (_, index) => {
    const binding = captureWorkspaceRemnantBinding({ ...template!.observation.binding.value, operationId: id(index + 1) });
    return { ...template!, observation: { ...template!.observation, key: workspaceRemnantBindingKey(binding),
      binding: { ...template!.observation.binding, value: binding } } };
  });
  const counts: number[] = [];
  let scanning = false;
  const spy = vi.spyOn(census, 'observeWorkspaceDeletionRemnants').mockImplementation(async function* (): ReturnType<typeof census.observeWorkspaceDeletionRemnants> {
    scanning = true; counts.push(rows.length);
    try { for (const row of rows) yield row; } finally { scanning = false; }
    return undefined;
  });
  f.restores.push(() => spy.mockRestore());
  const clear = f.intercept(async (_root, _target, value, _authority, dependencies) => {
    expect(scanning).toBe(false);
    const binding = captureWorkspaceRemnantBinding(value);
    expect(dependencies?.expectedOwnerSlots).toBe(rows[0]!.observation.binding.slots);
    expect(binding.operationId).toBe(rows[0]!.observation.binding.value.operationId);
    rows.shift();
  });
  await f.run();
  expect(clear).toHaveBeenCalledTimes(workspaceDeletionDirectoryEntryPageSize + 1);
  expect(counts).toEqual([65, 65, 1, 1, 0, 0]);
});

it("prepared source preserves original bookends without wrapping later EOF twice", async (context) => {
    const f = await originalJournalFixture(context), events: string[] = [];
    const originals = Object.freeze({ ...f.original, async assertSelected() { events.push("original"); await f.original.assertSelected(); } });
    const prepared = await f.track(prepare(f.root, f.target, f.authority, nativeCensusReads, originals));
    const rootIdentity = await nativeCensusReads.directoryIdentity(f.importPaths.finalRoot, f.authority.assertAuthority);
    const originalRead = census.observeWorkspaceDeletionRemnants;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (...args) {
        events.push("census.begin");
        yield* originalRead(...args);
        events.push("census.end");
    });
    f.restores.push(() => spy.mockRestore());
    events.length = 0;
    const source = await f.track(captureWorkspaceDeletionInventorySources(f.root, f.target, rootIdentity, f.authority, nativeCensusReads, originals, prepared));
    expect(events).toEqual(["original", "original", "census.begin", "census.end", "original", "original"]);
    for (let pass = 0; pass < 3; pass++) {
        events.length = 0;
        await f.track((async () => { for await (const _row of source.records()) { /* Read through the fresh EOF. */ } })());
        expect(events).toEqual(["original", "census.begin", "census.end", "original"]);
    }
    await f.preserved();
});
it.for(["revoked", "clone", "afterCensus"] as const)("prepared source rejects original selection %s at the handoff boundary", async (kind, context) => {
    const f = await originalJournalFixture(context);
    const prepared = await f.runOriginal();
    const rootIdentity = await nativeCensusReads.directoryIdentity(f.importPaths.finalRoot, f.authority.assertAuthority);
    let passes = 0;
    const originalRead = census.observeWorkspaceDeletionRemnants;
    const spy = vi.spyOn(census, "observeWorkspaceDeletionRemnants").mockImplementation(async function* (...args) {
        passes++;
        yield* originalRead(...args);
        if (kind === "afterCensus") {
            const bytes = await readFile(f.importPath);
            await rename(f.importPath, join(f.root, "retained-original"));
            await writeFile(f.importPath, bytes, { flag: "wx", mode: 0o600 });
        }
    });
    f.restores.push(() => spy.mockRestore());
    if (kind === "revoked")
        f.original.revoke();
    if (kind === "clone") {
        await expect(f.track(prepared.captureInventoryCensus({ userDataRoot: f.root, target: f.target,
            baseAuthority: f.authority, reads: nativeCensusReads, originals: { ...f.original } }, f.authority, () => { }))).rejects.toThrow();
    }
    else {
        await expect(f.track(captureWorkspaceDeletionInventorySources(f.root, f.target, rootIdentity, f.authority, nativeCensusReads, f.original, prepared))).rejects.toThrow();
    }
    expect(passes).toBe(kind === "afterCensus" ? 1 : 0);
    await f.preserved();
    if (kind === "afterCensus")
        expect(await readFile(join(f.root, "retained-original"))).toEqual(await readFile(f.importPath));
});
