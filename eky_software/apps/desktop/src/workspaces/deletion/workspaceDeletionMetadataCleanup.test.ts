import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { WorkspaceLegacyAdoptionJournalStore, createWorkspaceLegacyAdoptionJournalPaths,
  serializeWorkspaceLegacyAdoptionJournal } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { createAdoptionJournal } from '../adoption/workspaceLegacyAdoptionTestSupport.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { serializeWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalSerializer.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME, createWorkspaceBackupImportJournalPaths } from '../import/workspaceBackupImportJournalPaths.js';
import { createNodeWorkspaceBackupImportJournalFileSystem } from '../import/workspaceBackupImportJournalFileSystem.js';
import type { CrashSafeByteSlotReadSelection } from '../persistence/crashSafeByteSlotStore.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { deriveWorkspaceBackupImportPaths } from '../import/workspaceBackupImportPaths.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES, validateWorkspaceBackupImportJournal } from '../import/workspaceBackupImportJournalValidation.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { readDeletionInventoryDirectoryIdentity as identity } from './workspaceDeletionInventoryFile.js';
import { createWorkspaceDeletionInventoryPaths, WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { parseWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { captureWorkspaceDeletionOriginalJournals } from './workspaceDeletionOriginalJournalSelection.js';
import * as originalPayloadAbsence from './workspaceDeletionOriginalPayloadAbsence.js';
import * as metadataCleanup from './workspaceDeletionMetadataCleanup.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { captureWorkspaceDeletionMetadataPostClearTestFailure } from './workspaceDeletionFinalizationTestSupport.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type FixtureOwner = 'workspaceImport' | 'workspaceLegacyAdoption' | 'workspaceReplacement' | 'workspaceActivationMigration';

async function fixture(test: TestContext, owner: FixtureOwner = 'workspaceImport',
  secondOwner?: 'workspaceLegacyAdoption' | 'workspaceReplacement', payloadlessOriginal = false,
  options: Readonly<{ coldSelection?: boolean; foreignOwner?: FixtureOwner }> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-metadata-')); await chmod(root, 0o700);
  let active = true; const jobs: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const first = new Error('SYNTHETIC_METADATA_OWNER_LOST');
  const assertCurrent = () => { test.signal.throwIfAborted(); if (!active) throw first; };
  const authority = { assertCurrent, async assertOwned() { assertCurrent(); } };
  const external = { assertAuthority: assertCurrent, async assertExternalSelection() { assertCurrent(); } };
  test.onTestFinished(async () => {
    active = false; for (const release of releases) release(); await Promise.allSettled(jobs); vi.restoreAllMocks();
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const prepared = (async () => {
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME), registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const before = { ...createSwitchRegistry(), formatVersion: 2 as const }; await registry.write(before);
  const target = before.workspaces.find(value => value.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: target.workspaceId,
    expectedActiveWorkspaceId: before.activeWorkspaceId });
  const header = captureDeletionInventoryHeader({ ...deletionTestJournal().target, operationId: id(200), workspaceId: target.workspaceId,
    lineageIdentity: target.lineageIdentity, registryEntrySha256: workspaceRegistryEntrySha256(target) });
  const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: id(201),
    workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
  const bindingStore = new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(binding));
  await bindingStore.publish(binding, external);
  const paths = deriveWorkspaceBackupImportPaths(root, validateWorkspaceBackupImportOperationId(binding.operationId), target.workspaceId);
  const replacement = owner === 'workspaceReplacement' || owner === 'workspaceActivationMigration';
  const payloadRoot = replacement ? deriveWorkspaceReplacementRemnantRoot(root, target.workspaceId, binding.operationId, 'activationFailed').rootPath : paths.candidateRoot;
  const role = replacement ? 'activationFailed' : owner === 'workspaceLegacyAdoption' ? 'adoptionCandidate' : 'importCandidate';
  const workspace = deriveWorkspaceRoot(root, target.workspaceId, 1);
  await mkdir(payloadRoot, { recursive: true, mode: 0o700 }); await mkdir(workspace.workspaceRoot, { recursive: true, mode: 0o700 });
  const rows = [
    captureDeletionInventoryPayloadRecord({ role, ownerOperationId: binding.operationId, generationId: null, member: null,
      rootIdentity: await identity(payloadRoot, assertCurrent), parentIdentity: await identity(dirname(payloadRoot), assertCurrent),
      bindingSha256: workspaceRemnantBindingSha256(binding) }),
    captureDeletionInventoryPayloadRecord({ role: 'workspace', ownerOperationId: null, generationId: null, member: null,
      rootIdentity: await identity(workspace.workspaceRoot, assertCurrent), parentIdentity: await identity(workspace.workspacesRoot, assertCurrent), bindingSha256: null }),
  ];
  const secondBinding = secondOwner === undefined ? undefined : captureWorkspaceRemnantBinding({
    ...binding, owner: secondOwner, operationId: id(205),
  });
  const secondRoot = secondBinding === undefined ? undefined : secondOwner === 'workspaceReplacement'
    ? deriveWorkspaceReplacementRemnantRoot(root, target.workspaceId, secondBinding.operationId, 'activationFailed').rootPath
    : deriveWorkspaceBackupImportPaths(root, validateWorkspaceBackupImportOperationId(secondBinding.operationId), target.workspaceId).candidateRoot;
  if (secondBinding !== undefined && secondRoot !== undefined) {
    await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(secondBinding)).publish(secondBinding, external);
    await mkdir(secondRoot, { recursive: true, mode: 0o700 });
    rows.unshift(captureDeletionInventoryPayloadRecord({
      role: secondOwner === 'workspaceReplacement' ? 'activationFailed' : 'adoptionCandidate',
      ownerOperationId: secondBinding.operationId, generationId: null, member: null,
      rootIdentity: await identity(secondRoot, assertCurrent), parentIdentity: await identity(dirname(secondRoot), assertCurrent),
      bindingSha256: workspaceRemnantBindingSha256(secondBinding),
    }));
  }
  const inventory = await new WorkspaceDeletionInventoryStore(root, header.operationId).publish(header, (async function* () {
    yield* payloadlessOriginal ? rows.filter(row => row.role === 'workspace') : rows;
  })(), external);
  // Purged-state fixture: the separate physical executor must prove the actual moves and payload removal.
  await rmdir(payloadRoot); await rmdir(workspace.workspaceRoot);
  if (secondRoot !== undefined) await rmdir(secondRoot);
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(), ...inventory,
    registryBeforeSha256: digest(await readFile(registryPath)), registryAfterSha256: digest(serializeWorkspaceRegistry(after)),
    previousActiveWorkspaceId: before.activeWorkspaceId });
  const deletionStore = new WorkspaceDeletionJournalStore(root);
  await deletionStore.publish(journal, { ...external, slots: (await deletionStore.inspect(assertCurrent)).slots });
  for (const phase of ['quarantined', 'purgeAuthorized', 'purged'] as const) await deletionStore.advance({ ...journal, phase },
    { ...external, slots: (await deletionStore.inspect(assertCurrent)).slots });
  await registry.write(after);
  const importPath = join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME), importStore = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: importPath });
  let importValue = validateWorkspaceBackupImportJournal({ formatVersion: 2, operationId: binding.operationId, workspaceId: target.workspaceId,
    workspaceLabel: 'Synthetic metadata', createdAt: '2026-11-01T00:00:00.000Z', previousActiveWorkspaceId: null, state: 'prepared', lineageIdentity: null });
  for (const state of owner === 'workspaceImport' ? WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES : []) {
    importValue = validateWorkspaceBackupImportJournal({ ...importValue, state,
      lineageIdentity: ['candidateValidated', 'rootPublished', 'registryPublished'].includes(state) ? binding.lineageIdentity : null });
    await importStore.write(importValue);
  }
  let ownerJournalPath = importPath;
  if (owner === 'workspaceLegacyAdoption') {
    const store = new WorkspaceLegacyAdoptionJournalStore(root);
    const base = { ...createAdoptionJournal('prepared'), operationId: binding.operationId, workspaceId: target.workspaceId };
    for (const state of ['prepared', 'candidatePrepared', 'rootPublished', 'registryPublished', 'recoveryRequired'] as const) await store.write({ ...base, state });
    ownerJournalPath = createWorkspaceLegacyAdoptionJournalPaths(root).currentPath;
  } else if (replacement) {
    ownerJournalPath = deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath;
    const store = new ProfileRestoreActivationJournalStore(ownerJournalPath);
    for (const [revision, phase] of (['prepared', 'rollbackStarting', 'failedSafe'] as const).entries()) await store.write({
      formatVersion: 1, operationId: binding.operationId, hadActiveDatabase: true, hadActiveDocuments: true, phase, revision,
    });
  }
  const foreign = captureWorkspaceRemnantBinding({ ...binding, owner: options.foreignOwner ?? binding.owner, operationId: id(202), workspaceId: before.workspaces[0]!.workspaceId,
    lineageIdentity: before.workspaces[0]!.lineageIdentity });
  await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(foreign)).publish(foreign, external);
  const foreignPath = createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(foreign)).currentPath;
  const foreignBytes = await readFile(foreignPath), keptPath = join(root, 'external-backup'), keptBytes = Buffer.from('preserved synthetic external bytes');
  await writeFile(keptPath, keptBytes, { mode: 0o600, flag: 'wx' });
  const journalPath = createWorkspaceDeletionJournalPaths(root).currentPath, journalBytes = await readFile(journalPath);
  const inventoryPath = createWorkspaceDeletionInventoryPaths(root, header.operationId).currentPath, inventoryBytes = await readFile(inventoryPath);
  const bindingPath = createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(binding)).currentPath, bindingBytes = await readFile(bindingPath);
  const fullProof = vi.fn(async () => { authority.assertCurrent(); });
  const cleaner = createWorkspaceDeletionMetadataCleaner({ userDataRoot: root, registry, async assertWritersAbsent() { assertCurrent(); },
    ...(options.coldSelection ? { assertStableSelection: fullProof } : {}) });
  return { root, target, registry, paths, binding, secondBinding, bindingStore, bindingPath, bindingBytes, importStore, importPath, importValue, ownerJournalPath, journalPath, inventoryPath, authority, first, releases, fullProof,
    revoke() { active = false; },
    track<T>(pending: Promise<T>) { jobs.push(pending); return pending; },
    run() { const result = cleaner(header.operationId, authority); jobs.push(result); return result; },
    async preserved(expectedJournalBytes: Uint8Array = journalBytes) {
      expect(await readFile(journalPath)).toEqual(expectedJournalBytes); expect(await readFile(inventoryPath)).toEqual(inventoryBytes);
      expect(await readFile(foreignPath)).toEqual(foreignBytes); expect(await readFile(keptPath)).toEqual(keptBytes);
      expect(await readFile(registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(after)));
    },
  };
  })();
  jobs.push(prepared); return prepared;
}

async function originalMetadataFixture(test: TestContext, owner: FixtureOwner = 'workspaceImport', options: Readonly<{ coldSelection?: boolean }> = {}) {
  const f = await fixture(test, owner, undefined, true, options);
  return f.track((async () => {
    f.authority.assertCurrent();
    if (owner === 'workspaceImport') await writeFile(`${f.importPath}.backup`, serializeWorkspaceBackupImportJournal(
      validateWorkspaceBackupImportJournal({ ...f.importValue, state: 'rootPublished' })), { flag: 'wx', mode: 0o600 });
    const initial = parseWorkspaceDeletionJournalBytes(await readFile(f.journalPath));
    const writers = async () => { f.authority.assertCurrent(); };
    const phase = await captureWorkspaceDeletionPhaseSelection({ operationId: initial.target.operationId, authority: f.authority,
      journal: new WorkspaceDeletionJournalStore(f.root), registry: f.registry, assertWritersAbsent: writers });
    let original: Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalJournals>> | undefined;
    let bytes: Buffer;
    try {
      original = await captureWorkspaceDeletionOriginalJournals(f.root, initial.target, {
        assertAuthority: phase.assertCurrent, assertExternalSelection: phase.assertSelected, assertWritersAbsent: writers,
      });
      const value = captureWorkspaceDeletionJournal({ ...initial, formatVersion: 2, originalJournalProofs: original.proofs });
      bytes = serializeWorkspaceDeletionJournal(value);
    } finally { original?.revoke(); phase.revoke(); }
    // Synthetic committed purged fixture only; actual V2 publication is covered by the publisher controls.
    await writeFile(f.journalPath, bytes); f.authority.assertCurrent();
    return { ...f, bytes,
      preservedOriginal: () => f.preserved(bytes),
      freshRun() { return f.track(createWorkspaceDeletionMetadataCleaner({ userDataRoot: f.root, registry: f.registry,
        assertWritersAbsent: writers, ...(options.coldSelection ? { assertStableSelection: f.fullProof } : {}) })(initial.target.operationId, f.authority)); },
    };
  })());
}

function observeImportDeletionRead() {
  let selected: CrashSafeByteSlotReadSelection | undefined;
  let inRead = false;
  let clearSettled = false;
  const clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(function (
    this: WorkspaceBackupImportJournalStore, value, authority, readSelection,
  ) {
    expect(readSelection).toBeDefined(); selected = readSelection;
    return clear.call(this, value, authority, { async assertBeforeSlotRead() {
      inRead = true;
      try { return await readSelection!.assertBeforeSlotRead(); } finally { inRead = false; }
    } }).finally(() => { clearSettled = true; });
  });
  return { selected: () => selected, inRead: () => inRead, clearSettled: () => clearSettled };
}

it.for(['firstOwned', 'writers', 'lastOwned'] as const)(
  'import journal read caller retains Error and undefined at %s without retiring evidence',
  { timeout: 30_000 }, async (boundary, test) => {
    for (const first of [undefined, new Error('SYNTHETIC_W75_CALLER_READ_FIRST')]) {
      const create = metadataCleanup.createWorkspaceDeletionMetadataCleaner;
      let measured: ReturnType<typeof observeImportDeletionRead>;
      vi.spyOn(metadataCleanup, 'createWorkspaceDeletionMetadataCleaner').mockImplementationOnce(input => {
        const writers = input.assertWritersAbsent.bind(input);
        return create({ ...input, async assertWritersAbsent() {
          if (measured?.inRead()) {
            sequence.push('writers'); if (boundary === 'writers') throw first;
          }
          await writers();
        } });
      });
      const f = await originalMetadataFixture(test), before = await originalMetadataSlots(f);
      const sequence: string[] = [];
      measured = observeImportDeletionRead();
      const owned = f.authority.assertOwned;
      vi.spyOn(f.authority, 'assertOwned').mockImplementation(async () => {
        if (measured.inRead()) {
          sequence.push('owned');
          if (sequence.length === (boundary === 'firstOwned' ? 1 : boundary === 'lastOwned' ? 3 : -1)) throw first;
        }
        await owned();
      });
      await expect(f.run()).rejects.toBe(first);
      expect(sequence).toEqual(boundary === 'firstOwned' ? ['owned'] : boundary === 'writers' ? ['owned', 'writers'] : ['owned', 'writers', 'owned']);
      expect(await originalMetadataSlots(f)).toEqual(before); await f.preservedOriginal();
      vi.restoreAllMocks();
    }
  },
);

it('import journal read caller waits its held owner after revocation and keeps cleanup exclusive', { timeout: 30_000 }, async test => {
  const create = metadataCleanup.createWorkspaceDeletionMetadataCleaner;
  let measured: ReturnType<typeof observeImportDeletionRead>;
  const sequence: string[] = [];
  vi.spyOn(metadataCleanup, 'createWorkspaceDeletionMetadataCleaner').mockImplementationOnce(input => {
    const writers = input.assertWritersAbsent.bind(input);
    return create({ ...input, async assertWritersAbsent() {
      if (measured?.inRead()) sequence.push('writers');
      await writers();
    } });
  });
  const f = await originalMetadataFixture(test), before = await originalMetadataSlots(f);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; }); f.releases.push(release);
  measured = observeImportDeletionRead();
  const owned = f.authority.assertOwned;
  let heldOnce = false, settled = false;
  vi.spyOn(f.authority, 'assertOwned').mockImplementation(async () => {
    if (measured.inRead() && !heldOnce) {
      heldOnce = true; sequence.push('heldOwner'); entered(); await held;
      // Resolve despite revocation so only the caller can stop the next boundary.
      return;
    }
    if (measured.inRead()) sequence.push('nextOwner');
    await owned();
  });
  const result = f.run().then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('W75_CALLER_READ_NOT_HELD'); })]);
    f.revoke(); await setImmediate(); expect(settled).toBe(false);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(await originalMetadataSlots(f)).toEqual(before);
  } finally { release(); await result; }
  expect(await result).toEqual({ error: f.first });
  expect(sequence).toEqual(['heldOwner']);
  expect(await originalMetadataSlots(f)).toEqual(before); await f.preservedOriginal();
});

it.for(['success', 'failure'] as const)('import journal read caller expires after %s before phase teardown and during a fresh cleanup', { timeout: 30_000 }, async (outcome, test) => {
  const f = await originalMetadataFixture(test), measured = observeImportDeletionRead();
  const first = new Error('SYNTHETIC_W75_CALLER_EXPIRY_FIRST'), original = f.authority.assertOwned;
  let failOnce = outcome === 'failure', holdFresh = false;
  let entered!: () => void, release!: () => void;
  const freshEntered = new Promise<void>(resolve => { entered = resolve; });
  const freshHeld = new Promise<void>(resolve => { release = resolve; }); f.releases.push(release);
  const owned = vi.spyOn(f.authority, 'assertOwned').mockImplementation(async () => {
    if (measured.inRead() && failOnce) { failOnce = false; throw first; }
    if (holdFresh) { holdFresh = false; entered(); await freshHeld; }
    await original();
  }), reads = vi.spyOn(f.registry, 'inspectSlots');
  const assertExpired = async () => {
    const ownerCalls = owned.mock.calls.length, registryCalls = reads.mock.calls.length;
    await expect(measured.selected()!.assertBeforeSlotRead()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(owned).toHaveBeenCalledTimes(ownerCalls); expect(reads).toHaveBeenCalledTimes(registryCalls);
  };
  const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
  let checkedWhileLive = false;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementation(async function (
    this: WorkspaceBackupImportJournalStore, check,
  ) {
    if (outcome === 'success' && measured.clearSettled() && !checkedWhileLive) {
      checkedWhileLive = true; expect(check).toBeTypeOf('function'); check!();
      await assertExpired(); check!();
    }
    return inspect.call(this, check);
  });
  if (outcome === 'failure') await expect(f.run()).rejects.toBe(first);
  else await f.run();
  expect(checkedWhileLive).toBe(outcome === 'success');
  expect(measured.selected()).toBeDefined(); await assertExpired();
  holdFresh = true; let freshSettled = false;
  const fresh = f.freshRun().then(value => { freshSettled = true; return { value }; }, error => { freshSettled = true; return { error }; });
  try {
    await Promise.race([freshEntered, fresh.then(() => { throw new Error('W75_FRESH_CLEANUP_NOT_HELD'); })]);
    expect(freshSettled).toBe(false); await assertExpired();
    expect(freshSettled).toBe(false);
  } finally { release(); await fresh; }
  expect(await fresh).not.toHaveProperty('error');
  await f.preservedOriginal();
});

const originalMetadataOptions = { timeout: 30_000 };
async function originalMetadataSlots(f: Awaited<ReturnType<typeof originalMetadataFixture>>) {
  const paths = [f.ownerJournalPath, f.bindingPath].flatMap(path => ['', '.backup', '.next'].map(suffix => path + suffix));
  return Promise.all(paths.map(async path => {
    try { return (await readFile(path)).toString('hex'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }));
}
function originalMetadataRetirementSpies() {
  return [vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged'),
    vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged'),
    vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged'),
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent')];
}

it('supplies the original-absence read port without retiring any metadata on a read failure', async test => {
  const f = await originalMetadataFixture(test, 'workspaceImport');
  const slots = await originalMetadataSlots(f), retirements = originalMetadataRetirementSpies();
  const original = originalPayloadAbsence.captureWorkspaceDeletionOriginalPayloadAbsence;
  const stop = new Error('SYNTHETIC_STOP_AFTER_ORIGINAL_ABSENCE'); let invoked = false;
  vi.spyOn(originalPayloadAbsence, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementationOnce(async (...args) => {
    invoked = true; expect(args[2].assertReadSelection).toBeTypeOf('function');
    const selected = await original(...args); await selected.assertAbsent(); throw stop;
  });
  await expect(f.run()).rejects.toBe(stop); expect(invoked).toBe(true);
  await f.preservedOriginal(); expect(await originalMetadataSlots(f)).toEqual(slots);
  for (const retire of retirements) expect(retire).not.toHaveBeenCalled();
});

it.for([
  ['firstOwned', 1, false], ['secondOwned', 2, false], ['heldFirstOwned', 1, true], ['heldSecondOwned', 2, true],
  ['writers', 0, false], ['heldWriters', 0, true], ['heldSecondOwnedUndefined', 2, true],
] as const)('retains the first original-absence guard cause and all slots at %s', async ([label, failAt, held], test) => {
  const first = label === 'heldSecondOwnedUndefined' ? undefined : new Error('SYNTHETIC_LIGHT_' + label);
  let entered!: () => void, release!: () => void;
  const observed = new Promise<void>(done => { entered = done; }), heldResult = new Promise<void>(done => { release = done; });
  let inLight = false, ownedCalls = 0, selected = false, settled = false;
  const sequence: string[] = [], originalCreate = metadataCleanup.createWorkspaceDeletionMetadataCleaner;
  vi.spyOn(metadataCleanup, 'createWorkspaceDeletionMetadataCleaner').mockImplementationOnce(input => {
    const writers = input.assertWritersAbsent.bind(input);
    return originalCreate({ ...input, async assertWritersAbsent() {
      if (inLight) {
        sequence.push('writers');
        if (failAt === 0) { entered(); if (held) await heldResult; throw first; }
      }
      await writers();
    } });
  });
  const f = await originalMetadataFixture(test, 'workspaceImport');
  const slots = await originalMetadataSlots(f), retirements = originalMetadataRetirementSpies(); f.releases.push(release);
  vi.spyOn(f.authority, 'assertOwned').mockImplementation(async () => {
    if (inLight) {
      ownedCalls++; sequence.push('owned');
      if (ownedCalls === failAt) { entered(); if (held) await heldResult; throw first; }
    }
    f.authority.assertCurrent();
  });
  const original = originalPayloadAbsence.captureWorkspaceDeletionOriginalPayloadAbsence;
  vi.spyOn(originalPayloadAbsence, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementationOnce(async (...args) => {
    selected = true; const supplied = args[2], read = supplied.assertReadSelection!;
    return original(args[0], args[1], { ...supplied, async assertReadSelection() {
      inLight = true;
      try { return await read.call(supplied); } finally { inLight = false; }
    } });
  });
  const result = f.run().then(() => { settled = true; return { ok: true as const }; },
    error => { settled = true; return { ok: false as const, error }; });
  try {
    await observed; expect(selected).toBe(true); expect(ownedCalls).toBe(failAt === 0 ? 1 : failAt);
    expect(sequence).toEqual(failAt === 1 ? ['owned'] : failAt === 0 ? ['owned', 'writers'] : ['owned', 'writers', 'owned']);
    if (held) { expect(settled).toBe(false); f.revoke(); release(); }
    const outcome = await result; expect(outcome.ok).toBe(false); if (!outcome.ok) expect(outcome.error).toBe(first);
    expect(await originalMetadataSlots(f)).toEqual(slots); await f.preservedOriginal();
    for (const retire of retirements) expect(retire).not.toHaveBeenCalled();
  } finally { release(); await result; }
});

it.for(['current', 'sync'] as const)('keeps the V2 original journal native %s mutation guard complete', async (boundary, test) => {
  const f = await originalMetadataFixture(test, 'workspaceImport', { coldSelection: true });
  const original = await readFile(f.ownerJournalPath), first = new Error('SYNTHETIC_V2_ORIGINAL_MUTATION_SELECTION_LOST');
  const fs = createNodeWorkspaceBackupImportJournalFileSystem(createWorkspaceBackupImportJournalPaths(f.root, f.importPath));
  const remove = fs.removeSlot.bind(fs), sync = fs.syncDirectory.bind(fs);
  let injected = false, guardStarted = false, guardCompleted = false, mutationCompleted = false;
  const checked = (guard: NonNullable<Parameters<typeof fs.syncDirectory>[0]>) => ({
    assertAuthority: guard.assertAuthority.bind(guard),
    async beforeMutation() { guardStarted = true; await guard.beforeMutation(); guardCompleted = true; },
  });
  fs.removeSlot = async (slot, guard) => {
    if (boundary !== slot) return remove(slot, guard);
    injected = true; f.fullProof.mockRejectedValueOnce(first);
    const result = await remove(slot, checked(guard!)); mutationCompleted = true; return result;
  };
  fs.syncDirectory = async guard => {
    if (boundary !== 'sync') return sync(guard);
    injected = true; f.fullProof.mockRejectedValueOnce(first);
    await sync(checked(guard!)); mutationCompleted = true;
  };
  const selected = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.importPath, fileSystem: fs });
  const clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce((...args) => clear.apply(selected, args));
  await expect(f.run()).rejects.toBe(first);
  expect(injected).toBe(true); expect(guardStarted).toBe(true); expect(guardCompleted).toBe(false); expect(mutationCompleted).toBe(false);
  if (boundary === 'current') expect((await readFile(f.ownerJournalPath)).equals(original)).toBe(true);
  else for (const suffix of ['', '.backup', '.next']) await expect(readFile(f.ownerJournalPath + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await readFile(f.bindingPath)).equals(f.bindingBytes)).toBe(true); await f.preservedOriginal();
});

for (const originalOwner of ['workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration'] as const) it.for([originalOwner])(
  'retires payloadless original %s proof metadata from a committed V2 purged fixture',
  originalOwner === 'workspaceLegacyAdoption' ? { ...originalMetadataOptions, timeout: 45_000 } : originalMetadataOptions, async (owner, test) => {
    const f = await originalMetadataFixture(test, owner);
    await f.track((async () => {
      const mutations = [vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged'),
        vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged'),
        vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged'),
        vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent')];
      const mutationCount = () => mutations.reduce((count, method) => count + method.mock.calls.length, 0);
      expect(parseWorkspaceDeletionJournalBytes(f.bytes).inventory.recordCount).toBe(1);
      expect((await f.run()).phase).toBe('purged');
      for (const suffix of ['', '.next', '.backup']) await expect(readFile(f.ownerJournalPath + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await f.preservedOriginal(); const completedMutations = mutationCount(); expect(completedMutations).toBeGreaterThan(0);
      const reads = vi.spyOn(f.registry, 'inspectSlots');
      expect((await f.freshRun()).phase).toBe('purged'); expect(reads).toHaveBeenCalled();
      expect(mutationCount()).toBe(completedMutations); await f.preservedOriginal();
    })());
  },
);

it('resumes a V2 original backup-slot acknowledgement cut through a fresh metadata owner', originalMetadataOptions, async test => {
  const f = await originalMetadataFixture(test), first = new Error('SYNTHETIC_V2_BACKUP_ACK_LOST');
  await f.track((async () => {
    const fileSystem = createNodeWorkspaceBackupImportJournalFileSystem(createWorkspaceBackupImportJournalPaths(f.root, f.importPath));
    const remove = fileSystem.removeSlot.bind(fileSystem);
    fileSystem.removeSlot = async (...args) => { const result = await remove(...args); if (args[0] === 'backup') throw first; return result; };
    const faulty = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.importPath, fileSystem });
    const clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (...args) {
      return clear.apply(faulty, args);
    });
    await expect(f.run()).rejects.toBe(first);
    await expect(readFile(`${f.importPath}.backup`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); expect(await readFile(f.importPath)).toBeDefined();
    await f.preservedOriginal(); expect((await f.freshRun()).phase).toBe('purged'); await f.preservedOriginal();
    await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  })());
});

it('rejects returning payload after original and binding retirement instead of completing from proof alone', originalMetadataOptions, async test => {
  const f = await originalMetadataFixture(test);
  await f.track((async () => {
    expect((await f.run()).phase).toBe('purged'); await f.preservedOriginal();
    await mkdir(f.paths.candidateRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(f.paths.candidateRoot, 'retained'), 'synthetic returned candidate', { flag: 'wx', mode: 0o600 });
    await expect(f.freshRun()).rejects.toThrow();
    expect(await readFile(join(f.paths.candidateRoot, 'retained'), 'utf8')).toBe('synthetic returned candidate'); await f.preservedOriginal();
  })());
});

it('preserves original-current when payload returns during the final activation alias read', originalMetadataOptions, async test => {
  const f = await originalMetadataFixture(test, 'workspaceReplacement');
  await f.track((async () => {
    const originalBytes = await readFile(f.ownerJournalPath);
    const fs = createNodeCrashSafeFileSlotFileSystem({ directoryPath: dirname(f.ownerJournalPath), currentPath: f.ownerJournalPath,
      nextPath: `${f.ownerJournalPath}.next`, backupPath: `${f.ownerJournalPath}.backup` }, originalBytes.byteLength);
    let inRemoval = false, aliasReads = 0, injected = false;
    const remove = fs.removeSlot.bind(fs);
    fs.removeSlot = (slot, guard) => remove(slot, { assertAuthority: () => guard!.assertAuthority(), async beforeMutation() {
      inRemoval = true; aliasReads = 0;
      try { await guard!.beforeMutation(); } finally { inRemoval = false; }
    } });
    const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementation(async function (this: WorkspaceRemnantBindingStore, ...args) {
      const result = await inspect.apply(this, args);
      // Two byte-guard boundaries, each with two owner callbacks and two alias reads.
      if (inRemoval && result.mode === 'absent' && ++aliasReads === 8) {
        injected = true;
        const root = deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, 'activationFailed').rootPath;
        await mkdir(root, { mode: 0o700 }); await writeFile(join(root, 'retained'), 'synthetic late activation payload', { flag: 'wx', mode: 0o600 });
      }
      return result;
    });
    const faulty = new ProfileRestoreActivationJournalStore(f.ownerJournalPath, fs);
    const clear = ProfileRestoreActivationJournalStore.prototype.clearAfterDeletionPurged;
    vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (...args) {
      return clear.apply(faulty, args);
    });
    await expect(f.run()).rejects.toThrow(); expect(injected).toBe(true); expect(aliasReads).toBe(8);
    expect(await readFile(f.ownerJournalPath)).toEqual(originalBytes); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
    const root = deriveWorkspaceReplacementRemnantRoot(f.root, f.binding.workspaceId, f.binding.operationId, 'activationFailed').rootPath;
    expect(await readFile(join(root, 'retained'), 'utf8')).toBe('synthetic late activation payload'); await f.preservedOriginal();
  })());
});

it.for(['originalIdentity', 'activationAlias', 'unprovedJournal'] as const)(
  'preserves V2 original proof evidence after %s changes before retirement', async (changed, test) => {
    const f = await originalMetadataFixture(test, changed === 'activationAlias' ? 'workspaceReplacement' : 'workspaceImport');
    await f.track((async () => {
      const originalBytes = await readFile(f.ownerJournalPath);
      let addedPath: string;
      if (changed === 'originalIdentity') {
        addedPath = `${f.ownerJournalPath}.retained-original`; await rename(f.ownerJournalPath, addedPath);
        await writeFile(f.ownerJournalPath, originalBytes, { flag: 'wx', mode: 0o600 });
      } else if (changed === 'activationAlias') {
        const alias = captureWorkspaceRemnantBinding({ ...f.binding, owner: 'workspaceActivationMigration' });
        await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(alias)).publish(alias, {
          assertAuthority: f.authority.assertCurrent, assertExternalSelection: f.authority.assertOwned,
        });
        addedPath = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(alias)).currentPath;
      } else {
        await new WorkspaceLegacyAdoptionJournalStore(f.root).write({ ...createAdoptionJournal('prepared'),
          operationId: id(999), workspaceId: f.binding.workspaceId });
        addedPath = createWorkspaceLegacyAdoptionJournalPaths(f.root).currentPath;
      }
      const addedBytes = await readFile(addedPath);
      const calls = [vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged'),
        vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged'),
        vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged')];
      await expect(f.run()).rejects.toThrow(); expect(calls.every(call => call.mock.calls.length === 0)).toBe(true);
      expect(await readFile(addedPath)).toEqual(addedBytes); expect(await readFile(f.ownerJournalPath)).toEqual(originalBytes);
      expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preservedOriginal();
    })());
  },
);

it('retires the actual import journal before its binding and preserves the committed deletion evidence', { timeout: 30_000 }, async test => {
  const f = await fixture(test), clearJournal = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  const clearBinding = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  const order: string[] = [];
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementation(async function (this: WorkspaceBackupImportJournalStore, ...args) {
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); order.push('journal'); return clearJournal.apply(this, args);
  });
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function (this: WorkspaceRemnantBindingStore, ...args) {
    expect(Object.values(await f.importStore.inspectSlots()).filter(Boolean)).toEqual([]); order.push('binding'); return clearBinding.apply(this, args);
  });
  expect((await f.run()).phase).toBe('purged'); expect(order[0]).toBe('journal'); expect(order).toContain('binding');
  expect(Object.values(await f.importStore.inspectSlots()).filter(Boolean)).toEqual([]);
  await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved(); expect((await f.run()).phase).toBe('purged'); await f.preserved();
  expect(await readdir(f.root)).toContain('external-backup');
});

it.for(['workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration'] as const)(
  'retires the actual %s journal through its original owner with the binding held', { timeout: 30_000 }, async (owner, test) => {
    const f = await fixture(test, owner); expect((await readFile(f.ownerJournalPath)).byteLength).toBeGreaterThan(0);
    expect((await f.run()).phase).toBe('purged');
    for (const suffix of ['', '.next', '.backup']) await expect(readFile(`${f.ownerJournalPath}${suffix}`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' }); await f.preserved();
  },
);

it.for(['journal', 'binding'] as const)('resumes after the real %s cleanup acknowledgement is lost', { timeout: 30_000 }, async (cut, test) => {
  const f = await fixture(test), first = new Error('SYNTHETIC_METADATA_ACK_LOST');
  if (cut === 'journal') {
    const clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (this: WorkspaceBackupImportJournalStore, ...args) {
      await clear.apply(this, args); throw first;
    });
  } else {
    const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, ...args) {
      await clear.apply(this, args); throw first;
    });
  }
  await expect(f.run()).rejects.toBe(first);
  expect(Object.values(await f.importStore.inspectSlots()).filter(Boolean)).toEqual([]);
  if (cut === 'journal') expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  else await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.preserved(); expect((await f.run()).phase).toBe('purged'); await f.preserved();
});

it('does not clear a shared journal belonging to another operation or retire the selected binding', { timeout: 30_000 }, async test => {
  const f = await fixture(test);
  const foreign = serializeWorkspaceBackupImportJournal(validateWorkspaceBackupImportJournal({ ...f.importValue, operationId: id(203) }));
  await writeFile(f.importPath, foreign, { mode: 0o600 });
  const clear = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged');
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(clear).not.toHaveBeenCalled(); expect(await readFile(f.importPath)).toEqual(Buffer.from(foreign));
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it.for(['workspaceLegacyAdoption', 'workspaceReplacement'] as const)(
  'rejects an invalid %s slot pair before retiring any earlier journal', { timeout: 30_000 }, async (owner, test) => {
    const f = await fixture(test, 'workspaceImport', owner), binding = f.secondBinding!;
    const path = owner === 'workspaceLegacyAdoption' ? createWorkspaceLegacyAdoptionJournalPaths(f.root).currentPath
      : deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath;
    const values = owner === 'workspaceLegacyAdoption'
      ? [serializeWorkspaceLegacyAdoptionJournal({ ...createAdoptionJournal('candidatePrepared'),
        operationId: binding.operationId, workspaceId: binding.workspaceId }),
      serializeWorkspaceLegacyAdoptionJournal({ ...createAdoptionJournal('prepared'),
        operationId: binding.operationId, workspaceId: binding.workspaceId })]
      : [Buffer.from(JSON.stringify({ formatVersion: 1, operationId: binding.operationId, phase: 'accepted', revision: 3,
        hadActiveDatabase: true, hadActiveDocuments: true }) + '\n'),
      Buffer.from(JSON.stringify({ formatVersion: 1, operationId: binding.operationId, phase: 'prepared', revision: 4,
        hadActiveDatabase: true, hadActiveDocuments: true }) + '\n')];
    await writeFile(`${path}.backup`, values[0]!, { mode: 0o600, flag: 'wx' });
    await writeFile(path, values[1]!, { mode: 0o600, flag: 'wx' });
    const importBytes = await readFile(f.importPath);
    const bindingPath = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath;
    const bindingBytes = await readFile(bindingPath);
    const clear = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged');
    const clearAdoption = vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged');
    const clearActivation = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged');
    const clearBinding = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
    await expect(f.run()).rejects.toThrow(owner === 'workspaceLegacyAdoption'
      ? 'WORKSPACE_ADOPTION_INVALID' : 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect(clear).not.toHaveBeenCalled();
    expect(clearAdoption).not.toHaveBeenCalled(); expect(clearActivation).not.toHaveBeenCalled();
    expect(clearBinding).not.toHaveBeenCalled();
    expect(await readFile(f.importPath)).toEqual(importBytes);
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
    expect(await readFile(bindingPath)).toEqual(bindingBytes);
    expect(await readFile(`${path}.backup`)).toEqual(Buffer.from(values[0]!));
    expect(await readFile(path)).toEqual(Buffer.from(values[1]!));
    await f.preserved();
  },
);

it.for(['identity', 'newSide'] as const)('retains all journal bytes after a late binding %s change', { timeout: 30_000 }, async (change, test) => {
  const f = await fixture(test), original = await readFile(f.importPath), clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  const retained = join(f.root, 'retained-original-binding');
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (this: WorkspaceBackupImportJournalStore, ...args) {
    if (change === 'identity') { await rename(f.bindingPath, retained); await writeFile(f.bindingPath, f.bindingBytes, { mode: 0o600, flag: 'wx' }); }
    else await writeFile(`${f.bindingPath}.next`, f.bindingBytes, { mode: 0o600, flag: 'wx' });
    return clear.apply(this, args);
  });
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(f.importPath)).toEqual(original); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(change === 'identity' ? retained : `${f.bindingPath}.next`)).toEqual(f.bindingBytes); await f.preserved();
});

it.for(['backupAfter', 'currentAfter', 'syncAfter'] as const)(
  'resumes the composed chain after native %s failure with the binding retained', { timeout: 30_000 }, async (cut, test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_NATIVE_METADATA_CUT');
    await writeFile(`${f.importPath}.backup`, serializeWorkspaceBackupImportJournal(validateWorkspaceBackupImportJournal({
      ...f.importValue, state: 'rootPublished',
    })), { mode: 0o600, flag: 'wx' });
    const fs = createNodeWorkspaceBackupImportJournalFileSystem(createWorkspaceBackupImportJournalPaths(f.root, f.importPath));
    const remove = fs.removeSlot.bind(fs), sync = fs.syncDirectory.bind(fs);
    fs.removeSlot = async (...args) => { const result = await remove(...args); if (cut === `${args[0]}After`) throw first; return result; };
    fs.syncDirectory = async (...args) => { await sync(...args); if (cut === 'syncAfter') throw first; };
    const faulty = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.importPath, fileSystem: fs });
    const clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
    const calls = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged')
      .mockImplementationOnce(async function (...args) { return clear.apply(faulty, args); });
    await expect(f.run()).rejects.toBe(first);
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
    const remaining = await f.importStore.inspectSlots(); expect(remaining.backup).toBeUndefined(); expect(remaining.next).toBeUndefined();
    expect(remaining.current === undefined).toBe(cut !== 'backupAfter');
    await f.preserved(); expect((await f.run()).phase).toBe('purged'); expect(calls).toHaveBeenCalledTimes(2);
    await f.preserved(); await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('keeps unlisted target metadata and refuses completion instead of adopting it for cleanup', { timeout: 30_000 }, async test => {
  const f = await fixture(test), extra = captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(204) });
  await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(extra)).publish(extra, {
    assertAuthority: f.authority.assertCurrent, assertExternalSelection: f.authority.assertOwned,
  });
  const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(extra)).currentPath, bytes = await readFile(path);
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(path)).toEqual(bytes); await f.preserved();
});

it('retains the original journal and metadata if a payload reappears at the retirement boundary', { timeout: 30_000 }, async test => {
  const f = await fixture(test), original = await readFile(f.importPath), clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (this: WorkspaceBackupImportJournalStore, ...args) {
    await mkdir(f.paths.candidateRoot, { mode: 0o700 });
    await writeFile(join(f.paths.candidateRoot, 'retained'), 'late synthetic payload', { mode: 0o600 });
    return clear.apply(this, args);
  });
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(f.importPath)).toEqual(original); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(join(f.paths.candidateRoot, 'retained'), 'utf8')).toBe('late synthetic payload'); await f.preserved();
});

it('joins a pending owner port and rejects overlapping cleanup after revocation', { timeout: 30_000 }, async test => {
  const f = await fixture(test), original = await readFile(f.importPath), clear = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementationOnce(async function (this: WorkspaceBackupImportJournalStore, ...args) {
    entered(); await held; return clear.apply(this, args);
  });
  let settled = false; const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_OWNER_PORT_NOT_PENDING'); })]);
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    f.revoke(); await setImmediate(); expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toBe(f.first); expect(await readFile(f.importPath)).toEqual(original);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});
import { afterEach } from 'vitest';
const metadataIo = vi.hoisted(() => ({
  path: undefined as string | undefined,
  afterRead: undefined as (() => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  beforeClose: undefined as (() => Promise<void>) | undefined,
  afterClose: undefined as (() => Promise<void>) | undefined,
  handles: [] as FileHandle[], live: new Set<FileHandle>()
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual, async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args);
      if (args[0] !== metadataIo.path)
        return handle;
      metadataIo.handles.push(handle);
      metadataIo.live.add(handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'read')
            return async (...readArgs: Parameters<FileHandle['read']>) => {
              const before = metadataIo.beforeRead;
              metadataIo.beforeRead = undefined;
              await before?.();
              const result = await Reflect.apply(target.read, target, readArgs);
              const after = metadataIo.afterRead;
              metadataIo.afterRead = undefined;
              await after?.();
              return result;
            };
          if (key === 'close')
            return async () => {
              const before = metadataIo.beforeClose;
              metadataIo.beforeClose = undefined;
              await before?.();
              await target.close();
              metadataIo.live.delete(target);
              const after = metadataIo.afterClose;
              metadataIo.afterClose = undefined;
              await after?.();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
});
const metadataOptions = { timeout: 30000 };
type CapturedMetadataRead = {
  authority: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[1];
  consume: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[2];
};
async function metadataSnapshot(root: string) {
  const result: Record<string, string> = {};
  const visit = async (path: string, prefix: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const key = prefix + entry.name, child = join(path, entry.name);
      if (entry.isDirectory()) {
        result[key + '/'] = 'directory';
        await visit(child, key + '/');
      }
      else
        result[key] = (await readFile(child)).toString('hex');
    }
  };
  await visit(root, '');
  return result;
}
async function metadataFixture(test: TestContext) {
  const f = await fixture(test);
  const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: registryPath });
  let writer = false;
  const writerError = new Error('SYNTHETIC_METADATA_WRITER_PRESENT');
  const writers = vi.fn(async () => {
    f.authority.assertCurrent(); if (writer)
      throw writerError;
  });
  const cleaner = createWorkspaceDeletionMetadataCleaner({ userDataRoot: f.root, registry, assertWritersAbsent: writers });
  const jobs: Promise<unknown>[] = [];
  test.onTestFinished(async () => {
    for (const release of f.releases)
      release(); await Promise.allSettled(jobs);
  });
  const run = () => { const result = cleaner(id(200), f.authority); jobs.push(result.catch(error => error)); return result; };
  const mutations = [vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged'),
  vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged'),
  vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged'),
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent')];
  metadataIo.path = f.inventoryPath;
  return {
    ...f, registryPath, writers, writerError, addWriter() { writer = true; }, run,
    mutationCount: () => mutations.reduce((total, spy) => total + spy.mock.calls.length, 0)
  };
}
afterEach(() => {
  expect(metadataIo.live.size).toBe(0);
  for (const handle of metadataIo.handles)
    expect(handle.fd).toBe(-1);
  metadataIo.path = undefined;
  metadataIo.beforeRead = undefined;
  metadataIo.afterRead = undefined;
  metadataIo.beforeClose = undefined;
  metadataIo.afterClose = undefined;
  metadataIo.handles = [];
  metadataIo.live.clear();
});
it("keeps complete phase proofs around a pure metadata inventory read", metadataOptions, async (test) => {
  const registryReads = vi.spyOn(WorkspaceRegistryStore.prototype, "inspectSlots");
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root);
  const original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const stop = new Error("SYNTHETIC_METADATA_PROBE_STOP");
  const count = () => registryReads.mock.calls.length;
  let reads = 0, insideFull = -1, closedFull = -1, end = -1;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, "consumeSelectedRecords").mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (reads++ === 0) {
      const begin = count();
      const result = await original.apply(this, args);
      insideFull = count() - begin;
      end = count();
      return result;
    }
    closedFull = count() - end;
    throw stop;
  });
  await expect(f.run()).rejects.toBe(stop);
  expect(reads).toBe(2);
  expect(insideFull).toBe(0);
  expect(closedFull).toBe(2);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before);
});
it.for(['registryIdentity', 'journalIdentity', 'journalPhase', 'payload', 'sideBinding', 'writer', 'owner'] as const)('metadata probe rejects late %s before retirement and preserves post-attack bytes', metadataOptions, async (kind, test) => {
  const f = await metadataFixture(test);
  let attacked: Record<string, string> | undefined;
  metadataIo.afterClose = async () => {
    if (kind === 'writer')
      f.addWriter();
    else if (kind === 'owner')
      f.revoke();
    else if (kind === 'payload') {
      await mkdir(f.paths.candidateRoot, { recursive: true, mode: 0o700 });
      await writeFile(join(f.paths.candidateRoot, 'retained-late'), 'synthetic late payload', { flag: 'wx', mode: 0o600 });
    }
    else if (kind === 'sideBinding') {
      await writeFile(`${f.bindingPath}.next`, '{"invalid":"synthetic side slot"}', { flag: 'wx', mode: 0o600 });
    }
    else {
      const path = kind === 'registryIdentity' ? f.registryPath : f.journalPath;
      const bytes = await readFile(path);
      await rename(path, `${path}.retained`);
      await writeFile(path, kind === 'journalPhase' ? JSON.stringify({ ...JSON.parse(bytes.toString('utf8')), phase: 'purgeAuthorized' }) : bytes, { flag: 'wx', mode: 0o600 });
    }
    attacked = await metadataSnapshot(f.root);
  };
  const result = await f.run().catch(error => error);
  expect(result).toBeInstanceOf(Error);
  expect(attacked).toBeDefined();
  if (kind === 'writer')
    expect(result).toBe(f.writerError);
  else if (kind === 'owner')
    expect(result).toBe(f.first);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(attacked);
});
it.for(['read', 'close'] as const)('metadata probe joins a held actual %s after revocation', metadataOptions, async (stage, test) => {
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  const hold = async () => { enter(); await held; };
  if (stage === 'read')
    metadataIo.beforeRead = hold;
  else
    metadataIo.beforeClose = hold;
  let settled = false;
  const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('SYNTHETIC_METADATA_NOT_PENDING'); })]);
    expect(metadataIo.live.size).toBe(1);
    expect(metadataIo.handles[0]!.fd).toBeGreaterThanOrEqual(0);
    f.revoke();
    await setImmediate();
    expect(settled).toBe(false);
  }
  finally {
    release();
    await result;
  }
  expect(await result).toBe(f.first);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before);
});
it('metadata probe retains exact read and close errors without retirement', metadataOptions, async (test) => {
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root);
  const first = new Error('SYNTHETIC_METADATA_READ_FAILED'), close = new Error('SYNTHETIC_METADATA_CLOSE_FAILED');
  metadataIo.afterRead = async () => { throw first; };
  metadataIo.afterClose = async () => { throw close; };
  const result = await f.run().catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toBe(first);
  expect(result.errors[1]).toBe(close);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before);
});
it('metadata probe expires old successful store and row callbacks during the next read', {
  ...metadataOptions,
}, async (test) => {
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root);
  const original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let reads = 0, attacks = 0;
  let saved!: CapturedMetadataRead;
  let row!: Parameters<CapturedMetadataRead['consume']>[0];
  const stop = new Error('SYNTHETIC_METADATA_CALLBACK_PROBE_STOP');
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    const index = reads++;
    if (index === 0) {
      saved = { authority, consume };
      return original.call(this, value, authority, async (entry) => { row ??= entry; await consume(entry); });
    }
    if (index >= 3)
      throw stop;
    await original.call(this, value, authority, async (entry) => {
      if (index === 2 && attacks === 0) {
        expect(authority).not.toBe(saved.authority);
        authority.assertAuthority();
        await authority.assertExternalSelection();
        const writerCalls = f.writers.mock.calls.length;
        expect(() => saved.authority.assertAuthority()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        await expect(saved.authority.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        await expect(saved.consume(row)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        expect(f.writers.mock.calls.length).toBe(writerCalls);
        authority.assertAuthority();
        await authority.assertExternalSelection();
        attacks++;
      }
      await consume(entry);
    });
    if (attacks === 1) throw stop;
  });
  await expect(f.run()).rejects.toBe(stop);
  expect(attacks).toBe(1);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before);
});
it('metadata probe replays the original failed-read cause from expired callbacks', {
  ...metadataOptions,
}, async (test) => {
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root);
  const original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  let saved!: CapturedMetadataRead;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, value, authority, consume) {
    saved ??= { authority, consume };
    return original.call(this, value, authority, consume);
  });
  metadataIo.afterRead = async () => { f.addWriter(); };
  await expect(f.run()).rejects.toBe(f.writerError);
  expect(saved).toBeDefined();
  let caught: unknown;
  try {
    saved.authority.assertAuthority();
  }
  catch (error) {
    caught = error;
  }
  expect(caught).toBe(f.writerError);
  await expect(saved.authority.assertExternalSelection()).rejects.toBe(f.writerError);
  await expect(saved.consume(undefined as unknown as Parameters<CapturedMetadataRead['consume']>[0])).rejects.toBe(f.writerError);
  expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before);
});

function preflightInspectionMethod() { return 'inspectCommittedDeletionSlots' as const; }
it('preflight keeps retirement, second-read, clear and post-clear guards distinct', { timeout: 10_000 }, async test => {
  const f = await fixture(test), strict = WorkspaceRemnantBindingStore.prototype.inspectCommittedAfterPayloadsAbsent;
  type Stage = 'preflight' | 'retirement' | 'secondRead' | 'clear' | 'postClear';
  let stage: Stage = 'preflight', lightweightReads = 0, clearAbsence = 0;
  const reads: Record<Stage, number> = { preflight: 0, retirement: 0, secondRead: 0, clear: 0, postClear: 0 };
  const absence: Record<Stage, number> = { ...reads };
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedAfterPayloadsAbsent').mockImplementation(function(this: WorkspaceRemnantBindingStore, target, proof) {
    const selectedStage = stage; reads[selectedStage]++;
    return strict.call(this, target, { ...proof, async assertPayloadsAbsent() { absence[selectedStage]++; await proof.assertPayloadsAbsent(); } });
  });
  {
    const inspect = WorkspaceRemnantBindingStore.prototype.inspectCommittedDeletionSlots;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedDeletionSlots').mockImplementation(function(this: WorkspaceRemnantBindingStore, ...args) {
      expect(['preflight', 'secondRead', 'postClear']).toContain(stage); lightweightReads++; return inspect.apply(this, args);
    });
  }
  const retire = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementation(async function(this: WorkspaceBackupImportJournalStore, ...args) {
    stage = 'retirement';
    try { return await retire.apply(this, args); } finally { stage = 'secondRead'; }
  });
  const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function(this: WorkspaceRemnantBindingStore, target, proof) {
    expect(stage).toBe('secondRead'); stage = 'clear';
    try {
      return await clear.call(this, target, { ...proof, async assertPayloadsAbsent() {
        expect(stage).toBe('clear'); clearAbsence++; await proof.assertPayloadsAbsent();
      } });
    } finally { stage = 'postClear'; }
  });
  let postFullChecks = 0;
  const postInventoryRead = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(function(this: WorkspaceDeletionInventoryStore, ...args) {
    if (stage === 'postClear') postFullChecks++; return postInventoryRead.apply(this, args);
  });
  expect((await f.run()).phase).toBe('purged');
  expect(lightweightReads).toBe(3);
  expect(reads.preflight).toBe(0);
  expect(absence.preflight).toBe(0);
  expect(reads.retirement).toBeGreaterThan(0); expect(absence.retirement).toBeGreaterThan(0);
  // The read-only observation has one fresh full proof; retirement and native mutation keep their own guards.
  expect(reads.secondRead).toBe(0); expect(absence.secondRead).toBe(0);
  expect(reads.postClear).toBe(0); expect(absence.postClear).toBe(0); expect(postFullChecks).toBe(2);
  expect(reads.clear).toBe(0); expect(clearAbsence).toBeGreaterThan(0);
  await f.preserved();
});

type SecondBindingScope = Parameters<WorkspaceRemnantBindingStore['inspectCommittedDeletionSlots']>[1];
type SecondBindingSlots = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspectCommittedDeletionSlots']>>;

function tapSecondBindingRead(work: (read: () => Promise<SecondBindingSlots>, scope: SecondBindingScope) => Promise<SecondBindingSlots>) {
  const inspect = WorkspaceRemnantBindingStore.prototype.inspectCommittedDeletionSlots;
  const retire = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  let retired = false, tapped = false;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementation(async function(this: WorkspaceBackupImportJournalStore, ...args) {
    const result = await retire.apply(this, args); retired = true; return result;
  });
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedDeletionSlots').mockImplementation(function(this: WorkspaceRemnantBindingStore, target, scope) {
    const read = () => inspect.call(this, target, scope);
    if (!retired || tapped) return read();
    tapped = true; return work(read, scope);
  });
  return () => expect(tapped).toBe(true);
}

async function secondBindingFixture(test: TestContext, coldSelection = false, foreignOwner: FixtureOwner = 'workspaceImport') {
  const f = await fixture(test, 'workspaceImport', undefined, false, { coldSelection, foreignOwner });
  // Legitimate cut after this operation's original journal retirement, before binding cleanup.
  for (const suffix of ['', '.next', '.backup']) await rm(f.importPath + suffix, { force: true });
  return f;
}

async function secondBindingSlots(f: Awaited<ReturnType<typeof fixture>>) {
  return Promise.all(['', '.next', '.backup'].map(async suffix => {
    try { return (await readFile(f.bindingPath + suffix)).toString('hex'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }));
}

for (const variant of ['persistent', 'transient'] as const) {
  it(`second binding read distinguishes ${variant} payload before strict removal`,
    variant === 'transient' ? { timeout: 10000 } : {}, async test => {
      const f = await secondBindingFixture(test);
      const tapped = tapSecondBindingRead(async read => {
        await mkdir(f.paths.candidateRoot, { mode: 0o700 });
        await writeFile(join(f.paths.candidateRoot, 'retained'), 'synthetic second-lookup payload');
        try { return await read(); }
        finally { if (variant === 'transient') await rm(f.paths.candidateRoot, { recursive: true }); }
      });
      const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
      if (variant === 'transient') expect((await f.run()).phase).toBe('purged');
      else {
        await expect(f.run()).rejects.toThrow();
        expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
        expect(clear).toHaveBeenCalledTimes(1);
      }
      tapped(); await f.preserved();
    });
}

it('second binding read rejects sustained inventory corruption before removal', async test => {
  const f = await fixture(test), bytes = await readFile(f.inventoryPath);
  const tapped = tapSecondBindingRead(async read => { await writeFile(f.inventoryPath, Buffer.alloc(bytes.length, 0)); return read(); });
  await expect(f.run()).rejects.toThrow(); tapped();
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(f.inventoryPath)).toEqual(Buffer.alloc(bytes.length, 0));
});

it('second binding read retains the outer inventory identity failure after restored content', async test => {
  const f = await secondBindingFixture(test), bytes = await readFile(f.inventoryPath);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const stat = await actual.stat(f.inventoryPath);
  const tapped = tapSecondBindingRead(async read => {
    await writeFile(f.inventoryPath, Buffer.alloc(bytes.length, 0));
    try { return await read(); }
    finally { await writeFile(f.inventoryPath, bytes); await actual.utimes(f.inventoryPath, stat.atime, stat.mtime); }
  });
  await expect(f.run()).rejects.toThrow(); tapped();
  // Restored content does not restore the identity held by the outer reader.
  await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.inventoryPath)).toEqual(bytes); await f.preserved();
});

it.for(['newBackup', 'sameBytesNewIdentity', 'missingCurrent'] as const)('second binding receipt rejects %s before a delete', async (change, test) => {
  const f = await fixture(test); let attacked: Awaited<ReturnType<typeof secondBindingSlots>> | undefined;
  const tapped = tapSecondBindingRead(async read => {
    const result = await read();
    if (change === 'newBackup') await writeFile(f.bindingPath + '.backup', f.bindingBytes, { flag: 'wx', mode: 0o600 });
    else {
      await rename(f.bindingPath, f.bindingPath + '.retained');
      if (change === 'sameBytesNewIdentity') await writeFile(f.bindingPath, f.bindingBytes, { flag: 'wx', mode: 0o600 });
    }
    attacked = await secondBindingSlots(f); return result;
  });
  await expect(f.run()).rejects.toThrow(); tapped();
  expect(await secondBindingSlots(f)).toEqual(attacked);
  if (change === 'newBackup') expect(await readFile(f.bindingPath + '.backup')).toEqual(f.bindingBytes);
  else expect(await readFile(f.bindingPath + '.retained')).toEqual(f.bindingBytes);
  await f.preserved();
});

it.for(['read', 'close'] as const)('second binding read joins held native %s after revocation', async (where, test) => {
  const f = await fixture(test); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  const tapped = tapSecondBindingRead(async read => {
    metadataIo.path = f.bindingPath;
    metadataIo[where === 'read' ? 'afterRead' : 'beforeClose'] = async () => { entered(); await held; };
    return read();
  });
  const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
  let settled = false;
  const result = f.run().then(value => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SECOND_LOOKUP_NOT_HELD'); })]);
    f.revoke(); await setImmediate(); expect(settled).toBe(false); expect(metadataIo.live.size).toBe(1);
    expect(clear).not.toHaveBeenCalled();
  } finally { release(); await result; }
  expect(await result).toEqual({ error: f.first }); tapped(); expect(metadataIo.live.size).toBe(0);
  expect(clear).not.toHaveBeenCalled(); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it.for(['error', 'undefined'] as const)('second binding read keeps the mapped native %s before later owner loss', async (cause, test) => {
  const f = await fixture(test), first = cause === 'error' ? new Error('SYNTHETIC_SECOND_READ_FIRST') : undefined;
  let saved: SecondBindingScope | undefined;
  const tapped = tapSecondBindingRead(async (read, scope) => {
    saved = scope; metadataIo.path = f.bindingPath;
    metadataIo.afterRead = async () => { f.revoke(); throw first; };
    return read();
  });
  const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
  const outcome = await f.run().then(() => ({ error: undefined }), (error: unknown) => ({ error }));
  expect(outcome.error).toMatchObject({ name: 'CrashSafeFileSlotError', failure: 'invalid' });
  tapped(); expect(clear).not.toHaveBeenCalled();
  let caught = false;
  try { saved!.assertAuthority(); } catch (error) { caught = true; expect(error).toBe(outcome.error); }
  expect(caught).toBe(true); await expect(saved!.assertExternalSelection()).rejects.toBe(outcome.error);
  expect(metadataIo.live.size).toBe(0); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it('second binding observation expires before independent strict clear', { timeout: 10000 }, async test => {
  const f = await secondBindingFixture(test); let saved: SecondBindingScope | undefined, expiredChecks = 0;
  const tapped = tapSecondBindingRead(async (read, scope) => { saved = scope; return read(); });
  const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function(this: WorkspaceRemnantBindingStore, ...args) {
    expect(() => saved!.assertAuthority()).toThrow();
    await expect(saved!.assertExternalSelection()).rejects.toThrow(); expiredChecks++;
    expect(metadataIo.live.size).toBe(0); return clear.apply(this, args);
  });
  expect((await f.run()).phase).toBe('purged'); tapped(); expect(expiredChecks).toBe(1); await f.preserved();
});

for (const variant of ['persistent', 'transient'] as const) {
  it(`second binding stable selection ${variant} is distinguished from the next full guard`,
    variant === 'transient' ? { timeout: 10000 } : {}, async test => {
      const f = await secondBindingFixture(test, true), first = new Error('SYNTHETIC_SECOND_STABLE_SELECTION_CHANGED');
      const tapped = tapSecondBindingRead(async read => {
        f.fullProof.mockRejectedValue(first);
        try { return await read(); }
        finally { if (variant === 'transient') f.fullProof.mockImplementation(async () => { f.authority.assertCurrent(); }); }
      });
      if (variant === 'transient') expect((await f.run()).phase).toBe('purged');
      else { await expect(f.run()).rejects.toBe(first); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); }
      tapped(); await f.preserved();
    });
}

async function secondInstrumentedFixture(test: TestContext) {
  const f = await fixture(test);
  const registryReads = vi.fn(f.registry.inspectSlots.bind(f.registry));
  const ownedReads = vi.spyOn(f.authority, 'assertOwned');
  const writerReads = vi.fn(async () => { f.authority.assertCurrent(); });
  const cleaner = createWorkspaceDeletionMetadataCleaner({ userDataRoot: f.root,
    registry: { inspectSlots: registryReads }, assertWritersAbsent: writerReads });
  return { ...f, registryReads, ownedReads, writerReads,
    run() { return f.track(cleaner(id(200), f.authority)); } };
}

it('second binding callbacks expire before consume without new selection IO', async test => {
  const f = await secondInstrumentedFixture(test);
  let saved: SecondBindingScope | undefined, ready = false, checked = false;
  const stopped = new Error('SYNTHETIC_SECOND_CONSUME_CHECK_COMPLETE');
  const journalReads = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'inspect');
  const tapped = tapSecondBindingRead(async (read, scope) => {
    saved = scope; metadataIo.path = f.bindingPath;
    const result = await read(); ready = true; return result;
  });
  const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementation(async function(this: WorkspaceBackupImportJournalStore, ...args) {
    if (!ready || checked) return inspect.apply(this, args);
    checked = true;
    expect(metadataIo.live.size).toBe(0); expect(metadataIo.handles.length).toBeGreaterThan(0);
    for (const handle of metadataIo.handles) expect(handle.fd).toBe(-1);
    const counts = () => [f.registryReads.mock.calls.length, f.ownedReads.mock.calls.length,
      f.writerReads.mock.calls.length, journalReads.mock.calls.length];
    const before = counts(); for (const count of before) expect(count).toBeGreaterThan(0);
    expect(() => saved!.assertAuthority()).toThrow(); await expect(saved!.assertExternalSelection()).rejects.toThrow();
    expect(counts()).toEqual(before); throw stopped;
  });
  await expect(f.run()).rejects.toBe(stopped); tapped(); expect(checked).toBe(true);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it.for((['read', 'close'] as const).flatMap(where => (['error', 'undefined'] as const).map(cause => [where, cause] as const)))(
  'second binding first callback %s %s survives held IO and later owner loss', async ([where, cause], test) => {
    const f = await secondInstrumentedFixture(test), first = cause === 'error' ? new Error('SYNTHETIC_SECOND_CALLBACK_FIRST') : undefined;
    let entered!: () => void, release!: () => void, saved: SecondBindingScope | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    f.releases.push(release);
    const tapped = tapSecondBindingRead(async (read, scope) => {
      saved = scope; metadataIo.path = f.bindingPath;
      metadataIo[where === 'read' ? 'afterRead' : 'beforeClose'] = async () => { entered(); await held; };
      return read();
    });
    let settled = false;
    const result = f.run().then(value => ({ value }), (error: unknown) => ({ error })).finally(() => { settled = true; });
    try {
      await Promise.race([started, result.then(() => { throw new Error('SECOND_CALLBACK_NOT_HELD'); })]);
      f.registryReads.mockRejectedValueOnce(first);
      await expect(saved!.assertExternalSelection()).rejects.toBe(first);
      f.revoke();
      const count = f.registryReads.mock.calls.length;
      await expect(saved!.assertExternalSelection()).rejects.toBe(first); expect(f.registryReads.mock.calls.length).toBe(count);
      await setImmediate(); expect(settled).toBe(false); expect(metadataIo.live.size).toBe(1);
    } finally { release(); await result; }
    expect(await result).toEqual({ error: first }); tapped(); expect(metadataIo.live.size).toBe(0);
    await expect(saved!.assertExternalSelection()).rejects.toBe(first);
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
  },
);

it('second binding native sync enters its independent full guard', async test => {
  const f = await secondBindingFixture(test, true);
  const { maximumWorkspaceRemnantBindingBytes } = await import('./workspaceRemnantBindingCodec.js');
  const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding));
  const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes), nativeSync = fs.syncDirectory.bind(fs);
  const first = new Error('SYNTHETIC_SECOND_NATIVE_SYNC_GUARD'); let nativeEntries = 0, injected = false;
  fs.syncDirectory = async guard => {
    expect(guard).toBeDefined(); injected = true; f.fullProof.mockRejectedValueOnce(first);
    return nativeSync({ assertAuthority: guard!.assertAuthority.bind(guard), async beforeMutation() {
      nativeEntries++; await guard!.beforeMutation();
    } });
  };
  const selected = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(f.binding), fs);
  const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(function(this: WorkspaceRemnantBindingStore, ...args) {
    return clear.apply(selected, args);
  });
  await expect(f.run()).rejects.toBe(first); expect(injected).toBe(true); expect(nativeEntries).toBe(1); await f.preserved();
});

for (const variant of ['emptyDirectory', 'missingDirectory'] as const) {
  it(`second binding strict clear still runs for ${variant} after empty observation`,
    { timeout: 10000 }, async test => {
      const f = variant === 'missingDirectory' ? await secondBindingFixture(test, false, 'workspaceLegacyAdoption')
        : await fixture(test, 'workspaceImport', undefined, false, { foreignOwner: 'workspaceLegacyAdoption' });
      const tapped = tapSecondBindingRead(async read => {
        await rm(f.bindingPath);
        if (variant === 'missingDirectory') await rmdir(dirname(f.bindingPath));
        return read();
      });
      const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
      expect((await f.run()).phase).toBe('purged'); tapped(); expect(clear).toHaveBeenCalledTimes(1);
      await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' }); await f.preserved();
    });
}
it('preflight rejects a sustained payload after the final preflight row', async test => {
  const f = await fixture(test), method = preflightInspectionMethod(), original = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  const reads = vi.spyOn(WorkspaceRemnantBindingStore.prototype, method);
  const retire = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged');
  const before = await readFile(f.importPath); let injected = false;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function(this: WorkspaceDeletionInventoryStore, ...args) {
    const count = reads.mock.calls.length; const result = await original.apply(this, args);
    if (!injected && reads.mock.calls.length > count) { injected = true; await mkdir(f.paths.candidateRoot, { mode: 0o700 }); await writeFile(join(f.paths.candidateRoot, 'retained'), 'synthetic sustained payload'); }
    return result;
  });
  await expect(f.run()).rejects.toThrow(); expect(injected).toBe(true);
  expect(retire).not.toHaveBeenCalled();
  expect(await readFile(f.importPath)).toEqual(before); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(join(f.paths.candidateRoot, 'retained'), 'utf8')).toBe('synthetic sustained payload'); await f.preserved();
});
it('preflight characterizes the approved transient observation difference', async test => {
  const f = await fixture(test), method = preflightInspectionMethod(), inspect = WorkspaceRemnantBindingStore.prototype[method]; let once = true;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, method).mockImplementation(async function(this: WorkspaceRemnantBindingStore, ...args) {
    if (!once) return inspect.apply(this, args); once = false;
    await mkdir(f.paths.candidateRoot, { mode: 0o700 });
    try { return await inspect.apply(this, args); } finally { await rmdir(f.paths.candidateRoot); }
  });
  expect((await f.run()).phase).toBe('purged');
  expect(once).toBe(false); await f.preserved();
}, 10_000);
it('preflight keeps the last retirement read strict after its outer purged proof', async test => {
  const f = await fixture(test), before = await readFile(f.importPath);
  const fs = createNodeWorkspaceBackupImportJournalFileSystem(createWorkspaceBackupImportJournalPaths(f.root, f.importPath));
  const read = fs.readSlot.bind(fs), remove = fs.removeSlot.bind(fs);
  const selectedSlots: string[] = [];
  let insideFinalGuard = false, armed = false, injected = false, removed = false;
  let currentRemoveAttempts = 0, outerPurgedAfterInjection = 0;
  fs.readSlot = async (...args) => {
    const result = await read(...args);
    if (insideFinalGuard) selectedSlots.push(args[0]);
    return result;
  };
  fs.removeSlot = async (slot, guard) => {
    if (slot !== 'current') return remove(slot, guard);
    currentRemoveAttempts++;
    if (guard === undefined) throw new Error('CURRENT_REMOVE_GUARD_MISSING');
    const result = await remove(slot, { assertAuthority: guard.assertAuthority.bind(guard), async beforeMutation() {
      expect(insideFinalGuard).toBe(false); insideFinalGuard = true;
      try { await guard.beforeMutation(); } finally { insideFinalGuard = false; }
    } });
    removed = result; return result;
  };
  const injectedStore = new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.importPath, fileSystem: fs });
  const retire = WorkspaceBackupImportJournalStore.prototype.clearAfterDeletionPurged;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged').mockImplementation(function(binding, selection, readSelection) {
    expect(readSelection).toBeDefined();
    return retire.call(injectedStore, binding, { ...selection, async assertDeletionPurged() {
      if (injected) outerPurgedAfterInjection++;
      await selection.assertDeletionPurged();
      // The native remove guard has re-read all journal slots. Its final external proof now calls selectedBinding after purged.
      if (insideFinalGuard && selectedSlots.length === 3) {
        expect(selectedSlots).toEqual(['current', 'next', 'backup']); expect(armed).toBe(false); armed = true;
        metadataIo.path = f.bindingPath; metadataIo.afterRead = async () => {
          expect(insideFinalGuard).toBe(true); injected = true;
          await mkdir(f.paths.candidateRoot, { mode: 0o700 });
          await writeFile(join(f.paths.candidateRoot, 'retained'), 'retirement-boundary payload', { mode: 0o600, flag: 'wx' });
        };
      }
    } }, readSelection);
  });
  await expect(f.run()).rejects.toThrow();
  expect(currentRemoveAttempts).toBe(1); expect(selectedSlots).toEqual(['current', 'next', 'backup']);
  expect(armed).toBe(true); expect(injected).toBe(true); expect(removed).toBe(false);
  expect(outerPurgedAfterInjection).toBe(0); expect(metadataIo.live.size).toBe(0);
  expect(await readFile(f.importPath)).toEqual(before); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(join(f.paths.candidateRoot, 'retained'), 'utf8')).toBe('retirement-boundary payload');
  await f.preserved();
});
it.for(['read', 'close'])('preflight joins held native binding %s after revocation', async (where, test) => {
  const f = await fixture(test), method = preflightInspectionMethod(), inspect = WorkspaceRemnantBindingStore.prototype[method];
  const before = await readFile(f.importPath); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release); let once = true;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, method).mockImplementation(function(this: WorkspaceRemnantBindingStore, ...args) {
    if (once) { once = false; metadataIo.path = f.bindingPath;
      metadataIo[where === 'read' ? 'afterRead' : 'beforeClose'] = async () => { entered(); await held; };
    }
    return inspect.apply(this, args);
  });
  let settled = false; const result = f.run().then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try { await Promise.race([started, result.then(() => { throw new Error('NATIVE_NOT_HELD'); })]); f.revoke(); await setImmediate(); expect(settled).toBe(false); expect(metadataIo.live.size).toBe(1); }
  finally { release(); await result; }
  const outcome = await result;
  expect('error' in outcome && outcome.error).toBe(f.first); expect(metadataIo.live.size).toBe(0);
  expect(await readFile(f.importPath)).toEqual(before); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});
function caughtPreflightError(work: () => void) {
  try { work(); } catch (error) { return error; }
  return undefined;
}
it.for(['read', 'close'])('preflight retains the first cause across held native binding %s and later owner loss', async (where, test) => {
  const f = await metadataFixture(test), before = await metadataSnapshot(f.root), method = preflightInspectionMethod();
  const prototype = WorkspaceRemnantBindingStore.prototype;
  const inspect = prototype[method];
  // Capture the actual inspector-owned callbacks, not the caller's uncaptured proof object.
  const internal = prototype as unknown as { observe(authority: { assertAuthority(): void; assertExternalSelection(): Promise<void> }): Promise<unknown> };
  const observe = internal.observe;
  let selectedStore: WorkspaceRemnantBindingStore | undefined;
  let saved: Parameters<typeof observe>[0] | undefined;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  vi.spyOn(internal, 'observe').mockImplementation(function(this: WorkspaceRemnantBindingStore, authority) {
    if (this === selectedStore && saved === undefined) saved = authority;
    return observe.call(this, authority);
  });
  let once = true;
  vi.spyOn(prototype, method).mockImplementation(function(this: WorkspaceRemnantBindingStore, ...args) {
    if (once) {
      once = false; selectedStore = this; metadataIo.path = f.bindingPath;
      metadataIo[where === 'read' ? 'afterRead' : 'beforeClose'] = async () => { entered(); await held; };
    }
    return inspect.apply(this, args);
  });
  let settled = false;
  const result = f.run().then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('FIRST_CAUSE_NOT_HELD'); })]);
    expect(saved).toBeDefined(); expect(metadataIo.live.size).toBe(2);
    expect(metadataIo.handles.at(-1)!.fd).toBeGreaterThanOrEqual(0);
    f.addWriter();
    await expect(saved!.assertExternalSelection()).rejects.toBe(f.writerError);
    expect(caughtPreflightError(() => saved!.assertAuthority())).toBe(f.writerError);
    f.revoke();
    expect(caughtPreflightError(f.authority.assertCurrent)).toBe(f.first);
    const writerCalls = f.writers.mock.calls.length;
    await expect(saved!.assertExternalSelection()).rejects.toBe(f.writerError);
    expect(caughtPreflightError(() => saved!.assertAuthority())).toBe(f.writerError);
    expect(f.writers.mock.calls.length).toBe(writerCalls);
    await setImmediate(); expect(settled).toBe(false); expect(metadataIo.live.size).toBe(2);
    expect(f.mutationCount()).toBe(0); expect(await metadataSnapshot(f.root)).toEqual(before);
  } finally { release(); await result; }
  const outcome = await result;
  expect('error' in outcome && outcome.error).toBe(f.writerError); expect(metadataIo.live.size).toBe(0);
  for (const handle of metadataIo.handles) expect(handle.fd).toBe(-1);
  const writerCalls = f.writers.mock.calls.length;
  expect(caughtPreflightError(() => saved!.assertAuthority())).toBe(f.writerError);
  await expect(saved!.assertExternalSelection()).rejects.toBe(f.writerError);
  expect(f.writers.mock.calls.length).toBe(writerCalls); expect(f.mutationCount()).toBe(0);
  expect(await metadataSnapshot(f.root)).toEqual(before); await f.preserved();
});

it.for((['inventory', 'originalBindings'] as const).flatMap(route =>
  (['current', 'backup', 'next', 'sync'] as const).map(boundary => [route, boundary] as const)))(
  'cold binding %s retains native evidence at %s full-selection failure', async ([route, boundary], test) => {
    const f = route === 'inventory' ? await fixture(test, 'workspaceImport', undefined, false, { coldSelection: true }) : await originalMetadataFixture(test, 'workspaceImport', { coldSelection: true });
    const journalBefore = await readFile(f.journalPath), value = parseWorkspaceDeletionJournalBytes(journalBefore);
    expect(value.formatVersion).toBe(route === 'inventory' ? 1 : 2);
    expect(value.inventory.recordCount).toBe(route === 'inventory' ? 2 : 1);
    // Model the legitimate cut after only this fixture's original-journal retirement.
    for (const suffix of ['', '.backup', '.next']) await rm(f.ownerJournalPath + suffix, { force: true });
    const selectedPath = boundary === 'backup' || boundary === 'next' ? f.bindingPath + '.' + boundary : f.bindingPath;
    if (selectedPath !== f.bindingPath) await rename(f.bindingPath, selectedPath);
    const { maximumWorkspaceRemnantBindingBytes } = await import('./workspaceRemnantBindingCodec.js');
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding));
    const fs = createNodeCrashSafeFileSlotFileSystem(paths, maximumWorkspaceRemnantBindingBytes);
    const remove = fs.removeSlot.bind(fs), sync = fs.syncDirectory.bind(fs);
    const first = new Error('SYNTHETIC_BINDING_FULL_SELECTION_CHANGED'); let injected = false, callbacks = 0;
    fs.removeSlot = async (slot, guard) => {
      if (slot === boundary) { injected = true; f.fullProof.mockRejectedValueOnce(first); }
      return remove(slot, guard);
    };
    fs.syncDirectory = async guard => {
      if (boundary === 'sync') { injected = true; f.fullProof.mockRejectedValueOnce(first); }
      return sync(guard);
    };
    const selected = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(f.binding), fs);
    const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(function (...args) {
      callbacks++; return clear.apply(selected, args);
    });
    await expect(f.run()).rejects.toBe(first);
    expect(injected).toBe(true); expect(callbacks).toBe(1);
    if (boundary !== 'sync') expect(await readFile(selectedPath)).toEqual(f.bindingBytes);
    else for (const suffix of ['', '.backup', '.next']) await expect(readFile(f.bindingPath + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.preserved(journalBefore);
  },
);

it.for((['workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement'] as const).flatMap(owner =>
  (['current', 'backup', 'next', 'sync'] as const).map(boundary => [owner, boundary] as const)))(
  'cold original journal retains selected %s evidence on late %s full-selection failure', async ([owner, boundary], test) => {
    const f = await fixture(test, owner, undefined, false, { coldSelection: true }), first = new Error('SYNTHETIC_METADATA_FULL_SELECTION_CHANGED');
    const original = await readFile(f.ownerJournalPath);
    const selectedPath = boundary === 'backup' || boundary === 'next' ? f.ownerJournalPath + '.' + boundary : f.ownerJournalPath;
    if (selectedPath !== f.ownerJournalPath) await rename(f.ownerJournalPath, selectedPath);
    const paths = { directoryPath: dirname(f.ownerJournalPath), currentPath: f.ownerJournalPath,
      nextPath: f.ownerJournalPath + '.next', backupPath: f.ownerJournalPath + '.backup' };
    const fs = owner === 'workspaceImport'
      ? createNodeWorkspaceBackupImportJournalFileSystem(createWorkspaceBackupImportJournalPaths(f.root, f.importPath))
      : createNodeCrashSafeFileSlotFileSystem(paths, owner === 'workspaceLegacyAdoption' ? 4096 : 64 * 1024);
    const remove = fs.removeSlot.bind(fs), sync = fs.syncDirectory.bind(fs); let injected = false;
    fs.removeSlot = async (slot, guard) => {
      if (slot === boundary) { injected = true; f.fullProof.mockRejectedValueOnce(first); }
      return remove(slot, guard);
    };
    fs.syncDirectory = async guard => {
      if (boundary === 'sync') { injected = true; f.fullProof.mockRejectedValueOnce(first); }
      return sync(guard);
    };
    const prototype = owner === 'workspaceImport' ? WorkspaceBackupImportJournalStore.prototype
      : owner === 'workspaceLegacyAdoption' ? WorkspaceLegacyAdoptionJournalStore.prototype : ProfileRestoreActivationJournalStore.prototype;
    const clear = prototype.clearAfterDeletionPurged;
    const selectedOwner = owner === 'workspaceImport'
      ? new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.importPath, fileSystem: fs })
      : owner === 'workspaceLegacyAdoption' ? new WorkspaceLegacyAdoptionJournalStore(f.root, fs)
        : new ProfileRestoreActivationJournalStore(f.ownerJournalPath, fs);
    vi.spyOn(prototype, 'clearAfterDeletionPurged').mockImplementationOnce((...args: Parameters<WorkspaceBackupImportJournalStore['clearAfterDeletionPurged']>) =>
      (clear as WorkspaceBackupImportJournalStore['clearAfterDeletionPurged']).apply(selectedOwner, args));
    await expect(f.run()).rejects.toBe(first); expect(injected).toBe(true);
    if (boundary !== 'sync') expect(await readFile(selectedPath)).toEqual(original);
    else await expect(readFile(f.ownerJournalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
  },
);

it.for((['contexts', 'originalBindings', 'preflightInventory', 'assertPurged'] as const).flatMap(group =>
  (['persistent', 'restored'] as const).map(mode => [group, mode] as const)))(
  'cold read group metadata %s models %s external selection within read group', async ([group, mode], test) => {
    const f = group === 'originalBindings' ? await originalMetadataFixture(test, 'workspaceImport', { coldSelection: true }) : await fixture(test, 'workspaceImport', undefined, false, { coldSelection: true });
    const journalBefore = await readFile(f.journalPath), originalBefore = await readFile(f.ownerJournalPath);
    const first = new Error('SYNTHETIC_PERSISTENT_GROUP_CHANGE'), stopped = new Error('SYNTHETIC_READ_GROUP_CONTROL_COMPLETE');
    let externalChanged = false, injected = false, rawSawChange = false, successfulBookends = 0;
    f.fullProof.mockImplementation(async () => {
      f.authority.assertCurrent(); if (externalChanged) throw first;
      if (injected && ++successfulBookends === 2) throw stopped;
    });
    const inject = async (rawCheck: () => Promise<unknown>) => {
      if (injected) return;
      injected = true; externalChanged = true; const before = f.fullProof.mock.calls.length;
      await rawCheck(); rawSawChange = true;
      expect(f.fullProof.mock.calls.length).toBe(before);
      if (mode === 'restored') externalChanged = false;
    };
    if (group === 'contexts') {
      const read = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
      vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function (this: WorkspaceBackupImportJournalStore, ...args) {
        const result = await read.apply(this, args); await inject(f.authority.assertOwned); return result;
      });
    } else if (group === 'originalBindings') {
      const read = WorkspaceRemnantBindingStore.prototype.inspectCommittedDeletionSlots;
      vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedDeletionSlots').mockImplementationOnce(async function (this: WorkspaceRemnantBindingStore, target, proof) {
        const result = await read.call(this, target, proof); await inject(proof.assertExternalSelection); return result;
      });
    } else {
      const read = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords; let rounds = 0;
      vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, value, scope, consume) {
        const selected = ++rounds === (group === 'assertPurged' ? 1 : 2);
        return read.call(this, value, scope, async row => {
          if (selected) await inject(scope.assertExternalSelection);
          await consume(row);
        });
      });
    }
    const mutations = [vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'clearAfterDeletionPurged'),
      vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'clearAfterDeletionPurged'),
      vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'clearAfterDeletionPurged'),
      vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent')];
    await expect(f.run()).rejects.toBe(mode === 'persistent' ? first : stopped);
    expect(injected).toBe(true); expect(rawSawChange).toBe(true);
    expect(successfulBookends).toBe(mode === 'persistent' ? 0 : 2);
    expect(mutations.every(method => method.mock.calls.length === 0)).toBe(true);
    expect(await readFile(f.ownerJournalPath)).toEqual(originalBefore); expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
    await f.preserved(journalBefore);
  },
);

function metadataFailureLeaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(metadataFailureLeaves) : [error];
}

it('post-clear shared evidence fixture returns the original and actual close failure', async test => {
  const first = new Error('SYNTHETIC_METADATA_EVIDENCE_FIRST', { cause: new Error('SYNTHETIC_METADATA_EVIDENCE_CAUSE') });
  const close = new Error('SYNTHETIC_METADATA_EVIDENCE_CLOSE');
  const error = await captureWorkspaceDeletionMetadataPostClearTestFailure(test, first, close);
  expect((error as AggregateError).errors[0]).toBe(first);
  expect((error as AggregateError).errors[1]).toBe(close);
});

async function metadataPostClearFixture(test: TestContext, cold = false, twoKeys = false) {
  const f = twoKeys ? await fixture(test, 'workspaceImport', 'workspaceReplacement', false, { coldSelection: cold })
    : await secondBindingFixture(test, cold);
  if (twoKeys) for (const suffix of ['', '.next', '.backup']) await rm(f.importPath + suffix, { force: true });
  let clearDone = false, postDone = false;
  const clear = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function(this: WorkspaceRemnantBindingStore, ...args) {
    const result = await clear.apply(this, args); clearDone = true; return result;
  });
  const read = WorkspaceRemnantBindingStore.prototype.inspectCommittedDeletionSlots;
  const hooks: { read?: (run: () => ReturnType<typeof read>, scope: Parameters<typeof read>[1]) => ReturnType<typeof read> } = {};
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspectCommittedDeletionSlots').mockImplementation(async function(this: WorkspaceRemnantBindingStore, target, scope) {
    const run = () => read.call(this, target, scope);
    if (!clearDone || postDone) return run();
    try { return await (hooks.read?.(run, scope) ?? run()); }
    finally { postDone = true; }
  });
  return { f, hooks, postDone: () => postDone };
}

for (const failureKind of ['error', 'undefined'] as const) it.for([failureKind])('post-clear returned chain includes outer close after %s',
  failureKind === 'undefined' ? { timeout: 10_000 } : {}, async (kind, test) => {
  const first = kind === 'error' ? new Error('SYNTHETIC_POSTREAD_FIRST') : undefined;
  const later = new Error('SYNTHETIC_OUTER_INVENTORY_CLOSE');
  const error = await captureWorkspaceDeletionMetadataPostClearTestFailure(test, first, later);
  const leaves = metadataFailureLeaves(error);
  expect(leaves[0]).toBe(first); expect(leaves).toContain(later);
});

it.for(['persistent', 'restored'] as const)('post-clear detects %s payload after completed clear', { timeout: 10_000 }, async (mode, test) => {
  const t = await metadataPostClearFixture(test), { f } = t;
  const kept = join(f.paths.candidateRoot, 'postread-payload'); let entered = false;
  t.hooks.read = async run => {
    entered = true; await mkdir(f.paths.candidateRoot, { mode: 0o700 });
    await writeFile(kept, 'synthetic postread payload', { flag: 'wx', mode: 0o600 });
    try { return await run(); } finally { if (mode === 'restored') await rm(f.paths.candidateRoot, { recursive: true }); }
  };
  const outcome = await f.run().then(value => ({ value }), error => ({ error }));
  expect('error' in outcome).toBe(mode === 'persistent'); expect(entered).toBe(true);
  if (mode === 'persistent') expect(await readFile(kept, 'utf8')).toBe('synthetic postread payload');
  await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' }); await f.preserved();
});

for (const selectionMode of ['persistent', 'restored'] as const) it.for([selectionMode])('post-clear detects %s cold selection after completed clear',
  selectionMode === 'restored' ? { timeout: 10_000 } : {}, async (mode, test) => {
  const t = await metadataPostClearFixture(test, true), { f } = t; let changed = false, observed = false;
  const first = new Error('SYNTHETIC_POSTREAD_STABLE_CHANGED');
  f.fullProof.mockImplementation(async () => { f.authority.assertCurrent(); if (changed) { observed = true; throw first; } });
  t.hooks.read = async run => { changed = true; try { return await run(); } finally { if (mode === 'restored') changed = false; } };
  const outcome = await f.run().then(value => ({ value }), error => ({ error }));
  expect('error' in outcome).toBe(mode === 'persistent'); expect(observed).toBe(mode === 'persistent');
  if ('error' in outcome) expect(outcome.error).toBe(first);
  await f.preserved();
});

for (const returnedKind of ['current', 'next', 'backup', 'foreignWorkspace', 'foreignLineage', 'digest', 'invalidJson'] as const) it.for([returnedKind])(
  'post-clear preserves returned %s slot before its read', returnedKind === 'foreignWorkspace' ? { timeout: 10_000 } : {}, async (kind, test) => {
    const t = await metadataPostClearFixture(test), { f } = t;
    const path = f.bindingPath + (kind === 'current' ? '' : kind === 'next' ? '.next' : '.backup');
    const bytes = kind === 'foreignWorkspace' ? serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, workspaceId: id(211) }))
      : kind === 'foreignLineage' ? serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, lineageIdentity: { ...f.binding.lineageIdentity, profileId: 'f'.repeat(64) } }))
        : kind === 'digest' ? serializeWorkspaceRemnantBinding(captureWorkspaceRemnantBinding({ ...f.binding, operationId: id(212) }))
          : kind === 'invalidJson' ? Buffer.from('{invalid') : f.bindingBytes;
    t.hooks.read = async run => { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); return run(); };
    await expect(f.run()).rejects.toThrow(); expect(await readFile(path)).toEqual(bytes); await f.preserved();
  });

it('post-clear catches a file added after its slot read at the later full metadata check', async test => {
  const t = await metadataPostClearFixture(test), { f } = t;
  let readCompleted = false, inserted = false, captured: SecondBindingSlots | undefined;
  t.hooks.read = async run => {
    const slots = await run(); readCompleted = true; captured = slots;
    await writeFile(f.bindingPath, f.bindingBytes, { flag: 'wx', mode: 0o600 }); inserted = true; return slots;
  };
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); expect(readCompleted).toBe(true);
  expect(inserted).toBe(true); expect(Object.values(captured!).every(slot => slot === undefined)).toBe(true);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it('post-clear preserves an original journal returning after clear', async test => {
  const t = await metadataPostClearFixture(test), { f } = t;
  const bytes = serializeWorkspaceBackupImportJournal(f.importValue);
  t.hooks.read = async run => { const slots = await run(); await writeFile(f.importPath, bytes, { flag: 'wx', mode: 0o600 }); return slots; };
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.importPath)).toEqual(Buffer.from(bytes)); await f.preserved();
});

it('post-clear rejects a sustained inventory rewrite without discarding changed bytes', async test => {
  const t = await metadataPostClearFixture(test), { f } = t;
  const journal = await readFile(f.journalPath), bytes = await readFile(f.inventoryPath), changed = Buffer.alloc(bytes.length, 0);
  const before = await metadataSnapshot(f.root);
  t.hooks.read = async run => { await writeFile(f.inventoryPath, changed); return run(); };
  await expect(f.run()).rejects.toThrow();
  expect(await readFile(f.journalPath)).toEqual(journal); expect(await readFile(f.inventoryPath)).toEqual(changed);
  const after = await metadataSnapshot(f.root), { relative } = await import('node:path');
  const modified = new Set([f.inventoryPath, f.bindingPath].map(path => relative(f.root, path).replaceAll('\\', '/')));
  for (const [path, value] of Object.entries(before)) if (!modified.has(path)) expect(after[path]).toBe(value);
});

it.for(['read', 'close'] as const)('post-clear joins a held real binding %s on revocation', async (where, test) => {
  const t = await metadataPostClearFixture(test), { f } = t; let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  t.hooks.read = async run => {
    await writeFile(f.bindingPath, f.bindingBytes, { flag: 'wx', mode: 0o600 }); metadataIo.path = f.bindingPath;
    metadataIo[where === 'read' ? 'afterRead' : 'beforeClose'] = async () => { enter(); await held; }; return run();
  };
  let settled = false;
  const result = f.run().then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('POSTREAD_BINDING_NOT_HELD'); })]);
    f.revoke(); await setImmediate(); expect(settled).toBe(false); expect(metadataIo.live.size).toBe(1);
  } finally { release(); await result; }
  expect(metadataIo.live.size).toBe(0); expect('error' in await result).toBe(true);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

it('post-clear expires the read callback before trailing full proof and does no stale IO', async test => {
  const t = await metadataPostClearFixture(test, true), { f } = t;
  let saved: Parameters<WorkspaceRemnantBindingStore['inspectCommittedDeletionSlots']>[1] | undefined;
  let checked = false, endedAtBoundary = false;
  t.hooks.read = async (run, scope) => { saved = scope; return run(); };
  f.fullProof.mockImplementation(async () => {
    f.authority.assertCurrent();
    if (t.postDone() && !checked) { checked = true; try { saved!.assertAuthority(); } catch { endedAtBoundary = true; } }
  });
  await f.run(); expect(checked).toBe(true); expect(endedAtBoundary).toBe(true);
  const reads = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots'), before = reads.mock.calls.length;
  await expect(saved!.assertExternalSelection()).rejects.toThrow(); expect(reads.mock.calls.length).toBe(before); await f.preserved();
});

it('post-clear stops before the next real key after a returned payload', { timeout: 10_000 }, async test => {
  const t = await metadataPostClearFixture(test, false, true), { f } = t;
  const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent');
  const kept = join(f.paths.candidateRoot, 'next-key-must-not-run');
  t.hooks.read = async run => {
    await mkdir(f.paths.candidateRoot, { mode: 0o700 });
    await writeFile(kept, 'synthetic retained next-key payload', { flag: 'wx', mode: 0o600 }); return run();
  };
  await expect(f.run()).rejects.toThrow(); expect(clear).toHaveBeenCalledTimes(1);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
  expect(await readFile(kept, 'utf8')).toBe('synthetic retained next-key payload'); await f.preserved();
});

it('post-clear leaves actual-clear cause preference unchanged before postread', async test => {
  const t = await metadataPostClearFixture(test), { f } = t;
  const clearFailure = new Error('SYNTHETIC_ACTUAL_CLEAR_FAILED'), later = new Error('SYNTHETIC_CLEAR_OUTER_CLOSE_FAILED');
  const { maximumWorkspaceRemnantBindingBytes } = await import('./workspaceRemnantBindingCodec.js');
  const fs = createNodeCrashSafeFileSlotFileSystem(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)), maximumWorkspaceRemnantBindingBytes);
  const remove = fs.removeSlot.bind(fs); let nativeGuard = false;
  fs.removeSlot = (slot, guard) => remove(slot, { assertAuthority: guard!.assertAuthority, async beforeMutation() {
    await guard!.beforeMutation(); nativeGuard = true; throw clearFailure;
  } });
  const selected = new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(f.binding), fs);
  const clear = vi.mocked(WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent).getMockImplementation()!;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation((...args) => clear.apply(selected, args));
  const inventory = await import('./workspaceDeletionInventoryFile.js'), open = inventory.openWorkspaceDeletionInventoryFile;
  let enter!: () => void, release!: () => void, closed = 0;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  vi.spyOn(inventory, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    const file = await open(...args);
    return { ...file, async close() {
      if (nativeGuard && args[0] === f.inventoryPath) { enter(); await held; await file.close(); closed++; throw later; }
      await file.close();
    } };
  });
  let settled = false;
  const result = f.run().then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await Promise.race([entered, result.then(() => { throw new Error('CLEAR_CLOSE_NOT_HELD'); })]);
    expect(nativeGuard).toBe(true); expect(settled).toBe(false); expect(closed).toBe(0); f.revoke();
  } finally { release(); await result; }
  expect((await result as { error: unknown }).error).toBe(f.first);
  expect(closed).toBe(1); expect(t.postDone()).toBe(false);
  expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes); await f.preserved();
});

for (const round of [1, 2, 3, 4] as const) for (const kind of ['error', 'undefined'] as const) {
  it(`committed prefix retains first ${kind} and actual outer close at round ${round}`, async test => {
    const f = await secondBindingFixture(test);
    const first = kind === 'error' ? new Error('SYNTHETIC_COMMITTED_PREFIX_FIRST') : undefined;
    const closing = new Error('SYNTHETIC_COMMITTED_PREFIX_OUTER_CLOSE');
    const primitive = await import('../persistence/crashSafeByteSlotStore.js');
    const phaseModule = await import('./workspaceDeletionPhaseSelection.js');
    const inventory = await import('./workspaceDeletionInventoryFile.js');
    let inSelectedPrefix = false, inBindingClear = false, unrelatedReadSelection = false;
    let calls = 0, injected = false, closed = 0;
    const clearBinding = WorkspaceRemnantBindingStore.prototype.clearCommittedAfterPayloadsAbsent;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearCommittedAfterPayloadsAbsent').mockImplementation(async function(
      this: WorkspaceRemnantBindingStore, ...args
    ) {
      expect(inBindingClear).toBe(false);
      inBindingClear = true;
      try { return await clearBinding.apply(this, args); }
      finally { inBindingClear = false; }
    });
    const capture = phaseModule.captureWorkspaceDeletionPhaseSelection;
    vi.spyOn(phaseModule, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async input => {
      const selected = await capture(input);
      return { ...selected, async assertSelected() {
        if (inSelectedPrefix) { injected = true; f.revoke(); throw first; }
        await selected.assertSelected();
      } };
    });
    const clear = primitive.CrashSafeByteSlotStore.prototype.clearSelected;
    vi.spyOn(primitive.CrashSafeByteSlotStore.prototype, 'clearSelected').mockImplementation(async function(
      this: InstanceType<typeof primitive.CrashSafeByteSlotStore>, selected, readSelection,
    ) {
      // The import journal has its own read prefix; inject only into binding cleanup.
      if (!inBindingClear || readSelection === undefined) {
        if (readSelection !== undefined) unrelatedReadSelection = true;
        return clear.call(this, selected, readSelection);
      }
      return clear.call(this, selected, { async assertBeforeSlotRead() {
        expect(inBindingClear).toBe(true);
        inSelectedPrefix = ++calls === round;
        try { await readSelection.assertBeforeSlotRead(); }
        finally { inSelectedPrefix = false; }
      } });
    });
    const open = inventory.openWorkspaceDeletionInventoryFile;
    vi.spyOn(inventory, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
      const file = await open(...args);
      return { ...file, async close() {
        await file.close();
        if (injected && args[0] === f.inventoryPath) { closed++; throw closing; }
      } };
    });
    const result = await f.run().then(value => ({ value }), error => ({ error }));
    expect(unrelatedReadSelection).toBe(true);
    expect('error' in result).toBe(true); expect(calls).toBe(round); expect(injected).toBe(true); expect(closed).toBe(1);
    const error = (result as { error: unknown }).error;
    expect(error).toBeInstanceOf(AggregateError);
    const outer = error as AggregateError;
    expect(outer.errors).toHaveLength(2); expect(outer.errors[1]).toBe(closing);
    expect(Object.hasOwn(outer, 'cause')).toBe(false);
    if (round === 2) {
      expect(outer.errors[0]).toBeInstanceOf(AggregateError);
      const inner = outer.errors[0] as AggregateError;
      expect(inner.errors).toHaveLength(2); expect(inner.errors[0]).toBe(first); expect(inner.cause).toBe(first);
      expect(Object.hasOwn(inner, 'cause')).toBe(true);
      expect(inner.errors[1]).toMatchObject({ name: 'CrashSafeFileSlotError', message: 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE', failure: 'unavailable' });
      expect(metadataFailureLeaves(error)).toEqual([first, inner.errors[1], closing]);
    } else {
      expect(outer.errors[0]).toBe(first); expect(metadataFailureLeaves(error)).toEqual([first, closing]);
    }
    const leaves = metadataFailureLeaves(error);
    expect(leaves[0]).toBe(first); expect(leaves).toContain(closing);
    if (round <= 2) expect(await readFile(f.bindingPath)).toEqual(f.bindingBytes);
    else await expect(readFile(f.bindingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.preserved();
  });
}
