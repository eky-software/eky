import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { deletionTestHeader as header, deletionTestId as id, deletionTestDigest as hash } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryRecord, deletionInventoryRecordKey } from './workspaceDeletionInventoryCodec.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { assertSeededDeletionRootsAbsent, deletionRoleSourceFixture, snapshotSeededDeletionRoles } from './workspaceDeletionRolesTestSupport.js';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';

async function fixture(context: TestContext) {
  const f = await deletionRoleSourceFixture(context);
  const binding = await f.publish({ ...remnantTestBinding('workspaceImport'), operationId: id(20) });
  const candidate = deriveWorkspaceBackupImportPaths(f.root, validateWorkspaceBackupImportOperationId(binding.operationId), binding.workspaceId).candidateRoot;
  await f.payload(candidate);
  const snapshot = snapshotSeededDeletionRoles(f, { targetBindings: [binding],
    legacy: join(deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot, 'eky.sqlite') });
  context.onTestFinished(async () => { await snapshot.catch(() => undefined); });
  const expected = await snapshot;
  expect(expected.records.map(row => row.role)).toEqual(['importCandidate', 'workspace']);
  return { ...f, expected, candidate };
}

it.for(['omitted', 'extraForeign', 'wrongRole', 'wrongIdentity', 'wrongDigest'] as const)(
  'rejects %s produced rows against the independent fixture snapshot', async (kind, context) => {
    const f = await fixture(context), original = f.expected.records;
    let produced = [...original];
    const candidate = produced.find(row => row.role === 'importCandidate')!;
    if (kind === 'omitted') produced = produced.filter(row => row !== candidate);
    else if (kind === 'extraForeign') produced.push(captureDeletionInventoryRecord({ ...candidate, ownerOperationId: id(900), bindingSha256: hash('foreign') }));
    else produced = produced.map(row => row !== candidate ? row : captureDeletionInventoryRecord({ ...row,
      ...(kind === 'wrongRole' ? { role: 'adoptionCandidate' } : kind === 'wrongIdentity'
        ? { rootIdentity: hash('wrong-root') } : { bindingSha256: hash('wrong-binding') }) }));
    produced.sort((a, b) => {
      const left = deletionInventoryRecordKey(a), right = deletionInventoryRecordKey(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const store = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
    const publication = store.publish(header, (async function* () { yield* produced; })(), f.authority);
    context.onTestFinished(async () => { await publication.catch(() => undefined); });
    const actual = await publication;
    const work = store.assertRecords(actual, (async function* () { yield* original; })(), f.authority);
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    await expect(work).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.expected.records).toEqual(original); expect(f.expected.records).toHaveLength(2);
    expect(await readFile(join(f.candidate, 'retained-payload'), 'utf8')).toBe('retained synthetic bytes');
  });

it('rejects a skipped seeded root independently of the produced inventory paths', async context => {
  const f = await fixture(context);
  await rm(f.workspace.workspaceRoot, { recursive: true });
  await expect(assertSeededDeletionRootsAbsent(f.expected.roots)).rejects.toThrow('SYNTHETIC_EXPECTED_DELETION_PAYLOAD_REMAINS');
  expect(await readFile(join(f.candidate, 'retained-payload'), 'utf8')).toBe('retained synthetic bytes');
  await rm(f.candidate, { recursive: true });
  await expect(assertSeededDeletionRootsAbsent(f.expected.roots)).resolves.toBeUndefined();
});
