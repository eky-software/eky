import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { deletionTestHeader, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import { assertWorkspaceDeletionInspectionEvidence } from './workspaceDeletionInspectionEvidence.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { workspaceInspectionRemnantReads } from './workspaceInspectionRemnantAbsence.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';

async function fixture(test: TestContext, index = 0, moved = false) {
  const f = await remnantBindingFixture(test, 'profileInspection');
  const locations = deriveWorkspaceInspectionRemnantPaths(f.root, f.binding);
  for (const location of locations) await mkdir(location.parentPath, { recursive: true, mode: 0o700 });
  const location = locations[index]!;
  await mkdir(location.rootPath, { mode: 0o700 });
  await writeFile(join(location.rootPath, 'retained'), 'synthetic-inspection-evidence', { mode: 0o600 });
  const binding = captureWorkspaceRemnantBinding({ ...f.binding,
    rootIdentity: await identity(location.rootPath, f.authority.assertAuthority),
    parentIdentity: await identity(location.parentPath, f.authority.assertAuthority) });
  if (binding.owner !== 'profileInspection') throw new Error('SYNTHETIC_INSPECTION_REQUIRED');
  await f.store().publish(binding, f.authority);
  const paths = deriveWorkspaceRoot(f.root, deletionTestHeader.workspaceId, 1);
  const workspace = captureDeletionInventoryRecord({ role: 'workspace', ownerOperationId: null,
    generationId: null, member: null, bindingSha256: null,
    rootIdentity: await identity(paths.workspaceRoot, f.authority.assertAuthority),
    parentIdentity: await identity(paths.workspacesRoot, f.authority.assertAuthority) });
  const evidence = captureDeletionInventoryRecord({ role: 'inspectionEvidence', ownerOperationId: binding.operationId,
    generationId: binding.generationId, member: null, rootIdentity: binding.rootIdentity,
    parentIdentity: binding.parentIdentity, bindingSha256: workspaceRemnantBindingSha256(binding) });
  const payload = deriveWorkspaceDeletionPayloadPaths(f.root, deletionTestHeader, workspace)[0]!;
  if (moved) await rename(payload.sourcePath, payload.quarantinePath);
  let writersAbsent = true;
  const authority = { ...f.authority, async assertWritersAbsent() {
    if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_PRESENT');
  } };
  const currentCopy = () => moved && index < 2 ? join(payload.quarantinePath, relative(payload.sourcePath, location.rootPath)) : location.rootPath;
  return { ...f, locations, location, workspace, evidence, payload, authority,
    writerPresent() { writersAbsent = false; }, currentCopy,
    run(phase: 'authorized' | 'quarantined' | 'purgeAuthorized' | 'purged' | 'registryPublished' = moved ? 'quarantined' : 'authorized',
      reads = workspaceInspectionRemnantReads) {
      return assertWorkspaceDeletionInspectionEvidence(f.root, deletionTestJournal(phase), workspace, evidence, authority, reads);
    },
  };
}

it.for([0, 1])('validates internal copy %s in the original or proven moved workspace without changing bytes', async (index, test) => {
  const f = await fixture(test, index);
  const before = await f.snapshot();
  await f.run();
  await rename(f.payload.sourcePath, f.payload.quarantinePath);
  await f.run('authorized');
  await f.run('quarantined');
  const copy = join(f.payload.quarantinePath, relative(f.payload.sourcePath, f.location.rootPath));
  expect(await readFile(join(copy, 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
  expect(await f.snapshot()).toEqual(before);
});

it.for([0, 1])('rejects quarantined phase while internal copy %s is still in the source', async (index, test) => {
  const f = await fixture(test, index);
  await expect(f.run('quarantined')).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(await readFile(join(f.currentCopy(), 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
});

it.for(['purgeAuthorized', 'purged', 'registryPublished'] as const)('does not demand an already removed copy in %s', async (phase, test) => {
  const f = await fixture(test, 0, true);
  const reads = { ...workspaceInspectionRemnantReads, directoryIdentity: vi.fn(workspaceInspectionRemnantReads.directoryIdentity) };
  await expect(f.run(phase, reads)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(reads.directoryIdentity).not.toHaveBeenCalled();
  expect(await readFile(join(f.currentCopy(), 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
});

it.for([2, 3])('never treats external copy %s as internal metadata evidence', async (index, test) => {
  const f = await fixture(test, index);
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(await readFile(join(f.currentCopy(), 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
});

it.for(['evidenceHash', 'workspaceRole', 'evidenceRole'] as const)('rejects %s before the source-owner reads', async (change, test) => {
  const f = await fixture(test);
  const reads = { ...workspaceInspectionRemnantReads, directoryIdentity: vi.fn(workspaceInspectionRemnantReads.directoryIdentity) };
  const workspace = change === 'workspaceRole' ? f.evidence : f.workspace;
  const evidence = change === 'evidenceHash' ? { ...f.evidence, bindingSha256: 'a'.repeat(64) }
    : change === 'evidenceRole' ? { ...f.evidence, role: 'inspection' } : f.evidence;
  await expect(assertWorkspaceDeletionInspectionEvidence(f.root, deletionTestJournal(), workspace, evidence, f.authority, reads)).rejects.toThrow();
  expect(reads.directoryIdentity).not.toHaveBeenCalled();
});

it.for(['copyReplaced', 'parentReplaced', 'alternateCopy', 'sourceReappears'] as const)(
  'preserves changed evidence and rejects %s in the moved workspace', async (change, test) => {
    const f = await fixture(test, 0, true);
    const copy = f.currentCopy();
    if (change === 'copyReplaced') {
      await rename(copy, join(f.root, 'preserved-copy'));
      await mkdir(copy, { mode: 0o700 });
      await writeFile(join(copy, 'retained'), 'synthetic-inspection-evidence');
    } else if (change === 'parentReplaced') {
      const parent = join(f.payload.quarantinePath, relative(f.payload.sourcePath, f.location.parentPath));
      await rename(parent, join(f.root, 'preserved-parent'));
      await mkdir(parent, { mode: 0o700 });
      await rename(join(f.root, 'preserved-parent', relative(f.location.parentPath, f.location.rootPath)), copy);
    } else if (change === 'alternateCopy') await mkdir(f.locations[2]!.rootPath, { mode: 0o700 });
    else await mkdir(f.payload.sourcePath, { mode: 0o700 });
    const before = await f.snapshot();
    await expect(f.run()).rejects.toThrow();
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(copy, 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
  },
);

it('requires settled writers even with an intact workspace and binding', async test => {
  const f = await fixture(test, 0, true);
  f.writerPresent();
  await expect(f.run()).rejects.toThrow('SYNTHETIC_WRITER_PRESENT');
  expect(await readFile(join(f.currentCopy(), 'retained'), 'utf8')).toBe('synthetic-inspection-evidence');
});
