import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { clearAbsentWorkspaceDeletionBinding as clear } from './workspaceDeletionBindingCleanup.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingOwners, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

const owners = workspaceRemnantBindingOwners.filter(owner => owner !== 'profileInspection');

async function fixture(context: TestContext, owner: WorkspaceRemnantBindingV1['owner'] = 'workspaceReplacement') {
  const f = await remnantBindingFixture(context, owner);
  let stopped = true;
  const authority = { ...f.authority, assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!stopped) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); } };
  const publish = async (value: unknown = f.binding) => {
    const binding = captureWorkspaceRemnantBinding(value);
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    return binding;
  };
  const roots = owner === 'workspaceReplacement' || owner === 'workspaceActivationMigration'
    ? deriveWorkspaceReplacementRemnantParents(f.root).map(parent => join(parent.parentPath, f.binding.operationId))
    : owner === 'profileInspection' ? deriveWorkspaceInspectionRemnantPaths(f.root, f.binding).map(path => path.rootPath)
      : [deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(f.binding.operationId), f.binding.workspaceId).candidateRoot];
  const payload = async (path: string) => {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, 'retained'), 'synthetic payload', { mode: 0o600 });
  };
  const run = (fileSystem = f.fileSystem, reads = nativeReads, target: unknown = header) => {
    const work = clear(f.root, target, f.binding, authority, { fileSystem, reads });
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    return work;
  };
  const atRemoval = (inject: () => Promise<void>): CrashSafeFileSlotFileSystem => {
    let injected = false;
    return {
      prepareDirectory: guard => f.fileSystem.prepareDirectory(guard),
      readSlot: (...args) => f.fileSystem.readSlot(...args),
      createNextWriter: guard => f.fileSystem.createNextWriter(guard),
      moveSlot: (...args) => f.fileSystem.moveSlot(...args),
      syncDirectory: guard => f.fileSystem.syncDirectory(guard),
      removeSlot: (slot, guard) => f.fileSystem.removeSlot(slot, {
        assertAuthority: () => guard!.assertAuthority(), async beforeMutation() {
          if (!injected) { injected = true; await inject(); }
          await guard!.beforeMutation();
        },
      }),
    };
  };
  return { ...f, authority, publish, roots, payload, run, atRemoval, unsettled() { stopped = false; } };
}

it.for(workspaceRemnantBindingOwners)('clears only payloadless %s metadata and preserves foreign bytes', async (owner, context) => {
  const f = await fixture(context, owner);
  await f.publish();
  const foreign = await f.publish({ ...f.binding, workspaceId: id(99), operationId: id(100),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign') },
    ...(owner === 'profileInspection' ? { generationId: id(101) } : {}) });
  const foreignPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(foreign));
  const original = await readFile(foreignPaths.currentPath);
  await f.run();
  expect((await f.store().inspect(f.authority)).mode).toBe('absent');
  expect(await readFile(foreignPaths.currentPath)).toEqual(original);
});

for (const side of ['next', 'backup', 'both'] as const) {
  it.for(owners)(`clears exact %s metadata with original ${side} side slots`, async (owner, context) => {
    const f = await fixture(context, owner); await f.publish();
    for (const slot of side === 'both' ? ['next', 'backup'] as const : [side]) {
      await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    }
    await f.run();
    expect(await readdir(f.paths.directoryPath)).toEqual([]);
  });
}

it.for(owners)('rejects a live %s payload and retains all metadata', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  const root = f.roots[owner === 'workspaceActivationMigration' ? 1 : 0]!;
  await f.payload(root);
  const before = await f.snapshot();
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(await f.snapshot()).toEqual(before);
  expect(await readFile(join(root, 'retained'), 'utf8')).toBe('synthetic payload');
});

it.for(owners)('rejects foreign target identity for %s before source reads', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  const before = await f.snapshot();
  let reads = 0;
  await expect(f.run(f.fileSystem, { ...nativeReads, async directoryIdentity(...args) {
    reads++; return nativeReads.directoryIdentity(...args);
  } }, { ...header, lineageIdentity: { formatVersion: 1, profileId: hash('wrong') } })).rejects.toThrow();
  expect(reads).toBe(0); expect(await f.snapshot()).toEqual(before);
});

it.for(owners)('rejects next-only %s metadata without adopting it', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  await rename(f.paths.currentPath, f.paths.nextPath);
  const before = await f.snapshot();
  await expect(f.run()).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
});

it.for(owners)('rejects a new %s payload at the actual slot-removal guard', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  const root = f.roots[owner === 'workspaceActivationMigration' ? 1 : 0]!;
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const before = await f.snapshot();
  await expect(f.run(f.atRemoval(() => f.payload(root)))).rejects.toThrow();
  expect(await f.snapshot()).toEqual(before);
  expect(await readFile(join(root, 'retained'), 'utf8')).toBe('synthetic payload');
});

it.for(owners)('rejects a newly competing binding at %s removal', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  const otherOwner = owner === 'workspaceReplacement' ? 'workspaceActivationMigration'
    : owner === 'workspaceActivationMigration' ? 'workspaceReplacement'
      : owner === 'workspaceImport' ? 'workspaceLegacyAdoption' : 'workspaceImport';
  let competing!: WorkspaceRemnantBindingV1;
  await expect(f.run(f.atRemoval(async () => { competing = await f.publish({ ...f.binding, owner: otherOwner }); }))).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  expect(await readFile(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(competing)).currentPath))
    .toEqual(serializeWorkspaceRemnantBinding(competing));
});

it.for(['slot', 'parent', 'lease', 'target', 'writers'] as const)('retains the first failure and bytes after %s loss', async (kind, context) => {
  const f = await fixture(context); await f.publish();
  const root = f.roots[1]!, parent = dirname(root);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const before = await f.snapshot();
  const failure = f.run(f.atRemoval(async () => {
    if (kind === 'slot') await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
    else if (kind === 'parent') { await rename(parent, join(f.root, 'retained-parent')); await mkdir(parent, { mode: 0o700 }); }
    else if (kind === 'lease') f.expire();
    else if (kind === 'target') f.changeTarget();
    else f.unsettled();
  }));
  if (kind === 'lease') await expect(failure).rejects.toThrow('SYNTHETIC_LEASE_LOST');
  else if (kind === 'target') await expect(failure).rejects.toThrow('SYNTHETIC_TARGET_CHANGED');
  else if (kind === 'writers') await expect(failure).rejects.toThrow('SYNTHETIC_WRITER_UNSETTLED');
  else await expect(failure).rejects.toThrow();
  expect(await readFile(f.paths.currentPath, 'hex')).toBe(before[basename(f.paths.currentPath)]);
});

it.for(owners)('rejects a changed %s metadata parent identity with unchanged slot identities', async (owner, context) => {
  const f = await fixture(context, owner); await f.publish();
  await writeFile(f.paths.backupPath, serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600 });
  const before = await f.snapshot();
  const identities = new Map<string, CrashSafeFileSlotIdentity>();
  for (const slot of ['current', 'backup'] as const) await f.fileSystem.readSlot(slot, identity => { identities.set(slot, identity); });
  let armed = false, changedReads = 0;
  await expect(f.run(f.atRemoval(async () => { armed = true; }), { ...nativeReads, async directoryIdentity(path, guard) {
    const identity = await nativeReads.directoryIdentity(path, guard);
    if (armed && path === f.paths.directoryPath) { changedReads++; return hash('replaced metadata parent'); }
    return identity;
  } })).rejects.toThrow();
  expect(changedReads).toBeGreaterThan(0);
  expect(await f.snapshot()).toEqual(before);
  for (const slot of ['current', 'backup'] as const) await f.fileSystem.readSlot(slot, identity => {
    expect(sameCrashSafeFileSlotIdentity(identities.get(slot)!, identity)).toBe(true);
  });
});

it.for(['candidate', 'competitor'] as const)('rejects a late adoption %s during the last legacy read before removal', async (change, context) => {
  const f = await fixture(context, 'workspaceLegacyAdoption'); await f.publish();
  await mkdir(dirname(f.roots[0]!), { recursive: true, mode: 0o700 });
  const last = join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames.at(-1)!);
  let armed = false, observed = 0;
  const fileSystem = f.atRemoval(async () => { armed = true; });
  await expect(f.run(fileSystem, { ...nativeReads, async entryIdentity(path, guard) {
    const identity = await nativeReads.entryIdentity(path, guard);
    if (armed && path === last && ++observed === 6) {
      if (change === 'candidate') await f.payload(f.roots[0]!);
      else await f.publish({ ...f.binding, owner: 'workspaceImport' });
    }
    return identity;
  } })).rejects.toThrow();
  expect(observed).toBeGreaterThanOrEqual(6);
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  if (change === 'candidate') expect(await readFile(join(f.roots[0]!, 'retained'), 'utf8')).toBe('synthetic payload');
});

it('does not turn a failed cleanup acknowledgement into success when all slots are absent', async context => {
  const f = await fixture(context); await f.publish();
  const failure = new Error('SYNTHETIC_SYNC_ACKNOWLEDGEMENT_FAILED');
  const fileSystem = f.atRemoval(async () => {});
  const work = f.run({ ...fileSystem, async syncDirectory(guard) {
    await fileSystem.syncDirectory(guard);
    throw failure;
  } });
  await expect(work).rejects.toBe(failure);
  expect(await readdir(f.paths.directoryPath)).toEqual([]);
});

it('joins an in-flight absence read before rejecting a lost lease without removing metadata', async context => {
  const f = await fixture(context); await f.publish();
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const before = await f.snapshot();
  let pending = true, settled = false;
  const work = clear(f.root, header, f.binding, f.authority, { fileSystem: f.fileSystem, reads: { ...nativeReads, async assertAbsent(path, guard) {
    if (pending) {
      pending = false;
      start();
      await blocked;
    }
    return nativeReads.assertAbsent(path, guard);
  } } });
  context.onTestFinished(async () => { release(); await work.catch(() => undefined); });
  const observed = work.then(() => { settled = true; }, error => { settled = true; return error; });
  await Promise.race([started, observed.then(() => { throw new Error('SYNTHETIC_READ_NOT_REACHED'); })]);
  f.expire();
  expect(settled).toBe(false);
  release();
  await expect(observed).resolves.toMatchObject({ message: 'SYNTHETIC_LEASE_LOST' });
  expect(await f.snapshot()).toEqual(before);
});

it.for(['initial', 'removal'] as const)('preserves adoption metadata with a legacy payload at %s', async (when, context) => {
  const f = await fixture(context, 'workspaceLegacyAdoption'); await f.publish();
  const legacy = join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames[0]!);
  await mkdir(dirname(legacy), { recursive: true, mode: 0o700 });
  const add = () => writeFile(legacy, 'retained legacy', { mode: 0o600 });
  if (when === 'initial') await add();
  await expect(f.run(when === 'removal' ? f.atRemoval(add) : f.fileSystem)).rejects.toThrow();
  expect(await readFile(f.paths.currentPath)).toEqual(serializeWorkspaceRemnantBinding(f.binding));
  expect(await readFile(legacy, 'utf8')).toBe('retained legacy');
});
