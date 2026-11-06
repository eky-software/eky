import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vitest';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { createImportBindingFixture, importBindingOperationId, importBindingWorkspaceId } from './workspaceBackupImportBindingTestSupport.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import { validateWorkspaceBackupImportJournal } from './workspaceBackupImportJournalValidation.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';

// Real metadata owners; not the coordinator, native ownership or full import.
async function fixture(context: TestContext) {
  const f = await createImportBindingFixture(context);
  const paths = createWorkspaceBackupImportJournalPaths(f.root, join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
  const store = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: paths.currentPath });
  const journal = validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId: importBindingOperationId,
    workspaceId: importBindingWorkspaceId, workspaceLabel: 'Imported synthetic',
    previousActiveWorkspaceId: f.original.activeWorkspaceId, state: 'prepared',
    createdAt: '2026-10-29T09:00:00.000Z', lineageIdentity: null });
  const bytes = Buffer.from(serializeWorkspaceBackupImportJournal(journal));
  const assertCurrent = f.lease.captureCurrentOwner(['import'], f.held);
  const identity = await store.writeSelected(journal, {
    expectedSlots: { current: undefined, next: undefined, backup: undefined },
    expectedIdentities: { current: undefined, next: undefined, backup: undefined },
    assertAuthority: assertCurrent,
    async assertExternalSelection() { assertCurrent(); await f.assertAbsent(); await f.assertOwned(); assertCurrent(); },
  });
  const selected = async () => {
    const found = await store.inspectSlots(assertCurrent);
    if (!found.current?.identity || found.next || found.backup ||
      !Buffer.from(found.current.bytes).equals(bytes) || !sameCrashSafeFileSlotIdentity(identity, found.current.identity)) {
      throw new Error('SYNTHETIC_JOURNAL_SELECTION_CHANGED');
    }
  };
  f.checkInitialJournal.mockImplementation(selected);
  f.checkJournal.mockImplementation(selected);
  return { ...f, journalPaths: paths, store, journal, bytes, identity, assertCurrent };
}

it('clears the real selected journal only after acknowledged metadata retirement without recursive journal reads', async context => {
  const f = await fixture(context);
  await f.binding.publish();
  await f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal);
  f.checkJournal.mockClear(); f.checkInitialJournal.mockClear();
  await f.store.discardBeforePublicationSelected(f.journal.operationId, {
    expectedSlots: { current: f.bytes, next: undefined, backup: undefined },
    expectedIdentities: { current: f.identity, next: undefined, backup: undefined },
    assertAuthority: f.assertCurrent,
    assertExternalSelection: () => f.binding.assertRetired(async () => {}),
  });
  expect(await f.store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
  expect(f.checkJournal).not.toHaveBeenCalled();
  expect(f.checkInitialJournal).not.toHaveBeenCalled();
  expect((await f.registry.inspectSlots()).current?.value).toEqual(f.original);
  expect(f.onUncertain).not.toHaveBeenCalled();
});

it.for(['identity', 'next', 'backup'] as const)('rejects real journal %s changes before binding publication', async (change, context) => {
  const f = await fixture(context);
  if (change === 'identity') {
    await rename(f.journalPaths.currentPath, `${f.root}/retained-journal`);
    await writeFile(f.journalPaths.currentPath, f.bytes, { flag: 'wx' });
  } else await writeFile(f.journalPaths[`${change}Path`], f.bytes, { flag: 'wx' });
  await expect(f.binding.publish()).rejects.toThrow('SYNTHETIC_JOURNAL_SELECTION_CHANGED');
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.bytes);
  if (change !== 'identity') expect(await readFile(f.journalPaths[`${change}Path`])).toEqual(f.bytes);
  expect(f.onUncertain).toHaveBeenCalledOnce();
});

it('retains the real journal and binding when terminal selection changes before metadata cleanup', async context => {
  const f = await fixture(context); await f.binding.publish();
  const bindingBytes = await readFile(f.paths.currentPath);
  await rename(f.journalPaths.currentPath, `${f.root}/retained-journal`);
  await writeFile(f.journalPaths.currentPath, f.bytes, { flag: 'wx' });
  await expect(f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal)).rejects.toThrow('SYNTHETIC_JOURNAL_SELECTION_CHANGED');
  expect(await readFile(f.paths.currentPath)).toEqual(bindingBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.bytes);
  expect((await f.registry.inspectSlots()).current?.value).toEqual(f.original);
});

it.for(['registry', 'payload'] as const)('retains the selected journal when %s proof fails after retirement', async (change, context) => {
  const f = await fixture(context); await f.binding.publish();
  await f.binding.clearAfterPayloadsAbsent(async () => {}, f.checkJournal);
  const primary = new Error('SYNTHETIC_PAYLOAD_NO_LONGER_ABSENT');
  if (change === 'registry') await writeFile(f.registryPaths.nextPath,
    await readFile(f.registryPaths.currentPath), { flag: 'wx' });
  await expect(f.store.discardBeforePublicationSelected(f.journal.operationId, {
    expectedSlots: { current: f.bytes, next: undefined, backup: undefined },
    expectedIdentities: { current: f.identity, next: undefined, backup: undefined },
    assertAuthority: f.assertCurrent,
    assertExternalSelection: () => f.binding.assertRetired(async () => { if (change === 'payload') throw primary; }),
  })).rejects.toThrow('WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE');
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.bytes);
  expect(f.onUncertain).toHaveBeenCalledOnce();
  await expect(f.binding.assertRetired(async () => {})).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
  if (change === 'payload') await expect(f.binding.assertRetired(async () => {})).rejects.toMatchObject({ cause: primary });
  else expect(await readFile(f.registryPaths.nextPath)).toEqual(await readFile(f.registryPaths.currentPath));
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.bytes);
});

it.for(['cleaned', 'inspectionRemains'] as const)('uses the root owner whole-operation proof before retiring binding: %s', async (mode, context) => {
  const f = await fixture(context); await f.binding.publish();
  const rootStore = new NodeWorkspaceBackupImportRootStore();
  const paths = deriveWorkspaceBackupImportPaths(f.root, f.journal.operationId, f.journal.workspaceId);
  const authority = { assertCurrent: () => f.binding.assertPublished(), assertMutationCurrent: () => f.binding.assertMutationCurrent() };
  await rootStore.createCandidate(paths, authority);
  await rootStore.discardCandidate(paths, authority);
  const absent = () => rootStore.assertOperationAbsent(paths, f.assertCurrent);
  if (mode === 'inspectionRemains') {
    const inspection = join(paths.operationRoot, 'inspection');
    await mkdir(inspection, { recursive: true, mode: 0o700 });
    const evidence = join(inspection, 'retained'); await writeFile(evidence, 'synthetic inspection evidence');
    const bindingBytes = await readFile(f.paths.currentPath);
    await expect(f.binding.clearAfterPayloadsAbsent(absent, f.checkJournal)).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    expect(await readFile(evidence, 'utf8')).toBe('synthetic inspection evidence');
    expect(await readFile(f.paths.currentPath)).toEqual(bindingBytes);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.bytes);
    expect(f.onUncertain).toHaveBeenCalledOnce();
    return;
  }
  await f.binding.clearAfterPayloadsAbsent(absent, f.checkJournal);
  await f.store.discardBeforePublicationSelected(f.journal.operationId, {
    expectedSlots: { current: f.bytes, next: undefined, backup: undefined },
    expectedIdentities: { current: f.identity, next: undefined, backup: undefined },
    assertAuthority: f.assertCurrent, assertExternalSelection: () => f.binding.assertRetired(absent),
  });
  expect(await f.store.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
  expect(f.onUncertain).not.toHaveBeenCalled();
});
