import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TestContext } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord, deletionInventoryRecordKey, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionInventorySources as capture } from './workspaceDeletionInventorySources.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256,
  type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';
import { remnantBindingFixture, remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import { deriveWorkspaceReplacementRemnantParents } from './workspaceReplacementRemnantPaths.js';

export async function deletionRoleSourceFixture(context: TestContext) {
  const f = await remnantBindingFixture(context);
  const workspace = deriveWorkspaceRoot(f.root, header.workspaceId, 1);
  const retained: string[] = [];
  const createdRoots: string[] = [];
  let writersAbsent = true;
  const authority = { ...f.authority,
    assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertWritersAbsent() { if (!writersAbsent) throw new Error('SYNTHETIC_WRITER_UNSETTLED'); },
  };
  const payload = async (root: string) => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, 'retained-payload');
    await writeFile(path, 'retained synthetic bytes', { mode: 0o600 }); retained.push(path); createdRoots.push(root);
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
    createdRoots: () => Object.freeze([...createdRoots]),
    capture: (reads = nativeReads) => {
      const work = capture(f.root, header, rootIdentity, authority, reads);
      context.onTestFinished(async () => { await work.catch(() => undefined); });
      return work;
    },
    unsettled() { writersAbsent = false; },
    async preserved() { return Promise.all(retained.map(path => readFile(path, 'hex'))); } };
}

// Fixture-owned expectations, independent of the production source census and its projection.
export async function snapshotSeededDeletionRoles(f: Awaited<ReturnType<typeof deletionRoleSourceFixture>>,
  seeded: Pick<Awaited<ReturnType<typeof seedAllDeletionRoles>>, 'targetBindings' | 'legacy'>) {
  const records: WorkspaceDeletionInventoryRecord[] = [], roots: string[] = [];
  const written = f.createdRoots();
  const append = async (role: WorkspaceDeletionInventoryRecord['role'], root: string,
    binding?: WorkspaceRemnantBindingV1, member: string | null = null) => {
    const created = written.find(path => path === root);
    if (created === undefined && root !== seeded.legacy) throw new Error('SYNTHETIC_UNSEEDED_DELETION_ROOT');
    const legacy = role === 'legacyEntry';
    const observed = legacy ? await nativeReads.entryIdentity(root, f.authority.assertAuthority) : undefined;
    if (legacy && observed === null) return;
    const rootIdentity = observed?.identity ?? await nativeReads.directoryIdentity(root, f.authority.assertAuthority);
    const parentIdentity = legacy ? await nativeReads.runtimeIdentity(dirname(root), f.authority.assertAuthority)
      : await nativeReads.directoryIdentity(dirname(root), f.authority.assertAuthority);
    if (parentIdentity === null) throw new Error('SYNTHETIC_DELETION_PARENT_MISSING');
    if (binding?.owner === 'profileInspection' && (binding.rootIdentity !== rootIdentity || binding.parentIdentity !== parentIdentity)) {
      throw new Error('SYNTHETIC_INSPECTION_IDENTITY_MISMATCH');
    }
    records.push(captureDeletionInventoryRecord({ role, ownerOperationId: role === 'workspace' || legacy ? null : binding!.operationId,
      generationId: binding?.owner === 'profileInspection' ? binding.generationId : null, member,
      rootIdentity, parentIdentity, bindingSha256: binding === undefined ? null : workspaceRemnantBindingSha256(binding) }));
    roots.push(created ?? seeded.legacy);
  };
  await append('workspace', f.workspace.workspaceRoot);
  for (const binding of seeded.targetBindings) {
    if (binding.workspaceId !== header.workspaceId || binding.lineageIdentity.profileId !== header.lineageIdentity.profileId) {
      throw new Error('SYNTHETIC_FOREIGN_EXPECTED_BINDING');
    }
    if (binding.owner === 'workspaceReplacement' || binding.owner === 'workspaceActivationMigration') {
      for (const parent of deriveWorkspaceReplacementRemnantParents(f.root)) {
        const root = join(parent.parentPath, binding.operationId);
        if (written.includes(root)) await append(parent.role, root, binding);
      }
    } else if (binding.owner === 'workspaceImport' || binding.owner === 'workspaceLegacyAdoption') {
      const root = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot;
      await append(binding.owner === 'workspaceImport' ? 'importCandidate' : 'adoptionCandidate', root, binding);
      if (binding.owner === 'workspaceLegacyAdoption') for (const member of workspaceOwnedEntryNames) {
        const path = join(dirname(seeded.legacy), member);
        if (path === seeded.legacy || written.includes(path)) await append('legacyEntry', path, binding, member);
      }
    } else if (binding.owner === 'profileInspection') {
      for (const location of deriveWorkspaceInspectionRemnantPaths(f.root, binding)) if (written.includes(location.rootPath)) {
        await append(location.scope === 'workspace' ? 'inspectionEvidence' : 'inspection', location.rootPath, binding);
      }
    } else throw new Error('SYNTHETIC_UNSUPPORTED_EXPECTED_BINDING');
  }
  records.sort((a, b) => {
    const left = deletionInventoryRecordKey(a), right = deletionInventoryRecordKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return Object.freeze({ records: Object.freeze(records), roots: Object.freeze(roots) });
}

export async function assertSeededDeletionRootsAbsent(roots: readonly string[]): Promise<void> {
  for (const root of roots) {
    try { await lstat(root); }
    catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue; throw error; }
    throw new Error('SYNTHETIC_EXPECTED_DELETION_PAYLOAD_REMAINS');
  }
}

export async function seedAllDeletionRoles(f: Awaited<ReturnType<typeof deletionRoleSourceFixture>>) {
  const parents = deriveWorkspaceReplacementRemnantParents(f.root);
  const replacement = await f.publish(remnantTestBinding());
  for (const parent of parents) await f.payload(join(parent.parentPath, replacement.operationId));
  const migration = await f.publish({ ...remnantTestBinding('workspaceActivationMigration'), operationId: id(10) });
  const targetBindings = [replacement, migration];
  await f.payload(join(parents[1]!.parentPath, migration.operationId));
  for (const [owner, number] of [['workspaceImport', 20], ['workspaceLegacyAdoption', 30]] as const) {
    const binding = await f.publish({ ...remnantTestBinding(owner), operationId: id(number) });
    targetBindings.push(binding);
    await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot);
  }
  const legacy = join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, workspaceOwnedEntryNames[0]!);
  await mkdir(dirname(legacy), { recursive: true, mode: 0o700 });
  await writeFile(legacy, 'retained legacy bytes', { mode: 0o600 });
  targetBindings.push(await f.inspection(40, 0), await f.inspection(41, 2));
  const foreign = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(50), workspaceId: id(99),
    lineageIdentity: { formatVersion: 1, profileId: hash('foreign') } });
  await f.payload(deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(foreign.operationId), foreign.workspaceId).candidateRoot);
  const foreignInspection = await f.inspection(51, 3, true);
  return { replacement, foreign, foreignInspection, legacy, targetBindings };
}
