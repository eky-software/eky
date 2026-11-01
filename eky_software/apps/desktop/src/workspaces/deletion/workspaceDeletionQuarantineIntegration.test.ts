import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { profileInspectionCopyDirectoryName } from '../../runtime/profileInspectionMessages.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { deletionTestHeader as header, deletionTestId as id, deletionTestJournal,
  deletionTestRecord } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryPayloadRecord, captureDeletionInventoryRecord, deletionInventoryLine,
  type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { deletionInventoryStoreFixture } from './workspaceDeletionInventoryStoreTestSupport.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { quarantineWorkspaceDeletionPayload, workspaceDeletionQuarantineFileSystem as nodeFileSystem } from './workspaceDeletionQuarantine.js';
import { deriveWorkspaceInspectionRemnantParents } from './workspaceInspectionRemnantPaths.js';

async function fixture(context: TestContext) {
  const f = await deletionInventoryStoreFixture(context);
  // Files and journal selection are real; main ownership/writer absence are test guards, not registry authority.
  const runtime = { mainOwned: true, writerAbsent: true };
  const assertAuthority = () => {
    f.authority.assertAuthority();
    if (!runtime.mainOwned || !runtime.writerAbsent) throw new Error('SYNTHETIC_MAIN_OR_WRITER_CONFLICT');
  };
  const publicationAuthority = { assertAuthority, async assertExternalSelection() { assertAuthority(); } };
  const workspaceDraft = captureDeletionInventoryPayloadRecord({ ...deletionTestRecord(), role: 'workspace',
    ownerOperationId: null, bindingSha256: null });
  const remnant = deriveWorkspaceDeletionPayloadPaths(f.root, header, deletionTestRecord())[0]!;
  const workspace = deriveWorkspaceDeletionPayloadPaths(f.root, header, workspaceDraft)[0]!;
  const other = deriveWorkspaceDeletionPayloadPaths(f.root, { ...header, workspaceId: id(90) }, workspaceDraft)[0]!;
  for (const paths of [remnant, workspace, other]) {
    for (const parent of paths.ancestors) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      await chmod(parent, 0o700);
    }
    await mkdir(paths.sourcePath, { mode: 0o700 });
    await writeFile(join(paths.sourcePath, 'payload.txt'), paths === other ? 'other-company' : 'selected-payload', { mode: 0o600 });
  }
  const evidenceParent = deriveWorkspaceInspectionRemnantParents(f.root, header.workspaceId)
    .find(location => location.scope === 'workspace')!;
  for (const parent of evidenceParent.ancestors) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
  }
  const evidenceRoot = join(evidenceParent.parentPath, profileInspectionCopyDirectoryName(id(1001)));
  await mkdir(evidenceRoot, { mode: 0o700 });
  await writeFile(join(evidenceRoot, 'evidence.txt'), 'retained-inspection-evidence', { mode: 0o600 });
  const identity = async (path: string) => (await nodeFileSystem.entry(path, false, assertAuthority))!.identity;
  const remnantRecord = captureDeletionInventoryPayloadRecord({ ...deletionTestRecord(),
    rootIdentity: await identity(remnant.sourcePath), parentIdentity: await identity(remnant.parentPath) });
  const evidenceRecord = captureDeletionInventoryRecord({ ...deletionTestRecord(), role: 'inspectionEvidence', generationId: id(1001),
    rootIdentity: await identity(evidenceRoot), parentIdentity: await identity(evidenceParent.parentPath) });
  const workspaceRecord = captureDeletionInventoryPayloadRecord({ ...workspaceDraft,
    rootIdentity: await identity(workspace.sourcePath), parentIdentity: await identity(workspace.parentPath) });
  async function* records() { yield remnantRecord; yield evidenceRecord; yield workspaceRecord; }
  const inventory = await f.store().publish(header, records(), publicationAuthority);
  const journalPaths = createWorkspaceDeletionJournalPaths(f.root);
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...inventory });
  const journalStore = new WorkspaceDeletionJournalStore(f.root);
  await journalStore.publish(journal, { ...publicationAuthority, slots: (await journalStore.inspect(assertAuthority)).slots });
  const baseline = await journalStore.inspect(assertAuthority);
  expect(baseline.plan).toMatchObject({ mode: 'published', selected: journal });
  const inventoryBytes = await readFile(f.paths.currentPath);
  const journalBytes = await readFile(journalPaths.currentPath);
  const fileSystem = { ...nodeFileSystem, move: vi.fn(nodeFileSystem.move), syncParent: vi.fn(nodeFileSystem.syncParent) };
  const delivered: string[] = [];
  const outcomes: string[] = [];
  const observations = { journalChecks: 0 };
  const selectionLost = () => { throw new Error('SYNTHETIC_JOURNAL_SELECTION_LOST'); };
  async function assertJournal(reader: WorkspaceDeletionJournalStore) {
    assertAuthority();
    const current = await reader.inspect(assertAuthority);
    observations.journalChecks++;
    if (current.plan.mode !== 'published' || current.plan.selected.phase !== 'authorized' ||
        !serializeWorkspaceDeletionJournal(current.plan.selected).equals(journalBytes)) selectionLost();
    for (const slot of ['current', 'backup', 'next'] as const) {
      const expected = baseline.slots[slot], actual = current.slots[slot];
      if (expected === undefined) { if (actual !== undefined) selectionLost(); }
      else if (actual === undefined || expected.identity === undefined || actual.identity === undefined ||
          !sameCrashSafeFileSlotIdentity(expected.identity, actual.identity) ||
          !Buffer.from(expected.bytes).equals(Buffer.from(actual.bytes))) selectionLost();
    }
    assertAuthority();
  }
  async function run(afterPayload?: () => Promise<void>) {
    delivered.length = 0;
    outcomes.length = 0;
    // A new invocation opens new stores, but must not adopt changed journal selection or inventory.
    const reader = new WorkspaceDeletionJournalStore(f.root);
    const assertExternalSelection = () => assertJournal(reader);
    let activeRow: WorkspaceDeletionInventoryRecord | undefined;
    await f.store().consumeSelectedRecords(inventory, { assertAuthority, assertExternalSelection }, async row => {
      delivered.push(row.role);
      if (row.role === 'inspectionEvidence') { outcomes.push('evidence'); return; }
      activeRow = row;
      try {
        outcomes.push(await quarantineWorkspaceDeletionPayload(f.root, journal, row, {
          assertAuthority,
          async assertSelected(selectedJournal, selectedRow) {
            await assertExternalSelection();
            if (activeRow === undefined || !deletionInventoryLine(activeRow).equals(deletionInventoryLine(selectedRow)) ||
                !serializeWorkspaceDeletionJournal(selectedJournal).equals(journalBytes)) selectionLost();
          },
        }, fileSystem));
        await afterPayload?.();
      } finally { activeRow = undefined; }
    });
  }
  async function assertPreserved(workspaceMoved: boolean) {
    expect(await readFile(join(other.sourcePath, 'payload.txt'), 'utf8')).toBe('other-company');
    const root = workspaceMoved ? join(workspace.quarantinePath, relative(workspace.sourcePath, evidenceRoot)) : evidenceRoot;
    expect(await identity(root)).toBe(evidenceRecord.rootIdentity);
    expect(await readFile(join(root, 'evidence.txt'), 'utf8')).toBe('retained-inspection-evidence');
    expect(await readFile(join(workspaceMoved ? workspace.quarantinePath : workspace.sourcePath, 'payload.txt'), 'utf8'))
      .toBe('selected-payload');
    expect(f.handles.closed).toBe(f.handles.opened);
  }
  return { ...f, runtime, assertAuthority, publicationAuthority, inventory, inventoryBytes, journal, journalPaths, journalBytes,
    baseline, remnant, workspace, remnantRecord, workspaceRecord, fileSystem, delivered, outcomes, observations,
    run, identity, assertPreserved, assertJournal: () => assertJournal(new WorkspaceDeletionJournalStore(f.root)) };
}

it('retains authorized evidence after lost rename acknowledgement and reconsumes the same inventory to resume', async context => {
  const f = await fixture(context);
  const failure = new Error('SYNTHETIC_RENAME_ACK_LOST');
  const opened = f.handles.opened;
  f.fileSystem.move.mockImplementationOnce(async (...args) => { await nodeFileSystem.move(...args); throw failure; });
  await expect(f.run()).rejects.toBe(failure);
  expect(f.delivered).toEqual(['activationFailed']);
  expect(f.fileSystem.syncParent).not.toHaveBeenCalled();
  expect(await f.identity(f.remnant.quarantinePath)).toBe(f.remnantRecord.rootIdentity);
  await expect(readFile(join(f.remnant.sourcePath, 'payload.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.paths.currentPath)).toEqual(f.inventoryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  await f.assertJournal();
  await f.assertPreserved(false);

  await f.run();
  expect(f.delivered).toEqual(['activationFailed', 'inspectionEvidence', 'workspace']);
  expect(f.outcomes).toEqual(['alreadyMoved', 'evidence', 'moved']);
  expect(f.fileSystem.move.mock.calls).toEqual([
    [f.remnant.sourcePath, f.remnant.quarantinePath], [f.workspace.sourcePath, f.workspace.quarantinePath],
  ]);
  expect(f.fileSystem.syncParent).toHaveBeenCalledTimes(2);
  expect(await f.identity(f.remnant.quarantinePath)).toBe(f.remnantRecord.rootIdentity);
  expect(await f.identity(f.workspace.quarantinePath)).toBe(f.workspaceRecord.rootIdentity);
  expect(await readFile(join(f.remnant.quarantinePath, 'payload.txt'), 'utf8')).toBe('selected-payload');
  expect(await readFile(f.paths.currentPath)).toEqual(f.inventoryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(f.handles.opened - opened).toBe(2);
  expect(f.observations.journalChecks).toBeGreaterThan(f.fileSystem.move.mock.calls.length);
  await f.assertJournal();
  await f.assertPreserved(true);
});

it('rejects an invalid inventory tail before delivering any row or moving any payload', async context => {
  const f = await fixture(context);
  const invalid = Buffer.concat([f.inventoryBytes.subarray(0, -1), Buffer.from('{')]);
  await writeFile(f.paths.currentPath, invalid);
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(f.delivered).toEqual([]);
  expect(f.fileSystem.move).not.toHaveBeenCalled();
  expect(f.fileSystem.syncParent).not.toHaveBeenCalled();
  expect(await readFile(f.paths.currentPath)).toEqual(invalid);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await f.identity(f.remnant.sourcePath)).toBe(f.remnantRecord.rootIdentity);
  await f.assertJournal();
  await f.assertPreserved(false);
});

it.for(['phase', 'same-byte replacement'] as const)('stops the next row when journal %s changes with a valid lease', async (change, context) => {
  const f = await fixture(context);
  const retained = join(f.root, 'retained-authorized-journal.json');
  await expect(f.run(async () => {
    if (change === 'phase') {
      const store = new WorkspaceDeletionJournalStore(f.root);
      // Synthetic external phase change, not an executor decision that quarantine has completed.
      await store.advance(captureWorkspaceDeletionJournal({ ...f.journal, phase: 'quarantined' }),
        { ...f.publicationAuthority, slots: (await store.inspect(f.assertAuthority)).slots });
    } else {
      await rename(f.journalPaths.currentPath, retained);
      await writeFile(f.journalPaths.currentPath, f.journalBytes, { mode: 0o600, flag: 'wx' });
    }
  })).rejects.toThrow('SYNTHETIC_JOURNAL_SELECTION_LOST');
  expect(() => f.assertAuthority()).not.toThrow();
  expect(f.runtime).toEqual({ mainOwned: true, writerAbsent: true });
  expect(f.delivered).toEqual(['activationFailed']);
  expect(f.fileSystem.move.mock.calls).toEqual([[f.remnant.sourcePath, f.remnant.quarantinePath]]);
  expect(await f.identity(f.remnant.quarantinePath)).toBe(f.remnantRecord.rootIdentity);
  expect(await readFile(f.paths.currentPath)).toEqual(f.inventoryBytes);
  const current = await new WorkspaceDeletionJournalStore(f.root).inspect(f.assertAuthority);
  expect(current.plan).toMatchObject({ mode: 'published', selected: { phase: change === 'phase' ? 'quarantined' : 'authorized' } });
  if (change === 'same-byte replacement') {
    expect(await readFile(retained)).toEqual(f.journalBytes);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    expect(sameCrashSafeFileSlotIdentity(f.baseline.slots.current!.identity!, current.slots.current!.identity!)).toBe(false);
  }
  await f.assertPreserved(false);
});
