import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import { createWorkspaceDeletionColdContinuation } from '../../main/workspaceDeletionContinuation.js';
import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths, WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { createAdoptionJournal } from '../adoption/workspaceLegacyAdoptionTestSupport.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../creation/workspaceCreationJournalPaths.js';
import { deletionTestId, deletionTestJournal } from '../deletion/workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, workspaceDeletionPhases,
  type WorkspaceDeletionJournal, type WorkspaceDeletionOriginalJournalProof } from '../deletion/workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from '../deletion/workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionOriginalJournals } from '../deletion/workspaceDeletionOriginalJournalSelection.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../import/workspaceBackupImportJournalStore.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService } from '../management/workspaceManagementService.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../replacement/workspaceBackupReplacementPaths.js';
import { createSwitchRegistry, createSwitchWorkspace, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceSwitchJournalPaths } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';
import { captureColdWorkspaceDeletionAdmissionFromRoot as capture, readColdWorkspaceRecoveryAdmissionFromRoot } from './workspaceColdRecoveryAdmissionComposition.js';
import { captureWorkspaceDeletionExternalSelectionFromRoot } from './workspaceDeletionColdAdmission.js';

const required = 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED';
const time = '2026-10-25T12:00:00.000Z';
const otherWorkspaceId = validateWorkspaceId(deletionTestId(303));
const accepted = { formatVersion: 1, acceptedAt: time, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot' };
const buildInfo = { schemaVersion: 1 as const, appVersion: accepted.appVersion, buildRevision: accepted.buildRevision, buildCreatedAt: time, buildDirty: false };
const releaseInfo = { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: accepted.appVersion,
  msiProductVersion: accepted.appVersion, buildRevision: accepted.buildRevision, platform: 'win32' as const,
  architecture: 'x64' as const, releaseChannel: 'pilot' as const, upgradeCode: deletionTestId(50) };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Owner = WorkspaceDeletionOriginalJournalProof['owner'];

async function fixture(test: TestContext, phase: WorkspaceDeletionJournal['phase'] = 'authorized', afterRegistry = phase === 'registryPublished',
  mode: 'passive' | 'active' | 'last' | 'faulted' = 'passive') {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-cold-'));
  let active = true, writer = false;
  const jobs: Promise<unknown>[] = [], releases: (() => void)[] = [];
  const receipts: NonNullable<Awaited<ReturnType<typeof capture>>>[] = [];
  const externalReceipts: Awaited<ReturnType<typeof captureWorkspaceDeletionExternalSelectionFromRoot>>[] = [];
  const coldOwners: ReturnType<typeof createWorkspaceDeletionColdContinuation>[] = [];
  const lost = new Error('SYNTHETIC_COLD_OWNER_LOST'), writerError = new Error('SYNTHETIC_COLD_WRITER_PRESENT');
  const check = () => { test.signal.throwIfAborted(); if (!active) throw lost; };
  const track = <T>(work: () => Promise<T>) => { const task = work(); jobs.push(task); return task; };
  test.onTestFinished(async ({ task }) => {
    active = false; for (const release of releases) release();
    await Promise.allSettled(jobs); for (const receipt of [...receipts, ...externalReceipts]) receipt.revoke(); vi.restoreAllMocks();
    await Promise.all(coldOwners.map(value => value.owner.close()));
    if (task.result?.state === 'pass' && !test.signal.aborted) await rm(root, { recursive: true, force: true });
  });
  const input = { userDataRoot: root, buildInfo, releaseInfo,
    assertCurrent: vi.fn(check), assertOwned: vi.fn(async () => { check(); }),
    assertWritersAbsent: vi.fn(async () => { check(); if (writer) throw writerError; }) };
  const authority = { assertAuthority: input.assertCurrent, assertExternalSelection: input.assertOwned,
    assertWritersAbsent: input.assertWritersAbsent };
  async function put(path: string, value: unknown) {
    check(); await mkdir(dirname(path), { recursive: true }); check();
    await writeFile(path, value instanceof Uint8Array ? value : typeof value === 'string' ? value : JSON.stringify(value)); check();
  }
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const base = createSwitchRegistry(mode === 'active' || mode === 'last' ? TEST_TARGET_WORKSPACE_ID : undefined);
  const before = { ...base, formatVersion: 2 as const,
    workspaces: mode === 'last' ? base.workspaces.filter(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)
      : [...base.workspaces.map(entry => mode === 'faulted' && entry.workspaceId === TEST_TARGET_WORKSPACE_ID
        ? { ...entry, lifecycleState: 'recoveryRequired' as const } : entry),
      createSwitchWorkspace(otherWorkspaceId, 'Synthetic other workspace', 'c')],
  };
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID, expectedActiveWorkspaceId: before.activeWorkspaceId });
  const target = before.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const journalPaths = createWorkspaceDeletionJournalPaths(root);
  let journal = captureWorkspaceDeletionJournal({ ...deletionTestJournal(phase),
    target: { ...deletionTestJournal().target, workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity,
      registryEntrySha256: workspaceRegistryEntrySha256(target) }, previousActiveWorkspaceId: before.activeWorkspaceId,
    registryBeforeSha256: digest(serializeWorkspaceRegistry(before)), registryAfterSha256: digest(serializeWorkspaceRegistry(after)) });
  const update = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: createDesktopProfilePaths(root).runtimeRoot });
  await put(update.acceptedBuildMetadataPath, accepted);
  await put(registryPath, serializeWorkspaceRegistry(afterRegistry ? after : before));
  // These are native published-phase fixtures, not proof of unperformed payload stages.
  await put(journalPaths.currentPath, serializeWorkspaceDeletionJournal(journal).toString('utf8'));
  const targetRoot = deriveWorkspaceRoot(root, target.workspaceId, 1).workspaceRoot;
  const restore = (profileRoot: string) => createProfileSnapshotRuntimePaths(createDesktopProfilePaths(profileRoot).runtimeRoot).restoreActivationJournalPath;
  const paths = {
    creation: createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)).currentPath,
    switch: createWorkspaceSwitchJournalPaths(root).currentPath,
    migration: createWorkspaceFirstStartMigrationJournalPaths(root).currentPath,
    legacyRestore: restore(root), targetRestore: restore(targetRoot),
    previousRestore: restore(deriveWorkspaceRoot(root, before.activeWorkspaceId!, 1).workspaceRoot),
    passiveRestore: restore(deriveWorkspaceRoot(root, otherWorkspaceId, 1).workspaceRoot),
    import: join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
    adoption: createWorkspaceLegacyAdoptionJournalPaths(root).currentPath,
    activation: deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath,
  };
  async function snapshot() {
    const result: Record<string, unknown> = {};
    const visit = async (relative: string): Promise<void> => {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const name = join(relative, entry.name), path = join(root, name), stat = await lstat(path);
        result[name] = { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
          kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file',
          bytes: entry.isFile() ? (await readFile(path)).toString('hex') : undefined };
        if (entry.isDirectory()) await visit(name);
      }
    };
    await visit(''); return result;
  }
  const addOriginal = (owner: Owner) => track(async () => {
    const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner, operationId: deletionTestId(300),
      workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
    await new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(binding)).publish(binding, authority);
    if (owner === 'workspaceImport') await new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: paths.import }).write({
      formatVersion: 2, operationId: binding.operationId, workspaceId: target.workspaceId, workspaceLabel: 'Synthetic cold selection',
      createdAt: time, previousActiveWorkspaceId: before.activeWorkspaceId, state: 'prepared', lineageIdentity: null });
    else if (owner === 'workspaceLegacyAdoption') await new WorkspaceLegacyAdoptionJournalStore(root).write({
      ...createAdoptionJournal('prepared'), operationId: binding.operationId, workspaceId: target.workspaceId });
    else {
      await mkdir(dirname(paths.activation), { recursive: true });
      await new ProfileRestoreActivationJournalStore(paths.activation).write({ formatVersion: 1, operationId: binding.operationId,
        phase: 'prepared', revision: 0, hadActiveDatabase: true, hadActiveDocuments: true });
    }
    const original = await captureWorkspaceDeletionOriginalJournals(root, journal.target, authority);
    try { journal = captureWorkspaceDeletionJournal({ ...journal, formatVersion: 2, originalJournalProofs: original.proofs }); }
    finally { original.revoke(); }
    await put(journalPaths.currentPath, serializeWorkspaceDeletionJournal(journal).toString('utf8'));
    return { binding, bindingPath: createWorkspaceRemnantBindingPaths(root, workspaceRemnantBindingKey(binding)).currentPath,
      journalPath: owner === 'workspaceImport' ? paths.import : owner === 'workspaceLegacyAdoption' ? paths.adoption : paths.activation };
  });
  return { root, input, registry, registryPath, before, after, target, targetRoot, journalPaths, paths, update, put, snapshot, addOriginal,
    releases, lost, writerError, get journal() { return journal; }, run: track,
    loseOwner() { active = false; }, addWriter() { writer = true; }, removeWriter() { writer = false; },
    capture: () => track(async () => { const result = await capture(input); if (result !== undefined) receipts.push(result); return result; }),
    captureExternal: () => track(async () => {
      const result = await captureWorkspaceDeletionExternalSelectionFromRoot({ ...input, journal, afterRegistry: after });
      externalReceipts.push(result); return result;
    }),
    createContinuation() {
      const value = createWorkspaceDeletionColdContinuation({ ...input, journal }); coldOwners.push(value); return value;
    },
  };
}

it.for(['authorized', 'registryPublished'] as const)('keeps native original proof through the main %s metadata handoff', async (phase, test) => {
  const f = await fixture(test, phase), original = await f.addOriginal('workspaceImport');
  const before = await f.snapshot(), continuation = f.createContinuation();
  await f.run(() => continuation.owner.assertOwned());
  expect(await f.snapshot()).toEqual(before);
  // Advance only the synthetic phase fixture, not a claim of executed payload deletion.
  await f.put(f.journalPaths.currentPath, serializeWorkspaceDeletionJournal({ ...f.journal, phase: 'registryPublished' }));
  await f.put(f.registryPath, serializeWorkspaceRegistry(f.after));
  await f.run(continuation.beforeMetadata);
  await rm(original.journalPath); await rm(original.bindingPath);
  const retired = await f.snapshot();
  await f.run(() => continuation.owner.assertOwned());
  expect(await f.snapshot()).toEqual(retired);
});

it('rejects a real original binding change before the main handoff without mutating evidence', async test => {
  const f = await fixture(test), original = await f.addOriginal('workspaceImport');
  const continuation = f.createContinuation(); await f.run(() => continuation.owner.assertOwned());
  await f.put(original.bindingPath, '{}');
  const changed = await f.snapshot();
  await expect(f.run(continuation.beforeMetadata)).rejects.toThrow();
  expect(() => continuation.owner.assertCurrent()).toThrow();
  expect(await f.snapshot()).toEqual(changed);
});

it('keeps the service admission receipt pinned across actual main-owner initialization', async test => {
  const f = await fixture(test), original = await f.addOriginal('workspaceImport'), initial = await f.capture();
  const continuation = f.createContinuation(), lease = new InMemoryWorkspaceMaintenanceLease();
  const resume = vi.fn(async () => { throw new Error('SYNTHETIC_UNEXPECTED_RESUME'); });
  let closed = false;
  await expect(f.run(() => WorkspaceManagementService.recoverDeletionBeforeRuntime({
    selection: initial!, maintenanceLease: lease,
    async captureSelection(assertLease) { assertLease(); return f.capture(); },
    async captureAuthority(_journal, assertLease) {
      assertLease();
      return { ...continuation.owner, async assertOwned() {
        await continuation.owner.assertOwned();
        const bytes = await readFile(original.bindingPath);
        await rename(original.bindingPath, `${original.bindingPath}.preserved`);
        await writeFile(original.bindingPath, bytes);
      }, async close() { await continuation.owner.close(); closed = true; } };
    },
    resumeSelected: resume, assertCurrent: f.input.assertCurrent,
    isStopping: () => false, onUncertain: vi.fn(),
  }))).rejects.toThrow();
  expect(resume).not.toHaveBeenCalled(); expect(closed).toBe(true); expect(lease.readState()).toBe('idle');
  expect(await readFile(original.bindingPath)).toEqual(await readFile(`${original.bindingPath}.preserved`));
});

it.for(workspaceDeletionPhases)('observes the native published %s fixture without repairing any owner', async (phase, test) => {
  const f = await fixture(test, phase), before = await f.snapshot();
  const repairing = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
  const mutation = vi.spyOn(WorkspaceRegistryStore.prototype, 'write');
  const result = await f.capture();
  expect(result).toMatchObject({ journal: { phase }, buildAdmission: 'exactAcceptedBuild',
    registryState: phase === 'registryPublished' ? 'after' : 'before' });
  await f.run(() => result!.assertSelected());
  expect(repairing).not.toHaveBeenCalled(); expect(mutation).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
});

it('keeps the stable base independent of owned phase changes without weakening full admission', async test => {
  const f = await fixture(test), initial = await f.capture(), external = await f.captureExternal();
  await f.put(f.journalPaths.currentPath, serializeWorkspaceDeletionJournal({ ...f.journal, phase: 'purged' }));
  await f.put(f.registryPath, serializeWorkspaceRegistry(f.after));
  const before = await f.snapshot();
  const phaseRead = vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'inspect');
  const registryRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots');
  const repair = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
  const write = vi.spyOn(WorkspaceRegistryStore.prototype, 'write');
  await f.run(() => external.assertSelected());
  expect(phaseRead).not.toHaveBeenCalled(); expect(registryRead).not.toHaveBeenCalled();
  expect(repair).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(await f.snapshot()).toEqual(before);
  await expect(f.run(() => initial!.assertSelected())).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['creation', 'switch', 'migration', 'legacyRestore', 'previousRestore', 'passiveRestore'] as const)(
  'retains the stable base foreign-owner guard for %s', async (kind, test) => {
    const f = await fixture(test), external = await f.captureExternal();
    await f.put(f.paths[kind] + '.backup', 'synthetic late foreign owner');
    const before = await f.snapshot();
    const failure = await f.run(() => external.assertSelected()).catch(cause => cause);
    expect(failure).toMatchObject({ message: required }); expect(await f.snapshot()).toEqual(before);
    await rm(f.paths[kind] + '.backup');
    await expect(f.run(() => external.assertSelected())).rejects.toBe(failure);
  },
);

it('rejects a reduced census input before looking at the external build files', async test => {
  const f = await fixture(test), before = await f.snapshot();
  f.input.assertOwned.mockClear();
  await expect(f.run(() => captureWorkspaceDeletionExternalSelectionFromRoot({ ...f.input, journal: f.journal,
    afterRegistry: { ...f.after, workspaces: f.after.workspaces.filter(entry => entry.workspaceId !== otherWorkspaceId) },
  }))).rejects.toThrow(required);
  expect(f.input.assertOwned).not.toHaveBeenCalled(); expect(await f.snapshot()).toEqual(before);
});

it('retains exact native accepted-build identity in the stable base', async test => {
  const f = await fixture(test), external = await f.captureExternal();
  const bytes = await readFile(f.update.acceptedBuildMetadataPath);
  await rename(f.update.acceptedBuildMetadataPath, f.update.acceptedBuildMetadataPath + '.retained');
  await writeFile(f.update.acceptedBuildMetadataPath, bytes);
  const before = await f.snapshot();
  await expect(f.run(() => external.assertSelected())).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it('joins an original stable-base read after revocation without starting another census', async test => {
  const f = await fixture(test), external = await f.captureExternal(), before = await f.snapshot();
  let entered!: () => void, release!: () => void, settled = false;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  f.input.assertOwned.mockImplementationOnce(async () => { entered(); await held; });
  const work = f.run(() => external.assertSelected()).finally(() => { settled = true; });
  try {
    await Promise.race([started, work.then(() => { throw new Error('SYNTHETIC_EXPECTED_BASE_READ'); })]);
    external.revoke(); expect(settled).toBe(false); release();
    const cause = await work.catch(error => error);
    expect(cause).toMatchObject({ message: required });
    await expect(f.run(() => external.assertSelected())).rejects.toBe(cause);
    expect(await f.snapshot()).toEqual(before);
  } finally { release(); await Promise.allSettled([work]); }
});

it('returns absence without reading unrelated registry or build state, and retains ordinary deletion guards', async test => {
  const f = await fixture(test);
  await rm(f.journalPaths.currentPath); await f.put(f.registryPath, 'unparsed registry');
  await f.put(f.update.acceptedBuildMetadataPath, 'unparsed installation state');
  const before = await f.snapshot();
  await expect(f.capture()).resolves.toBeUndefined();
  expect(await f.snapshot()).toEqual(before);
  await f.put(f.journalPaths.nextPath, 'unparsed deletion evidence');
  const changed = await f.snapshot();
  await expect(f.run(() => readColdWorkspaceRecoveryAdmissionFromRoot(f.root))).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(changed);
});

it.for(['initialNext', 'malformed', 'registryConflict'] as const)('preserves %s without ordinary-startup fallback', async (kind, test) => {
  const f = await fixture(test);
  if (kind === 'initialNext') await rename(f.journalPaths.currentPath, f.journalPaths.nextPath);
  if (kind === 'malformed') await f.put(f.journalPaths.currentPath, '{');
  if (kind === 'registryConflict') await f.put(f.registryPath, { ...f.before, workspaces: [] });
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['creation', 'switch', 'migration', 'legacyRestore', 'previousRestore', 'passiveRestore', 'import', 'adoption', 'activation'] as const)
('rejects the foreign %s owner and keeps every native file', async (kind, test) => {
  const f = await fixture(test);
  await f.put(f.paths[kind] + '.next', 'unresolved owner');
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['active', 'last', 'faulted'] as const)('observes the %s target fixture without opening its database', async (mode, test) => {
  const f = await fixture(test, 'authorized', false, mode);
  const database = createDesktopProfilePaths(f.targetRoot).databaseFilePath;
  await f.put(database, 'not a SQLite database: no business open is permitted');
  const before = await f.snapshot(), result = await f.capture();
  expect(result?.journal.target.workspaceId).toBe(f.target.workspaceId);
  expect(result?.journal.previousActiveWorkspaceId).toBe(f.before.activeWorkspaceId);
  await f.run(() => result!.assertSelected()); expect(await f.snapshot()).toEqual(before);
});

it.for(['phase', 'identity'] as const)('rejects a journal %s change between discovery and joint capture', async (kind, test) => {
  const f = await fixture(test), inspect = WorkspaceDeletionJournalStore.prototype.inspect;
  let observed = false, changed: Awaited<ReturnType<typeof f.snapshot>> | undefined;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'inspect').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const value = await inspect.apply(this, args);
    if (!observed) {
      observed = true;
      if (kind === 'phase') await f.put(f.journalPaths.currentPath,
        serializeWorkspaceDeletionJournal({ ...f.journal, phase: 'quarantined' }).toString('utf8'));
      else {
        const bytes = await readFile(f.journalPaths.currentPath);
        await rename(f.journalPaths.currentPath, f.journalPaths.currentPath + '.retained');
        await writeFile(f.journalPaths.currentPath, bytes);
      }
      changed = await f.snapshot();
    }
    return value;
  });
  await expect(f.capture()).rejects.toThrow(required);
  expect(changed).toBeDefined(); expect(await f.snapshot()).toEqual(changed);
});

it('permits only target-local restore evidence as selected payload, never a foreign linked profile', async test => {
  const f = await fixture(test);
  await f.put(f.paths.targetRestore + '.backup', 'selected workspace payload');
  const before = await f.snapshot(), result = await f.capture();
  expect(result).toBeDefined(); await f.run(() => result!.assertSelected());
  expect(await f.snapshot()).toEqual(before); result!.revoke();
  const previousRoot = deriveWorkspaceRoot(f.root, f.before.activeWorkspaceId!, 1).workspaceRoot;
  const outside = join(f.root, 'outside-synthetic-profile'); await mkdir(outside);
  await symlink(outside, previousRoot, 'junction');
  const changed = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(changed);
});

it.for(['workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration'] as const)
('compares native %s originals against the published v2 commitment', async (owner, test) => {
  const f = await fixture(test); await f.addOriginal(owner);
  const before = await f.snapshot(), result = await f.capture();
  expect(result?.journal.formatVersion).toBe(2); await f.run(() => result!.assertSelected());
  expect(await f.snapshot()).toEqual(before);
});

it('does not give v1 deletion a continuation exception for a valid bound original', async test => {
  const f = await fixture(test); await f.addOriginal('workspaceImport');
  const journal = f.journal;
  await f.put(f.journalPaths.currentPath, serializeWorkspaceDeletionJournal({ ...deletionTestJournal(),
    target: journal.target, previousActiveWorkspaceId: journal.previousActiveWorkspaceId,
    registryBeforeSha256: journal.registryBeforeSha256, registryAfterSha256: journal.registryAfterSha256 }));
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['journal', 'binding'] as const)('rejects a late native original %s replacement through the composed receipt', async (kind, test) => {
  const f = await fixture(test), original = await f.addOriginal('workspaceImport'), result = await f.capture();
  const path = kind === 'journal' ? original.journalPath : original.bindingPath;
  const bytes = await readFile(path); await rename(path, path + '.retained'); await writeFile(path, bytes);
  const before = await f.snapshot();
  await expect(f.run(() => result!.assertSelected())).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
  expect((await readFile(path + '.retained')).equals(bytes)).toBe(true);
});

it('rejects a linked target-local restore ancestor instead of treating its evidence as owned payload', async test => {
  const f = await fixture(test);
  const outside = join(f.root, 'outside-synthetic-target');
  await f.put(join(outside, 'retained'), 'synthetic outside bytes');
  await mkdir(dirname(f.targetRoot), { recursive: true }); await symlink(outside, f.targetRoot, 'junction');
  const before = await f.snapshot();
  await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
  expect(await readFile(join(outside, 'retained'), 'utf8')).toBe('synthetic outside bytes');
});

it.for([false, true])('admits retired import metadata only with the after-registry purged fixture: %s', async (afterRegistry, test) => {
  const f = await fixture(test, 'purged', afterRegistry), original = await f.addOriginal('workspaceImport');
  await rm(original.journalPath); await rm(original.bindingPath);
  const before = await f.snapshot();
  if (afterRegistry) { const result = await f.capture(); expect(result?.registryState).toBe('after'); }
  else await expect(f.capture()).rejects.toThrow(required);
  expect(await f.snapshot()).toEqual(before);
});

it('observes a permitted purged registry cut without repairing its slots', async test => {
  const f = await fixture(test, 'purged');
  await rename(f.registryPath, f.registryPath + '.backup'); await f.put(f.registryPath + '.next', serializeWorkspaceRegistry(f.after));
  const before = await f.snapshot(), result = await f.capture();
  expect(result).toMatchObject({ registryNeedsRecovery: true, registryState: 'before' });
  await f.run(() => result!.assertSelected()); expect(await f.snapshot()).toEqual(before);
});

it.for(['journal', 'registry', 'build', 'foreign'] as const)('rejects a late %s change without rebasing the receipt', async (kind, test) => {
  const f = await fixture(test), result = await f.capture();
  if (kind === 'foreign') await f.put(f.paths.migration + '.backup', 'late owner');
  else {
    const path = kind === 'journal' ? f.journalPaths.currentPath : kind === 'registry' ? f.registryPath : f.update.acceptedBuildMetadataPath;
    const bytes = await readFile(path); await rename(path, path + '.retained'); await writeFile(path, bytes);
  }
  const before = await f.snapshot();
  const failure = await f.run(() => result!.assertSelected()).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe(required);
  await expect(f.run(() => result!.assertSelected())).rejects.toBe(failure);
  expect(await f.snapshot()).toEqual(before);
});

it.for(['journal', 'registry'] as const)('does not adopt new native %s identity during the service lease handoff', async (kind, test) => {
  const f = await fixture(test), selected = await f.capture(), lease = new InMemoryWorkspaceMaintenanceLease();
  expect(selected).toBeDefined();
  const captureAuthority = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_MUTATION_OWNER'); });
  const resumeSelected = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_DELETE_COMMAND'); });
  const path = kind === 'journal' ? f.journalPaths.currentPath : f.registryPath;
  const bytes = await readFile(path);
  let afterChange: Record<string, unknown> | undefined;
  let freshValidated = false;
  const task = f.run(() => WorkspaceManagementService.recoverDeletionBeforeRuntime({
    selection: selected!, maintenanceLease: lease, captureAuthority, resumeSelected,
    assertCurrent: f.input.assertCurrent, isStopping: () => test.signal.aborted,
    onUncertain() {},
    async captureSelection(assertLease) {
      assertLease(); await rename(path, path + '.retained'); await writeFile(path, bytes); assertLease();
      afterChange = await f.snapshot();
      // The fresh receipt is valid on its own, but must not replace the initial one.
      const assertCurrent = () => { f.input.assertCurrent(); assertLease(); };
      const fresh = await capture({ ...f.input, assertCurrent,
        async assertOwned() { assertCurrent(); await f.input.assertOwned(); assertCurrent(); },
        async assertWritersAbsent() { assertCurrent(); await f.input.assertWritersAbsent(); assertCurrent(); },
      });
      if (fresh === undefined) throw new Error('SYNTHETIC_FRESH_SELECTION_MISSING');
      try { await fresh.assertSelected(); freshValidated = true; return fresh; }
      catch (cause) { fresh.revoke(); throw cause; }
    },
  }));
  await expect(task).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  expect(freshValidated).toBe(true);
  expect(captureAuthority).not.toHaveBeenCalled(); expect(resumeSelected).not.toHaveBeenCalled();
  expect(afterChange).toBeDefined(); expect(await f.snapshot()).toEqual(afterChange);
  expect(await readFile(path + '.retained')).toEqual(bytes); expect(lease.readState()).toBe('idle');
});

it('joins an already started ownership observation after revoke and retains the original cause', async test => {
  const f = await fixture(test), result = await f.capture(), before = await f.snapshot();
  let entered!: () => void, release!: () => void, settled = false;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.releases.push(release);
  f.input.assertOwned.mockImplementationOnce(async () => { entered(); await held; });
  const task = f.run(() => result!.assertSelected()).finally(() => { settled = true; });
  await started; result!.revoke(); await Promise.resolve(); expect(settled).toBe(false); release();
  const failure = await task.catch((error: unknown) => error);
  expect((failure as Error).message).toBe(required);
  await expect(f.run(() => result!.assertSelected())).rejects.toBe(failure);
  expect(await f.snapshot()).toEqual(before);
});

it('does not revive a receipt when a previously observed writer disappears', async test => {
  const f = await fixture(test), result = await f.capture(), before = await f.snapshot();
  f.addWriter();
  const failure = await f.run(() => result!.assertSelected()).catch((error: unknown) => error);
  expect(failure).toMatchObject({ message: required, cause: f.writerError });
  f.removeWriter(); await expect(f.run(() => result!.assertSelected())).rejects.toBe(failure);
  expect(await f.snapshot()).toEqual(before);
});
