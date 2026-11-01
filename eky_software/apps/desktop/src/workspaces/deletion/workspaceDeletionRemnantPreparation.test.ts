import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import * as cleanup from './workspaceDeletionBindingCleanup.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionDirectoryEntryPageSize } from './workspaceDeletionDirectoryEntries.js';
import * as census from './workspaceDeletionRemnantCensus.js';
import { prepareWorkspaceDeletionRemnantBindings as prepare } from './workspaceDeletionRemnantCensusSelection.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
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
  return { ...f, authority, run, publish, intercept, originalClear, restores };
}

it('finishes an empty complete census without preparing directories or granting deletion', async context => {
  const f = await fixture(context), selected = await f.run();
  await selected.assertUnchanged();
  expect(Object.keys(selected)).toEqual(['assertUnchanged']);
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
