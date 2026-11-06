import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { captureWorkspaceDeletionPayloadBinding as capture } from './workspaceDeletionPayloadBinding.js';
import { deletionTestDigest as hash, deletionTestHeader, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryRecord,
  type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  workspaceRemnantBindingSha256, type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

const invalidCode = 'WORKSPACE_REMNANT_BINDING_INVALID';
const mappings: readonly { owner: WorkspaceRemnantBindingV1['owner']; role: WorkspaceDeletionInventoryRecord['role'] }[] = [
  { owner: 'workspaceReplacement', role: 'workspace' },
  { owner: 'workspaceLegacyAdoption', role: 'legacyEntry' },
  { owner: 'workspaceImport', role: 'importCandidate' },
  { owner: 'workspaceLegacyAdoption', role: 'adoptionCandidate' },
  { owner: 'workspaceReplacement', role: 'replacementImport' },
  ...(['workspaceReplacement', 'workspaceActivationMigration'] as const).flatMap(owner =>
    (['activationStaging', 'activationRollback', 'activationFailed'] as const).map(role => ({ owner, role }))),
  { owner: 'profileInspection', role: 'inspection' },
  { owner: 'profileInspection', role: 'inspectionEvidence' },
];

function recordFor(binding: WorkspaceRemnantBindingV1, role: WorkspaceDeletionInventoryRecord['role']) {
  return captureDeletionInventoryRecord({ role,
    ownerOperationId: role === 'workspace' || role === 'legacyEntry' ? null : binding.operationId,
    generationId: binding.owner === 'profileInspection' ? binding.generationId : null,
    member: role === 'legacyEntry' ? 'data' : null,
    rootIdentity: binding.owner === 'profileInspection' ? binding.rootIdentity : hash('payload-root'),
    parentIdentity: binding.owner === 'profileInspection' ? binding.parentIdentity : hash('payload-parent'),
    bindingSha256: role === 'workspace' ? null : workspaceRemnantBindingSha256(binding) });
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) { result[`${key}/`] = 'directory'; await visit(path, `${key}/`); }
      else result[key] = (await readFile(path)).toString('hex');
    }
  };
  await visit(root, '');
  return result;
}

async function fixture(context: TestContext, owner: WorkspaceRemnantBindingV1['owner'] = 'workspaceImport',
  role: WorkspaceDeletionInventoryRecord['role'] = 'importCandidate') {
  const f = await remnantBindingFixture(context, owner);
  const target = captureDeletionInventoryHeader({ ...deletionTestHeader, operationId: id(40),
    workspaceId: f.binding.workspaceId, lineageIdentity: f.binding.lineageIdentity });
  const record = recordFor(f.binding, role);
  let current = true, external = true, absent = true;
  const ownerError = new Error('SYNTHETIC_OWNER_REVOKED'), externalError = new Error('SYNTHETIC_PHASE_CHANGED');
  const writerError = new Error('SYNTHETIC_WRITER_PRESENT');
  const authority = {
    assertAuthority: vi.fn(() => { context.signal.throwIfAborted(); if (!current) throw ownerError; }),
    assertExternalSelection: vi.fn(async () => { if (!external) throw externalError; }),
    assertWritersAbsent: vi.fn(async () => { if (!absent) throw writerError; }),
  };
  const publish = async (binding: WorkspaceRemnantBindingV1 = f.binding) =>
    new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
  return { ...f, target, record, authority, publish, ownerError, externalError, writerError,
    revoke() { current = false; }, changePhase() { external = false; }, setAbsent(value: boolean) { absent = value; },
    capture: (targetValue: unknown = target, recordValue: unknown = record) => capture(f.root, targetValue, recordValue, authority),
    snapshot: () => snapshot(f.root) };
}

it.for(mappings)('pins $owner metadata for $role without requiring any payload', async ({ owner, role }, context) => {
  const f = await fixture(context, owner, role);
  if (role !== 'workspace') {
    await f.publish();
    await f.publish(captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(8), workspaceId: id(9) }));
  }
  const before = await f.snapshot(), selected = await f.capture();
  expect(selected.binding).toEqual(role === 'workspace' ? undefined : f.binding);
  expect(Object.isFrozen(selected)).toBe(true);
  await selected.assertSelected();
  expect(await f.snapshot()).toEqual(before);
});

it.for(mappings.filter(({ role }) => role !== 'workspace'))('rejects absent $owner metadata for $role without creating directories',
  async ({ owner, role }, context) => {
    const f = await fixture(context, owner, role);
    await expect(f.capture()).rejects.toThrow(invalidCode);
    expect(await readdir(f.root)).toEqual([]);
  });

it.for(['next', 'backup', 'both'] as const)('captures all matching %s side slots without repair', async (mode, context) => {
  const f = await fixture(context); await f.publish();
  const slots: readonly ('next' | 'backup')[] = mode === 'both' ? ['next', 'backup'] : [mode];
  for (const slot of slots) {
    await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.binding), { mode: 0o600, flag: 'wx' });
  }
  const before = await f.snapshot(), selected = await f.capture();
  await selected.assertSelected();
  expect(await f.snapshot()).toEqual(before);
});

it.for(['nextOnly', 'backupOnly', 'malformedCurrent', 'malformedSide', 'conflictingSide', 'wrongOwner'] as const)(
  'rejects %s without changing metadata', async (mode, context) => {
    const f = await fixture(context); await f.prepare();
    const bytes = serializeWorkspaceRemnantBinding(f.binding);
    if (mode === 'nextOnly' || mode === 'backupOnly') {
      await writeFile(mode === 'nextOnly' ? f.paths.nextPath : f.paths.backupPath, bytes, { mode: 0o600 });
    } else {
      await writeFile(f.paths.currentPath, mode === 'malformedCurrent' ? '{' : mode === 'wrongOwner'
        ? serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceReplacement' })) : bytes,
      { mode: 0o600 });
      if (mode === 'malformedSide' || mode === 'conflictingSide') await writeFile(f.paths.nextPath,
        mode === 'malformedSide' ? '{' : serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding,
          lineageIdentity: { formatVersion: 1, profileId: hash('changed') } })), { mode: 0o600 });
    }
    const before = await f.snapshot();
    await expect(f.capture()).rejects.toThrow(invalidCode);
    expect(await f.snapshot()).toEqual(before);
  });

it.for(['hash', 'lineage', 'workspace', 'operation'] as const)('rejects a wrong %s before returning a binding', async (change, context) => {
  const f = await fixture(context); await f.publish();
  const target = { ...f.target, ...(change === 'lineage' ? { lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } } : {}),
    ...(change === 'workspace' ? { workspaceId: id(9) } : {}) };
  const record = { ...f.record, ...(change === 'hash' ? { bindingSha256: hash('wrong') } : {}),
    ...(change === 'operation' ? { ownerOperationId: id(9) } : {}) };
  const before = await f.snapshot();
  await expect(f.capture(target, record)).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for([
  { owner: 'workspaceImport' as const, role: 'adoptionCandidate' as const },
  { owner: 'workspaceLegacyAdoption' as const, role: 'importCandidate' as const },
  { owner: 'workspaceActivationMigration' as const, role: 'replacementImport' as const },
])('rejects $owner as the owner of $role', async ({ owner, role }, context) => {
  const f = await fixture(context, owner, role); await f.publish();
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['rootIdentity', 'parentIdentity', 'generationId'] as const)('rejects a different inspection %s', async (field, context) => {
  const f = await fixture(context, 'profileInspection', 'inspection'); await f.publish();
  const before = await f.snapshot();
  await expect(f.capture(f.target, { ...f.record, [field]: field === 'generationId' ? id(9) : hash('wrong') })).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['candidate', 'activation'] as const)('rejects two published %s owners instead of choosing the matching hash', async (kind, context) => {
  const f = await fixture(context, kind === 'candidate' ? 'workspaceImport' : 'workspaceReplacement',
    kind === 'candidate' ? 'importCandidate' : 'activationFailed');
  await f.publish();
  await f.publish(captureWorkspaceRemnantBinding({ ...f.binding,
    owner: kind === 'candidate' ? 'workspaceLegacyAdoption' : 'workspaceActivationMigration' }));
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(before);
});

it('pins but does not select a legacy binding from another operation', async context => {
  const f = await fixture(context); await f.publish();
  const legacy = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceLegacyAdoption', operationId: id(8) });
  await f.publish(legacy);
  const before = await f.snapshot(), selected = await f.capture();
  expect(selected.binding).toEqual(f.binding);
  await selected.assertSelected();
  expect(await f.snapshot()).toEqual(before);
  const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(legacy));
  await writeFile(paths.currentPath, ` ${serializeWorkspaceRemnantBinding(legacy).toString()}`, { mode: 0o600 });
  const changed = await f.snapshot();
  await expect(selected.assertSelected()).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(changed);
});

it('rejects a foreign import competitor even when adoption matches', async context => {
  const f = await fixture(context, 'workspaceLegacyAdoption', 'adoptionCandidate'); await f.publish();
  await f.publish(captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceImport', workspaceId: id(9) }));
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(invalidCode);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['malformed', 'nextOnly', 'differentOperationOnly'] as const)(
  'does not skip %s legacy competitor metadata behind a matching import', async (mode, context) => {
    const f = await fixture(context);
    if (mode !== 'differentOperationOnly') await f.publish();
    const legacy = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceLegacyAdoption', operationId: id(8) });
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(legacy));
    await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
    await writeFile(mode === 'nextOnly' ? paths.nextPath : paths.currentPath,
      mode === 'malformed' ? '{' : serializeWorkspaceRemnantBinding(legacy), { mode: 0o600 });
    const before = await f.snapshot();
    await expect(f.capture()).rejects.toThrow(invalidCode);
    expect(await f.snapshot()).toEqual(before);
  });

it.for(['identity', 'rawBytes', 'newSide', 'newCompetitor', 'absentDirectory', 'emptyDirectory'] as const)(
  'rejects changed %s and preserves every remaining byte', async (change, context) => {
    const f = await fixture(context); await f.publish();
    const competitor = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceLegacyAdoption' });
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(competitor));
    if (change === 'newCompetitor' || change === 'emptyDirectory') await mkdir(paths.directoryPath, { mode: 0o700 });
    const selected = await f.capture();
    const bytes = await readFile(f.paths.currentPath);
    if (change === 'identity') {
      await rename(f.paths.currentPath, join(f.root, 'preserved-binding'));
      await writeFile(f.paths.currentPath, bytes, { mode: 0o600, flag: 'wx' });
    } else if (change === 'rawBytes') await writeFile(f.paths.currentPath, Buffer.concat([Buffer.from(' '), bytes]), { mode: 0o600 });
    else if (change === 'newSide') await writeFile(f.paths.backupPath, bytes, { mode: 0o600, flag: 'wx' });
    else if (change === 'newCompetitor') await f.publish(competitor);
    else {
      if (change === 'emptyDirectory') await rename(paths.directoryPath, join(f.root, 'preserved-directory'));
      await mkdir(paths.directoryPath, { mode: 0o700 });
    }
    const before = await f.snapshot();
    await expect(selected.assertSelected()).rejects.toThrow(invalidCode);
    expect(await f.snapshot()).toEqual(before);
    if (change === 'identity') expect((await readFile(join(f.root, 'preserved-binding'))).equals(bytes)).toBe(true);
  });

it.for(['external', 'writer'] as const)('latches the original %s failure after authority is restored or revoked', async (stage, context) => {
  const f = await fixture(context); await f.publish();
  const selected = await f.capture(), before = await f.snapshot();
  if (stage === 'external') f.changePhase(); else f.setAbsent(false);
  const expected = stage === 'external' ? f.externalError : f.writerError;
  await expect(selected.assertSelected()).rejects.toBe(expected);
  f.setAbsent(true); f.revoke();
  await expect(selected.assertSelected()).rejects.toBe(expected);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['external', 'writer', 'metadata'] as const)('joins pending %s work after guard revocation', async (stage, context) => {
  const f = await fixture(context); await f.publish();
  const selected = await f.capture(), before = await f.snapshot();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const hold = async () => { enter(); await pending; };
  const nativeInspect = WorkspaceRemnantBindingStore.prototype.inspect;
  const spy = stage === 'metadata' ? vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect') : undefined;
  if (stage === 'external') f.authority.assertExternalSelection.mockImplementationOnce(hold);
  else if (stage === 'writer') f.authority.assertWritersAbsent.mockImplementationOnce(hold);
  else spy!.mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, authority) {
    const observed = await nativeInspect.call(this, authority); await hold(); return observed;
  });
  let settled = false;
  const result = selected.assertSelected().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  context.onTestFinished(async () => { release(); await result; spy?.mockRestore(); });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_CHECK_NOT_PENDING'); })]);
    f.revoke(); await setImmediate();
    expect(settled).toBe(false);
  } finally { release(); await result; spy?.mockRestore(); }
  expect(await result).toBe(f.ownerError);
  await expect(selected.assertSelected()).rejects.toBe(f.ownerError);
  expect(await f.snapshot()).toEqual(before);
});

it('isolates caller snapshots and keeps the original authority callbacks', async context => {
  const f = await fixture(context); await f.publish();
  const target = { ...f.target, lineageIdentity: { ...f.target.lineageIdentity } }, record = { ...f.record };
  const selected = await f.capture(target, record), before = await f.snapshot();
  target.lineageIdentity.profileId = hash('changed'); record.bindingSha256 = hash('changed');
  f.authority.assertExternalSelection = vi.fn(async () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); });
  await selected.assertSelected();
  expect(selected.binding).toEqual(f.binding);
  expect(await f.snapshot()).toEqual(before);
});

it('keeps workspace selection guarded without reading separate metadata', async context => {
  const f = await fixture(context, 'workspaceReplacement', 'workspace');
  await writeFile(join(f.root, 'untouched'), 'synthetic-kept-bytes', { mode: 0o600 });
  const before = await f.snapshot(), selected = await f.capture();
  expect(selected.binding).toBeUndefined();
  f.setAbsent(false);
  await expect(selected.assertSelected()).rejects.toBe(f.writerError);
  f.setAbsent(true);
  await expect(selected.assertSelected()).rejects.toBe(f.writerError);
  expect(await f.snapshot()).toEqual(before);
});

it('rejects a Promise-returning authority guard and invalid root without writes', async context => {
  const f = await fixture(context);
  await expect(capture(f.root, f.target, f.record, { ...f.authority, async assertAuthority() {} })).rejects.toThrow(invalidCode);
  await expect(capture('relative', f.target, f.record, f.authority)).rejects.toThrow();
  expect(await readdir(f.root)).toEqual([]);
});
