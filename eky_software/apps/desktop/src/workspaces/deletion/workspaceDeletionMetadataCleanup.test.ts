import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
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
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { deriveWorkspaceReplacementRemnantRoot } from './workspaceReplacementRemnantPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey, workspaceRemnantBindingSha256 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

type FixtureOwner = 'workspaceImport' | 'workspaceLegacyAdoption' | 'workspaceReplacement' | 'workspaceActivationMigration';

async function fixture(test: TestContext, owner: FixtureOwner = 'workspaceImport',
  secondOwner?: 'workspaceLegacyAdoption' | 'workspaceReplacement') {
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
  const inventory = await new WorkspaceDeletionInventoryStore(root, header.operationId).publish(header, (async function* () { yield* rows; })(), external);
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
  const foreign = captureWorkspaceRemnantBinding({ ...binding, operationId: id(202), workspaceId: before.workspaces[0]!.workspaceId,
    lineageIdentity: before.workspaces[0]!.lineageIdentity });
  await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(foreign)).publish(foreign, external);
  const foreignPath = createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(foreign)).currentPath;
  const foreignBytes = await readFile(foreignPath), keptPath = join(root, 'external-backup'), keptBytes = Buffer.from('preserved synthetic external bytes');
  await writeFile(keptPath, keptBytes, { mode: 0o600, flag: 'wx' });
  const journalPath = createWorkspaceDeletionJournalPaths(root).currentPath, journalBytes = await readFile(journalPath);
  const inventoryPath = createWorkspaceDeletionInventoryPaths(root, header.operationId).currentPath, inventoryBytes = await readFile(inventoryPath);
  const bindingPath = createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(binding)).currentPath, bindingBytes = await readFile(bindingPath);
  const cleaner = createWorkspaceDeletionMetadataCleaner({ userDataRoot: root, registry, async assertWritersAbsent() { assertCurrent(); } });
  return { root, target, paths, binding, secondBinding, bindingStore, bindingPath, bindingBytes, importStore, importPath, importValue, ownerJournalPath, journalPath, inventoryPath, authority, first, releases,
    revoke() { active = false; },
    run() { const result = cleaner(header.operationId, authority); jobs.push(result); return result; },
    async preserved() {
      expect(await readFile(journalPath)).toEqual(journalBytes); expect(await readFile(inventoryPath)).toEqual(inventoryBytes);
      expect(await readFile(foreignPath)).toEqual(foreignBytes); expect(await readFile(keptPath)).toEqual(keptBytes);
      expect(await readFile(registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(after)));
    },
  };
}

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
