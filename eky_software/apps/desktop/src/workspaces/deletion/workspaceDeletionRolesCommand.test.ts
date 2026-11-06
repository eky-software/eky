import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { deriveWorkspaceLegacyRuntimePaths } from '../adoption/workspaceLegacyAdoptionPaths.js';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { captureDeletionTarget } from '../management/workspaceDeletionTarget.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceDeletionCommand } from './workspaceDeletionCommand.js';
import { observeDeletionCommandFailures } from './workspaceDeletionCommandEvidenceTestSupport.js';
import { deletionTestHeader as header, deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { assertSeededDeletionRootsAbsent, deletionRoleSourceFixture, seedAllDeletionRoles,
  snapshotSeededDeletionRoles } from './workspaceDeletionRolesTestSupport.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { workspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';

it('deletes all ten roles and every legacy member through one actual file command, preserving foreign owners', {
  timeout: 180_000,
}, async test => {
  const evidence = observeDeletionCommandFailures(test);
  try {
    const f = await deletionRoleSourceFixture(test);
    evidence.preparedRoot(f.root);
    const seeded = await seedAllDeletionRoles(f);
    const legacyRoot = deriveWorkspaceLegacyRuntimePaths(f.root).legacyRuntimeRoot;
    for (const member of workspaceOwnedEntryNames.slice(1)) await f.payload(join(legacyRoot, member));
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
    const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: registryPath });
    const base = createSwitchRegistry();
    await registry.write({
      ...base, formatVersion: 2,
      workspaces: [base.workspaces[0]!, { ...base.workspaces[1]!, workspaceId: header.workspaceId, lineageIdentity: header.lineageIdentity }]
    });
    const target = await captureDeletionTarget({
      installationRoot: f.root, workspaceId: header.workspaceId,
      typedLabel: base.workspaces[1]!.workspaceLabel, registry, assertAuthority: f.authority.assertAuthority
    });
    const external = await mkdtemp(join(tmpdir(), 'eky-delete-retained-'));
    test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(external, { recursive: true, force: true }); });
    const foreignCandidate = deriveWorkspaceBackupImportPaths(f.root,
      validateWorkspaceBackupImportOperationId(seeded.foreign.operationId), seeded.foreign.workspaceId).candidateRoot;
    const retained = [join(external, 'backup.eky'), join(external, 'invoice.pdf'), join(legacyRoot, 'logs', 'retained'),
    join(deriveWorkspaceRoot(f.root, TEST_SOURCE_WORKSPACE_ID, 1).workspaceRoot, 'runtime', 'data', 'eky.sqlite')];
    for (const path of retained) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, 'retained-independent-bytes', { flag: 'wx', mode: 0o600 }); }
    retained.push(join(foreignCandidate, 'retained-payload'),
      createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(seeded.foreign)).currentPath,
      createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(seeded.foreignInspection)).currentPath,
      join(deriveWorkspaceInspectionRemnantPaths(f.root, seeded.foreignInspection)[3]!.rootPath, 'retained-payload'));
    const retainedBytes = await Promise.all(retained.map(path => readFile(path)));
    const snapshot = snapshotSeededDeletionRoles(f, seeded);
    test.onTestFinished(async () => { await snapshot.catch(() => undefined); });
    const expected = await snapshot, rows = expected.records;
    expect(new Set(rows.map(row => row.role)).size).toBe(10);
    expect(rows.filter(row => row.role === 'legacyEntry').map(row => row.member).sort()).toEqual([...workspaceOwnedEntryNames].sort());
    expect(rows).toHaveLength(23);
    const before = await f.preserved(), operationId = id(200);
    const command = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry, assertWritersAbsent: f.authority.assertWritersAbsent });
    const publish = command.publish(f.authority.assertAuthority, f.authority.assertExternalSelection, target.target,
      { operationId, target: target.target, backupDisposition: 'explicitDataLoss' }, () => target.assertCurrent());
    test.onTestFinished(async () => { await publish.catch(() => undefined); });
    const published = await publish;
    expect(published.journal.inventory.recordCount).toBe(23);
    const committedRows: typeof rows[number][] = [];
    const committedRead = new WorkspaceDeletionInventoryStore(f.root, operationId).consumeSelectedRecords({
      target: published.journal.target, inventory: published.journal.inventory,
      inventoryFileIdentity: published.journal.inventoryFileIdentity,
      operationRootIdentity: published.journal.operationRootIdentity, operationParentIdentity: published.journal.operationParentIdentity,
    }, f.authority, async row => { committedRows.push(row); });
    test.onTestFinished(async () => { await committedRead.catch(() => undefined); });
    await committedRead;
    expect(committedRows).toEqual(expected.records);
    expect(await f.preserved()).toEqual(before);
    const payloadPaths = rows.flatMap(row => row.role === 'inspectionEvidence' ? [] : deriveWorkspaceDeletionPayloadPaths(f.root, published.journal.target, row));
    const recordRemoved = vi.fn();
    evidence.admission();
    const continuation = command.resume(operationId, {
      assertCurrent: f.authority.assertAuthority,
      assertOwned: f.authority.assertExternalSelection, recordRemoved
    });
    test.onTestFinished(async () => { await continuation.catch(() => undefined); });
    expect(await continuation).toEqual({ formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' });
    expect(evidence.phase()).toBe('finalizer');
    evidence.verification();
    expect(recordRemoved).toHaveBeenCalledTimes(1);
    for (const path of payloadPaths) {
      expect(existsSync(path.sourcePath)).toBe(false);
      expect(existsSync(path.quarantinePath)).toBe(false);
    }
    const rootsAbsent = assertSeededDeletionRootsAbsent(expected.roots);
    test.onTestFinished(async () => { await rootsAbsent.catch(() => undefined); });
    await rootsAbsent;
    for (const binding of seeded.targetBindings) {
      const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
      for (const path of [paths.currentPath, paths.nextPath, paths.backupPath]) expect(existsSync(path)).toBe(false);
    }
    const journal = createWorkspaceDeletionJournalPaths(f.root);
    for (const path of [journal.currentPath, journal.nextPath, journal.backupPath]) expect(existsSync(path)).toBe(false);
    expect(existsSync(createWorkspaceDeletionInventoryPaths(f.root, operationId).directoryPath)).toBe(false);
    expect((await registry.inspectSlots()).current!.value.workspaces.map(value => value.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
    expect(await Promise.all(retained.map(path => readFile(path)))).toEqual(retainedBytes);
  } catch (error) { evidence.record(error); throw error; }
});
