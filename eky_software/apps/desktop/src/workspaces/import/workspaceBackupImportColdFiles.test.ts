import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { createImportBindingFixture, importBindingOperationId, importBindingWorkspaceId } from './workspaceBackupImportBindingTestSupport.js';
import { WorkspaceBackupImportJournalStore } from './workspaceBackupImportJournalStore.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from './workspaceBackupImportJournalPaths.js';
import { createNodeWorkspaceBackupImportJournalFileSystem } from './workspaceBackupImportJournalFileSystem.js';
import { validateWorkspaceBackupImportJournal } from './workspaceBackupImportJournalValidation.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportRecovery } from './workspaceBackupImportRecovery.js';
import { WorkspaceBackupImportColdContext } from './workspaceBackupImportColdContext.js';
import { WorkspaceBackupPlaintextQuarantine } from './workspaceBackupPlaintextQuarantine.js';
import { NodeWorkspaceBackupImportRootStore } from './workspaceBackupImportRootStore.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { assertColdWorkspaceRecoveryAdmissionFromRoot } from '../runtime/workspaceColdRecoveryAdmissionComposition.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import type { CaptureWorkspaceBackupImportColdOwner, WorkspaceBackupImportColdOwner } from './workspaceBackupImportColdOwner.js';
import type { WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { RecordingWorkspaceBackupCandidate } from './workspaceBackupImportTestSupport.js';

// Actual metadata/root/quarantine files and exact in-memory lease. Candidate,
// main reservation and the repeated foreign-conflict check are explicitly modeled.
async function fixture(context: TestContext, input: { bound?: boolean; slot?: 'current' | 'backup' | 'next'; plaintext?: boolean;
  state?: 'prepared' | 'candidateValidated' } = {}) {
  const f = await createImportBindingFixture(context);
  const previous = deriveWorkspaceRoot(f.root, f.original.activeWorkspaceId!, 1).workspaceRoot;
  await mkdir(previous, { recursive: true, mode: 0o700 });
  const journalPaths = createWorkspaceBackupImportJournalPaths(f.root, join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME));
  const journalFs = createNodeWorkspaceBackupImportJournalFileSystem(journalPaths);
  const journal = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: journalPaths.currentPath, fileSystem: journalFs });
  const value = validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId: importBindingOperationId,
    workspaceId: importBindingWorkspaceId, workspaceLabel: 'Synthetic cold imported',
    previousActiveWorkspaceId: f.original.activeWorkspaceId, state: input.state ?? 'prepared', createdAt: '2026-10-29T09:00:00.000Z',
    lineageIdentity: input.state === 'candidateValidated' ? f.options.lineageIdentity : null });
  // Seed the persisted crash state, not a new live journal transition.
  await writeFile(journalPaths.currentPath, serializeWorkspaceBackupImportJournal(value), { flag: 'wx', mode: 0o600 });
  const paths = deriveWorkspaceBackupImportPaths(f.root, value.operationId, value.workspaceId);
  const rootStore = new NodeWorkspaceBackupImportRootStore(); await rootStore.createCandidate(paths);
  if (input.state === 'candidateValidated') {
    await writeFile(paths.databaseFilePath, 'synthetic published database', { flag: 'wx', mode: 0o600 });
    await rootStore.publishCandidate(paths);
  }
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport',
    operationId: value.operationId, workspaceId: value.workspaceId, lineageIdentity: f.options.lineageIdentity });
  const bindingStore = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding), f.fileSystem);
  const before = f.lease.captureCurrentOwner(['import'], f.held);
  const authority = { assertAuthority: before, async assertExternalSelection() { before(); } };
  if (input.bound) await bindingStore.publish(binding, authority);
  if (input.slot && input.slot !== 'current') await rename(journalPaths.currentPath, journalPaths[`${input.slot}Path`]);
  const quarantine = new WorkspaceBackupPlaintextQuarantine({ userDataRoot: f.root });
  const plaintext = input.plaintext ? await quarantine.createPayloadPath() : undefined;
  if (plaintext) await writeFile(plaintext, 'synthetic cold plaintext', { flag: 'wx', mode: 0o600 });
  await f.held.release();
  const state = { generation: 1, mainOwned: true, foreignConflict: false };
  const failures: unknown[] = [];
  const captureColdOwner: CaptureWorkspaceBackupImportColdOwner = held => {
    const lease = f.lease.captureCurrentOwner(['import'], held);
    const generation = state.generation;
    let failed: { error: unknown } | undefined;
    const current = () => { if (failed) throw failed.error; lease(); if (state.generation !== generation) throw new Error('SYNTHETIC_STALE_MAIN'); };
    current();
    return { assertCurrent: current, async assertMainOwned() { lease(); if (!state.mainOwned) throw new Error('SYNTHETIC_MAIN_NOT_OWNED'); },
      async assertRecoveryConflicts() { current(); if (state.foreignConflict) throw new Error('SYNTHETIC_FOREIGN_RECOVERY'); },
      onUncertain(error) { failed ??= { error }; failures.push(error); } };
  };
  const absence = { async assertNoActiveWorkspaceRuntime() { if (!state.mainOwned) throw new Error('SYNTHETIC_RUNTIME_PRESENT'); } };
  const candidate = new RecordingWorkspaceBackupCandidate([]);
  candidate.readiness = { ...candidate.readiness, lineageIdentity: f.options.lineageIdentity };
  const options = { completionMode: 'beforeRuntimeStart' as const, captureColdOwner, importJournal: journal, registry: f.registry,
    assertRecoveryAdmission: () => assertColdWorkspaceRecoveryAdmissionFromRoot(f.root, 'import'),
    maintenanceLease: f.lease, plaintextQuarantine: quarantine, rootStore, userDataRoot: f.root,
    workspaceRuntimeAbsence: absence, backupCandidate: candidate };
  return { ...f, journal, journalPaths, journalFs, rootStore, bindingStore, binding, bindingPaths: f.paths, paths, state, failures, options,
    plaintext, quarantine, captureColdOwner, absence, createRecovery: () => new WorkspaceBackupImportRecovery(options) };
}

it.for([false, true])('actual cold discard retires metadata only after root cleanup, bound=%s', async (bound, test) => {
  const f = await fixture(test, { bound, plaintext: true });
  const other = join(f.root, 'unrelated'); await writeFile(other, 'preserve unrelated bytes');
  await expect(f.createRecovery().recover()).resolves.toBe('discardedBeforePublication');
  expect((await f.journal.inspectRecoverySelection(() => {})).source).toBeUndefined();
  const held = await f.lease.acquire('import'); const assertAuthority = f.lease.captureCurrentOwner(['import'], held);
  expect((await f.bindingStore.inspect({ assertAuthority, async assertExternalSelection() { assertAuthority(); } })).mode).toBe('absent');
  await held.release();
  expect((await readFile(other)).toString()).toBe('preserve unrelated bytes');
  expect(await f.registry.read()).toEqual(f.original);
  await f.quarantine.assertNoStalePayloads();
  expect(f.failures).toEqual([]);
});

it.for(['backup', 'next'] as const)('actual cold import preserves interrupted initial %s publication recovery', async (slot, test) => {
  const f = await fixture(test, { slot });
  await expect(f.createRecovery().recover()).resolves.toBe('discardedBeforePublication');
  expect((await f.journal.inspectRecoverySelection(() => {})).source).toBeUndefined();
  expect(await f.registry.read()).toEqual(f.original);
});

it('lost binding-clear reply preserves the journal and permits only a new independently admitted cold owner', async test => {
  const f = await fixture(test, { bound: true }); const first = new Error('SYNTHETIC_BINDING_REPLY_LOST');
  const original = WorkspaceRemnantBindingStore.prototype.clearAfterPayloadsAbsent;
  const hook = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, value, proof) {
    await original.call(this, value, proof); throw first;
  });
  try { await expect(f.createRecovery().recover()).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' }); }
  finally { hook.mockRestore(); }
  expect(f.failures[0]).toBe(first);
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('prepared');
  f.state.generation++;
  await expect(f.createRecovery().recover()).resolves.toBe('discardedBeforePublication');
  expect((await f.journal.inspectRecoverySelection(() => {})).source).toBeUndefined();
});

it('a pending original task prevents lease release and its late result cannot reauthorize work', async test => {
  const f = await fixture(test); const held = await f.lease.acquire('import');
  const scope = new WorkspaceBackupImportColdContext({ owner: f.captureColdOwner(held), importJournal: f.journal,
    registry: f.registry, rootStore: f.rootStore, workspaceRuntimeAbsence: f.absence, userDataRoot: f.root });
  await scope.initialize();
  let entered!: () => void, finish!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const task = scope.work(async () => { entered(); await gate; return 'late'; }); const rejected = expect(task).rejects.toThrow();
  await began; expect((await scope.release(held)).failed).toBe(true);
  expect(f.lease.readState()).toBe('busy'); finish(); await rejected;
  await expect(scope.readJournal()).rejects.toThrow();
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('prepared');
  await held.release();
});

it.for(['registry', 'binding'] as const)('rejects real %s byte drift without deleting the candidate or journal', async (kind, test) => {
  const f = await fixture(test, { bound: true }); const held = await f.lease.acquire('import');
  const scope = new WorkspaceBackupImportColdContext({ owner: f.captureColdOwner(held), importJournal: f.journal,
    registry: f.registry, rootStore: f.rootStore, workspaceRuntimeAbsence: f.absence, userDataRoot: f.root });
  await scope.initialize();
  const path = kind === 'registry' ? f.registryPaths.currentPath : f.bindingPaths.currentPath;
  const changed = Buffer.concat([await readFile(path), Buffer.from('\n')]);
  await writeFile(path, changed);
  await expect(scope.assertPayloadCurrent()).rejects.toThrow();
  expect((await f.rootStore.readPresence(f.paths)).candidateExists).toBe(true);
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('prepared');
  await expect(readFile(path)).resolves.toEqual(changed);
  expect((await scope.release(held)).failed).toBe(false);
});

it('a lost real journal-write reply revokes the old scope even when the new bytes are readable', async test => {
  const f = await fixture(test); const held = await f.lease.acquire('import');
  const scope = new WorkspaceBackupImportColdContext({ owner: f.captureColdOwner(held), importJournal: f.journal,
    registry: f.registry, rootStore: f.rootStore, workspaceRuntimeAbsence: f.absence, userDataRoot: f.root });
  await scope.initialize();
  const before = (await f.journal.inspectRecoverySelection(() => {})).value!;
  const first = new Error('SYNTHETIC_JOURNAL_REPLY_LOST');
  const write = f.journal.writeSelected.bind(f.journal);
  const hook = vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => {
    await write(...args); throw first;
  });
  try { await expect(scope.writeJournal({ ...before, state: 'candidateRootCreated' })).rejects.toBe(first); }
  finally { hook.mockRestore(); }
  expect(f.failures[0]).toBe(first);
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('candidateRootCreated');
  await expect(scope.readJournal()).rejects.toBe(first);
  expect((await scope.release(held)).failed).toBe(false);
  f.state.generation++;
  await expect(f.createRecovery().recover()).resolves.toBe('discardedBeforePublication');
});

it('records the original quarantine failure before converting it to the safe recovery error', async test => {
  const f = await fixture(test, { plaintext: true }); const first = new Error('SYNTHETIC_QUARANTINE_FIRST');
  const hook = vi.spyOn(f.quarantine, 'recoverStalePayloads').mockRejectedValueOnce(first);
  try { await expect(f.createRecovery().recover()).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' }); }
  finally { hook.mockRestore(); }
  expect(f.failures[0]).toBe(first);
  await expect(readFile(f.plaintext!)).resolves.toEqual(Buffer.from('synthetic cold plaintext'));
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('prepared');
});

it.for(['binding', 'foreignConflict'] as const)(
  'preserves the first %s failure detected inside a real selected journal write', async (kind, test) => {
    const f = await fixture(test, { bound: true, state: 'candidateValidated' });
    const firstConflict = new WorkspaceManagementRecoveryRequiredError();
    const later = new Error('SYNTHETIC_RELEASE_AFTER_SELECTED_FAILURE');
    let conflict = false, captured!: WorkspaceMaintenanceLeaseHandle;
    const before = await readFile(f.journalPaths.currentPath);
    const bindingBefore = await readFile(f.bindingPaths.currentPath);
    const write = f.journal.writeSelected.bind(f.journal);
    const hook = vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => {
      if (kind === 'binding') await writeFile(f.bindingPaths.currentPath, Buffer.concat([bindingBefore, Buffer.from('\n')]));
      else conflict = true;
      return write(...args);
    });
    const recovery = new WorkspaceBackupImportRecovery({ ...f.options, captureColdOwner(held: WorkspaceMaintenanceLeaseHandle) {
      captured = held;
      const owner = f.captureColdOwner(held);
      return { ...owner, async assertRecoveryConflicts(input: Parameters<WorkspaceBackupImportColdOwner['assertRecoveryConflicts']>[0]) {
        if (conflict) throw firstConflict;
        await owner.assertRecoveryConflicts(input);
      }, async assertMainOwned() {
        if (f.failures.length !== 0) throw later;
        await owner.assertMainOwned();
      } };
    } });
    try {
      const error = await recovery.recover().then(() => undefined, cause => cause as Error);
      expect(hook).toHaveBeenCalledOnce();
      if (kind === 'binding') {
        expect(error).toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' });
        expect(f.failures[0]).toBe(error);
      } else {
        expect(error).toBe(firstConflict);
        expect(f.failures[0]).toBe(firstConflict);
      }
      expect(f.failures[1]).toBe(later);
      expect(f.lease.readState()).toBe('busy');
      await expect(readFile(f.journalPaths.currentPath)).resolves.toEqual(before);
      await expect(readFile(f.paths.publishedDatabaseFilePath, 'utf8')).resolves.toBe('synthetic published database');
      await expect(f.registry.read()).resolves.toEqual(f.original);
    } finally { hook.mockRestore(); if (captured) await captured.release(); }
  },
);

it('keeps the original recovery failure separate from later physical-release uncertainty', async test => {
  const f = await fixture(test);
  const first = new Error('SYNTHETIC_RECOVERY_FIRST'); const later = new Error('SYNTHETIC_RELEASE_LATER');
  let captured!: WorkspaceMaintenanceLeaseHandle;
  const root = vi.spyOn(f.rootStore, 'discardCandidate').mockRejectedValueOnce(first);
  const recovery = new WorkspaceBackupImportRecovery({ ...f.options, captureColdOwner(held: WorkspaceMaintenanceLeaseHandle) {
    captured = held;
    const owner = f.captureColdOwner(held);
    return { ...owner, async assertMainOwned() {
      if (f.failures.length !== 0) throw later;
      await owner.assertMainOwned();
    } };
  } });
  try { await expect(recovery.recover()).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' }); }
  finally { root.mockRestore(); }
  expect(f.failures[0]).toBe(first); expect(f.failures[1]).toBe(later);
  expect(f.lease.readState()).toBe('busy');
  expect((await f.journal.inspectRecoverySelection(() => {})).value?.state).toBe('prepared');
  expect((await f.rootStore.readPresence(f.paths)).candidateExists).toBe(true);
  // No native process exists in this fixture; all modeled tasks have settled.
  await captured.release();
});
