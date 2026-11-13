import { bindWorkspaceDeletionContinuation, createWorkspaceDeletionResultRuntime,
  type WorkspaceDeletionMainCommand } from './workspaceDeletionContinuation.js';
import { captureWorkspaceDeletionJournal } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi, type TestContext } from 'vitest';
import { acquireWorkspaceProcessReservation } from '../runtime/workspaceProcessReservation.js';
import * as processReservation from '../runtime/workspaceProcessReservation.js';
import { createLocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import { captureWorkspaceDeletionLocalUpdateSelection, createWorkspaceDeletionLocalUpdateReaders } from '../update/workspaceDeletionLocalUpdateSelection.js';
import { captureDeletionInventoryHeader, deletionInventoryFormatVersion } from '../workspaces/deletion/workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionOriginalJournals } from '../workspaces/deletion/workspaceDeletionOriginalJournalSelection.js';
import { remnantTestBinding } from '../workspaces/deletion/workspaceRemnantBindingTestSupport.js';
import { assertDeletionReservationBusy, startDeletionProcessChild } from '../workspaces/deletion/workspaceDeletionProcessTestSupport.js';
import { workspaceRemnantBindingKey } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore } from '../workspaces/deletion/workspaceRemnantBindingStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../workspaces/import/workspaceBackupImportJournalStore.js';
import * as importBindingAdmission from '../workspaces/import/workspaceBackupImportBindingAdmission.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES, getWorkspaceBackupImportStateIndex, assertWorkspaceBackupImportJournalTransition } from '../workspaces/import/workspaceBackupImportJournalValidation.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { workspaceRegistryEntrySha256 } from '../workspaces/registry/workspaceRegistrySerializer.js';
import { sameCrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import { acquireDesktopWorkspaceReservation } from './desktopComposition.js';
import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { createRecoveryObservationExperiment } from './desktopRecoveryStartupExperimentTestSupport.js';
import { createDesktopRecoveryStartup as createRecoveryStartupExperiment } from './desktopRecoveryStartup.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../workspaces/creation/workspaceCreationJournalPaths.js';
import { createWorkspaceSwitchJournalPaths } from '../workspaces/switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../workspaces/update/workspaceFirstStartMigrationJournalPaths.js';
import { createWorkspaceDeletionJournalPaths } from '../workspaces/deletion/workspaceDeletionJournalStore.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { createReadOnlyJournalSlotPaths } from '../workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { hasAnyJournalSlot } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { inspectWorkspaceRoot } from '../workspaces/registry/inspectWorkspaceRoot.js';
import { readWorkspaceProcessReservationIdentity } from '../runtime/workspaceProcessReservation.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { assertProfileRestoreActivationJournalStep, captureProfileRestoreActivationJournal, profileRestoreActivationPhases,
  type ProfileRestoreActivationPhase } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import { discoverRecoveryTargetExperiment } from './desktopWorkspaceRecoveryDiscoveryTestSupport.js';
import { inspectDesktopRecoveryRegistrySelection } from './desktopWorkspaceRecoveryRegistrySelection.js';
import { readDesktopWorkspaceRecoveryCensus, readDesktopWorkspaceRecoverySources,
  readDesktopWorkspaceRecoveryTarget, type DesktopWorkspaceRecoveryReadAuthority } from './desktopWorkspaceRecoverySources.js';
import * as recoverySources from './desktopWorkspaceRecoverySources.js';
import { captureDeletionTarget } from '../workspaces/management/workspaceDeletionTarget.js';
import { createWorkspaceDeletionPublisher } from '../workspaces/deletion/workspaceDeletionPublication.js';
import { WorkspaceDeletionJournalStore } from '../workspaces/deletion/workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionExternalSelectionFromRoot } from '../workspaces/runtime/workspaceDeletionColdAdmission.js';
import { createDesktopWorkspaceRecoverySelection } from './desktopWorkspaceRecoverySelection.js';
import { selectDesktopWorkspaceRecoveryChoice } from './desktopWorkspaceRecoveryChoice.js';
import { createAdoptionJournal } from '../workspaces/adoption/workspaceLegacyAdoptionTestSupport.js';
import { assertWorkspaceLegacyAdoptionTransition, createWorkspaceLegacyAdoptionJournalPaths, WorkspaceLegacyAdoptionJournalStore } from '../workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { recoverWorkspaceLegacyAdoption } from '../workspaces/adoption/workspaceLegacyAdoptionRecovery.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from '../workspaces/adoption/workspaceLegacyAdoptionRootStore.js';
import { deriveWorkspaceLegacyAdoptionPaths } from '../workspaces/adoption/workspaceLegacyAdoptionPaths.js';
import { readColdWorkspaceRecoveryAdmissionFromRoot } from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import { captureWorkspaceRemnantBinding } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../workspaces/deletion/workspaceRemnantBindingPaths.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService } from '../workspaces/management/workspaceManagementService.js';
import { createWorkspaceManagementComposition } from '../workspaces/management/workspaceManagementComposition.js';
import * as candidateRuntimePaths from '../workspaces/runtime/workspaceCandidateRuntimePaths.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import { prepareWorkspaceDeletion } from '../workspaces/management/workspaceDeletionPreparation.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';

vi.mock('electron', () => ({
  BrowserWindow: class {}, MessageChannelMain: class {}, dialog: {}, ipcMain: {},
  net: {}, safeStorage: {}, session: {}, shell: {}, utilityProcess: {},
}));

const time = '2026-11-06T00:00:00.000Z';
const foreignWorkspaceIds = [
  validateWorkspaceId('00000000-0000-4000-8000-000000000099'),
  validateWorkspaceId('00000000-0000-4000-8000-000000000098'),
] as const;
const otherWorkspaceId = foreignWorkspaceIds[0];
const blockedKinds = ['creation', 'switch', 'migration', 'deletion', 'legacyRestore', 'foreignRestore', 'unprovedTargetRestore'] as const;
const metadata = { formatVersion: 1, acceptedAt: time, appVersion: '0.2.81',
  buildRevision: 'a'.repeat(40), releaseChannel: 'pilot' } as const;
const buildInfo = { schemaVersion: 1, appVersion: metadata.appVersion,
  buildRevision: metadata.buildRevision, buildCreatedAt: time, buildDirty: false } as const;
const releaseInfo = { schemaVersion: 1, appIdentity: 'Eky', appVersion: metadata.appVersion,
  msiProductVersion: metadata.appVersion, buildRevision: metadata.buildRevision,
  platform: 'win32', architecture: 'x64', releaseChannel: 'pilot',
  upgradeCode: '11111111-1111-4111-8111-111111111111' } as const;

// Test-only composition: real main/IPC reservation and readers, no startup, backend or deletion command.
async function fixture(context: Pick<TestContext, 'signal' | 'onTestFinished'>,
  localRestorePhase?: ProfileRestoreActivationPhase) {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-observation-'));
  let owner: Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>> | undefined;
  let transfer: ReturnType<NonNullable<typeof owner>['bind']> | undefined;
  let active = true;
  let installationAlive = true;
  let setup: Promise<unknown> | undefined;
  const cleanupSignal = new AbortController().signal;
  const jobs: Promise<unknown>[] = [];
  const revocations: (() => void)[] = [];
  const releases: (() => void)[] = [];
  const assertOpen = () => {
    context.signal.throwIfAborted();
    if (!active) throw new Error('SYNTHETIC_OBSERVATION_CLOSED');
  };
  const track = <T>(work: Promise<T>) => {
    const guarded = work.then(value => { assertOpen(); return value; });
    jobs.push(guarded); return guarded;
  };
  context.onTestFinished(async ({ task }) => {
    active = false;
    for (const release of releases) release();
    await Promise.allSettled([setup]);
    await Promise.allSettled(jobs);
    for (const revoke of revocations) revoke();
    await transfer?.reclaimAfterExit(cleanupSignal);
    await owner?.close();
    if (owner !== undefined) {
      const reacquired = await acquireWorkspaceProcessReservation({ userDataRoot: root, signal: cleanupSignal });
      await reacquired.release();
    }
    installationAlive = false;
    vi.restoreAllMocks();
    if (task.result?.state === 'pass' && !context.signal.aborted) await rm(root, { recursive: true });
  });
  const check = () => {
    assertOpen();
    if (owner === undefined) throw new Error('SYNTHETIC_OBSERVATION_CLOSED');
    owner.assertMainCurrent();
  };
  const owned = async () => { check(); await owner!.assertMainOwned(); check(); };
  const prepare = async () => {
    owner = await acquireDesktopWorkspaceReservation({ userDataRoot: root, signal: context.signal,
      assertSingleInstanceOwnership() { if (!installationAlive) throw new Error('SYNTHETIC_INSTALLATION_CLOSED'); } });
    check();
    const binding = remnantTestBinding('workspaceImport');
    const entry = { workspaceId: binding.workspaceId, workspaceLabel: 'Synthetic recovery observation',
      layoutVersion: 1, lineageIdentity: binding.lineageIdentity, createdAt: time, lifecycleState: 'ready' } as const;
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    await track(registry.write({ formatVersion: 2, activeWorkspaceId: binding.workspaceId,
      workspaces: [entry, ...foreignWorkspaceIds.map((workspaceId, index) => ({
        ...entry, workspaceId, workspaceLabel: `Synthetic other workspace ${index + 1}`,
        lineageIdentity: { formatVersion: 1 as const, profileId: (index === 0 ? 'b' : 'c').repeat(64) },
      }))] }));
    const initial = await track(registry.inspectSlots(check));
    const paths = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: join(root, 'runtime') });
    await track(mkdir(dirname(paths.acceptedBuildMetadataPath), { recursive: true, mode: 0o700 }));
    await track(writeFile(paths.acceptedBuildMetadataPath, JSON.stringify(metadata) + '\n', { flag: 'wx' }));
    const journalPath = join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
    if (localRestorePhase === undefined) {
      await track(new WorkspaceRemnantBindingStore(root, workspaceRemnantBindingKey(binding)).publish(binding,
        { assertAuthority: check, assertExternalSelection: owned }));
      const imported = new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: journalPath });
      for (const state of WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES) {
        await track(imported.write({ formatVersion: 2, operationId: binding.operationId, workspaceId: binding.workspaceId,
          workspaceLabel: entry.workspaceLabel, createdAt: time, previousActiveWorkspaceId: null, state,
          lineageIdentity: getWorkspaceBackupImportStateIndex(state) >= getWorkspaceBackupImportStateIndex('candidateValidated')
            ? binding.lineageIdentity : null }));
      }
    }
    const target = captureDeletionInventoryHeader({ formatVersion: deletionInventoryFormatVersion,
      operationId: randomUUID(), workspaceId: binding.workspaceId, lineageIdentity: binding.lineageIdentity,
      registryEntrySha256: workspaceRegistryEntrySha256(entry) });
    const profileRestore = (workspaceId: typeof binding.workspaceId) => createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(
      createDesktopProfilePaths(deriveWorkspaceRoot(root, workspaceId, 1).workspaceRoot).runtimeRoot,
    ).restoreActivationJournalPath);
    const blockedJournals = {
      creation: createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)),
      switch: createWorkspaceSwitchJournalPaths(root), migration: createWorkspaceFirstStartMigrationJournalPaths(root),
      deletion: createWorkspaceDeletionJournalPaths(root),
      legacyRestore: createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(createDesktopProfilePaths(root).runtimeRoot).restoreActivationJournalPath),
      foreignRestore: profileRestore(otherWorkspaceId),
      // No target-local restore exception until its own payload/ownership proof is composed.
      unprovedTargetRestore: profileRestore(binding.workspaceId),
    };
    const workspacePaths = deriveWorkspaceRoot(root, binding.workspaceId, 1);
    const registryEntries = initial.current?.value.workspaces;
    if (registryEntries === undefined) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
    const foreignRestoreJournals = registryEntries.filter(value => value.workspaceId !== binding.workspaceId)
      .map(value => ({ workspaceId: value.workspaceId, paths: profileRestore(value.workspaceId) }));
    if (localRestorePhase !== undefined) {
      await track(mkdir(workspacePaths.workspacesRoot, { mode: 0o700 }));
      await track(mkdir(workspacePaths.workspaceRoot, { mode: 0o700 }));
      const path = blockedJournals.unprovedTargetRestore.currentPath;
      await track(mkdir(dirname(path), { recursive: true, mode: 0o700 }));
      await track(writeFile(path, JSON.stringify(captureProfileRestoreActivationJournal({
        formatVersion: 1, operationId: randomUUID(), phase: localRestorePhase,
        revision: profileRestoreActivationPhases.indexOf(localRestorePhase),
        hadActiveDatabase: true, hadActiveDocuments: true,
      })) + '\n', { flag: 'wx' }));
    }
    const assertConflictsAbsent = async (observingLocalRestore = false) => {
      await owned();
      for (const kind of blockedKinds) {
        if (kind === 'foreignRestore' || (observingLocalRestore && kind === 'unprovedTargetRestore')) continue;
        check();
        const present = await hasAnyJournalSlot(blockedJournals[kind]);
        check();
        if (present) throw new Error('SYNTHETIC_RECOVERY_CONFLICT');
      }
      for (const foreign of foreignRestoreJournals) {
        check();
        const present = await hasAnyJournalSlot(foreign.paths);
        check();
        if (present) throw new Error('SYNTHETIC_RECOVERY_CONFLICT');
      }
      await owned();
    };
    const assertRegistry = async () => {
      await owned();
      const fresh = await registry.inspectSlots(check);
      if (initial.current?.identity === undefined || fresh.current?.identity === undefined || fresh.next !== undefined || fresh.backup !== undefined ||
          !sameCrashSafeFileSlotIdentity(initial.current.identity, fresh.current.identity) ||
          !Buffer.from(initial.current.bytes).equals(fresh.current.bytes)) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_CHANGED');
      await owned();
    };
    const capture = () => { check(); return track((async () => {
      const build = await captureWorkspaceDeletionLocalUpdateSelection({
        readers: createWorkspaceDeletionLocalUpdateReaders(paths), buildInfo, releaseInfo,
        assertCurrent: check, assertOwned: owned,
      });
      revocations.push(build.revoke);
      const selection = await captureWorkspaceDeletionOriginalJournals(root, target, {
        assertAuthority: check, assertWritersAbsent: owned,
        async assertExternalSelection() {
          await assertRegistry(); await build.assertSelected(); await assertConflictsAbsent();
          await build.assertSelected(); await assertRegistry();
        },
      });
      revocations.push(selection.revoke);
      return selection;
    })()); };
    // Only an experiment: positive local metadata evidence, never startup or deletion authority.
    const captureLocalRestore = () => track((async () => {
      let live = true, firstFailure: { cause: unknown } | undefined;
      function fail(): never { throw new Error('SYNTHETIC_LOCAL_RESTORE_CHANGED'); }
      const assertCurrent = () => {
        if (firstFailure !== undefined) throw firstFailure.cause;
        check();
        if (!live) fail();
      };
      const checked = async <T>(work: () => Promise<T>) => {
        try { assertCurrent(); const value = await work(); assertCurrent(); return value; }
        catch (cause) { firstFailure ??= { cause }; live = false; throw firstFailure.cause; }
      };
      const revoke = () => { live = false; };
      revocations.push(revoke);
      return checked(async () => {
        const build = await checked(() => captureWorkspaceDeletionLocalUpdateSelection({
          readers: createWorkspaceDeletionLocalUpdateReaders(paths), buildInfo, releaseInfo,
          assertCurrent, assertOwned: owned,
        }));
        revocations.push(build.revoke);
        await checked(() => inspectWorkspaceRoot(workspacePaths));
        const rootIdentity = await checked(() => readWorkspaceProcessReservationIdentity(workspacePaths.workspaceRoot));
        const assertExternal = () => checked(async () => {
          await checked(assertRegistry); await checked(() => build.assertSelected());
          await checked(() => assertConflictsAbsent(true));
          await checked(() => inspectWorkspaceRoot(workspacePaths));
          if (await checked(() => readWorkspaceProcessReservationIdentity(workspacePaths.workspaceRoot)) !== rootIdentity) fail();
          await checked(assertRegistry);
        });
        const original = await checked(() => captureWorkspaceDeletionOriginalJournals(root, target, {
          assertAuthority: assertCurrent, assertWritersAbsent: owned, assertExternalSelection: assertExternal,
        }));
        revocations.push(original.revoke);
        // This local-only experiment does not decide how multiple recovery owners may coexist.
        if (original.proofs.length !== 0) fail();
        const local = new ProfileRestoreActivationJournalStore(blockedJournals.unprovedTargetRestore.currentPath);
        const read = () => checked(() => local.inspectDeletionSlots(assertCurrent));
        await assertExternal();
        const selected = await read();
        const slotOrder = ['backup', 'current', 'next'] as const;
        const present = slotOrder.flatMap(slot => selected[slot] === undefined ? [] : [selected[slot]]);
        const [first, second, ...extra] = present;
        if (first === undefined || extra.length !== 0 || present.some(slot => slot.identity === undefined)) fail();
        if (second !== undefined) assertProfileRestoreActivationJournalStep(first.value, second.value);
        const journal = captureProfileRestoreActivationJournal((second ?? first).value);
        const assertSelected = () => track(checked(async () => {
          await assertExternal(); await checked(() => original.assertSelected());
          const fresh = await read();
          for (const name of slotOrder) {
            const before = selected[name], after = fresh[name];
            if (before === undefined) { if (after !== undefined) fail(); continue; }
            if (before.identity === undefined || after?.identity === undefined ||
                !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(after.bytes)) fail();
          }
          await checked(() => original.assertSelected()); await assertExternal();
        }));
        await assertSelected();
        return Object.freeze({ journal, assertSelected, revoke });
      });
    })());
    const run = <T>(work: () => Promise<T>) => { check(); return track(work()); };
    return { root, paths, registry, binding, journalPath, workspacePaths, blockedJournals, foreignRestoreJournals, capture, captureLocalRestore, run,
      bind() { transfer = owner!.bind(randomUUID(), check); },
      reclaim() {
        const work = (async () => { await transfer!.reclaimAfterExit(cleanupSignal); transfer = undefined; })();
        jobs.push(work); return work;
      },
      releaseOnClose(release: () => void) { releases.push(release); },
      closeMainReservation: () => owner!.close(),
      invalidateMainReservation: () => owner!.invalidate(),
      assertCurrent: check,
      assertOwned: owned,
    };
  };
  const preparing = prepare();
  setup = preparing;
  return preparing;
}

it('requires the current guarded import admission for the same observed bound journal', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const admission = vi.spyOn(importBindingAdmission, 'inspectWorkspaceBackupImportBindingAdmission');
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
    const value = await readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent: f.assertCurrent, assertOwned: f.assertOwned } });
    expect(value.mode).toBe('candidate');
    expect(admission).toHaveBeenCalledExactlyOnceWith(f.root, expect.objectContaining({ formatVersion: 2,
      operationId: f.binding.operationId, workspaceId: f.binding.workspaceId }));
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
    expect(await readFile(f.journalPath)).toEqual(journal);
  });
});

it('does not turn a bound import losing its guarded admission into ordinary recovery fallback', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
    vi.spyOn(importBindingAdmission, 'inspectWorkspaceBackupImportBindingAdmission').mockResolvedValueOnce('unbound');
    await expect(readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent: f.assertCurrent, assertOwned: f.assertOwned } }))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
    expect(await readFile(f.journalPath)).toEqual(journal);
  });
});

it('joins real main ownership, accepted build and original journal reads without changing registry selection', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const journalBytes = await readFile(f.journalPath);
    const selected = await f.capture();
    expect(selected.proofs.map(proof => proof.owner)).toEqual(['workspaceImport']);
    await selected.assertSelected();
    const competing = await acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: context.signal })
      .then(async handle => { await handle.release(); return undefined; }, cause => cause as unknown);
    expect(competing).toMatchObject({ reason: 'busy' });
    expect((await f.registry.inspect())?.activeWorkspaceId).toBe(f.binding.workspaceId);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBytes);
    expect(await readFile(f.journalPath)).toEqual(journalBytes);
    selected.revoke();
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  });
});

it.for(['bytes', 'identity', 'next'] as const)('expires the joined observation after accepted-build %s changes', async (change, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await f.capture(), path = f.paths.acceptedBuildMetadataPath, before = await readFile(path);
    if (change === 'identity') { await rename(path, path + '.retained'); await writeFile(path, before, { flag: 'wx' }); }
    else if (change === 'next') await writeFile(path + '.next', before, { flag: 'wx' });
    else await writeFile(path, JSON.stringify({ ...metadata, acceptedAt: '2026-11-06T00:00:01.000Z' }) + '\n');
    const changed = await readFile(path);
    const error = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
    expect(error).toBeInstanceOf(Error);
    await expect(selected.assertSelected()).rejects.toBe(error);
    expect(await readFile(path)).toEqual(changed);
    if (change === 'identity') expect(await readFile(path + '.retained')).toEqual(before);
    if (change === 'next') expect(await readFile(path + '.next')).toEqual(before);
  });
});

it('does not revive the old observation after a main reservation binding is reclaimed', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await f.capture();
    f.bind();
    const error = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
    expect(error).toBeInstanceOf(Error);
    await f.reclaim();
    await f.assertOwned();
    await expect(selected.assertSelected()).rejects.toBe(error);
  });
});

it.for(blockedKinds.flatMap(kind => (['currentPath', 'nextPath', 'backupPath'] as const).map(slot => ({ kind, slot }))))(
  'retains $kind $slot and refuses the joined recovery observation', async ({ kind, slot }, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const path = f.blockedJournals[kind][slot], bytes = Buffer.from('SYNTHETIC_RECOVERY_CONFLICT_BYTES');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: 'wx' });
      const registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const originalBytes = await readFile(f.journalPath);
      await expect(f.capture()).rejects.toThrow('SYNTHETIC_RECOVERY_CONFLICT');
      expect(await readFile(path)).toEqual(bytes);
      expect(await readFile(f.journalPath)).toEqual(originalBytes);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBytes);
    });
  },
);

it('rejects a foreign restore introduced during the first original-journal capture', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const path = f.blockedJournals.foreignRestore.currentPath;
    const bytes = Buffer.from('SYNTHETIC_LATE_FOREIGN_RESTORE');
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
      const selected = await inspect.apply(this, args);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: 'wx' });
      return selected;
    });
    await expect(f.capture()).rejects.toThrow('SYNTHETIC_RECOVERY_CONFLICT');
    expect(await readFile(path)).toEqual(bytes);
  });
});

it('keeps a late global conflict terminal for the old observation after the file is removed', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await f.capture(), path = f.blockedJournals.switch.nextPath;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, 'SYNTHETIC_LATE_SWITCH', { flag: 'wx' });
    const error = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('SYNTHETIC_RECOVERY_CONFLICT');
    await rm(path);
    await expect(selected.assertSelected()).rejects.toBe(error);
  });
});

it('finishes real reservation reclaim when observation cancellation arrives during the owned read', async context => {
  const cancelled = new AbortController();
  let hold = false, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const actualAcquire = processReservation.acquireWorkspaceProcessReservation;
  vi.spyOn(processReservation, 'acquireWorkspaceProcessReservation').mockImplementationOnce(async options => {
    const actual = await actualAcquire(options);
    return { ...actual, async assertOwned() {
      await actual.assertOwned();
      if (hold) { entered(); await held; }
    } };
  });
  const f = await fixture({ signal: cancelled.signal, onTestFinished: context.onTestFinished.bind(context) });
  f.releaseOnClose(release);
  const selected = await f.capture();
  f.bind(); hold = true;
  const reclaim = f.reclaim();
  try {
    await Promise.race([started, reclaim.then(() => { throw new Error('RECLAIM_NOT_HELD'); })]);
    cancelled.abort(new Error('SYNTHETIC_OBSERVATION_CANCELLED'));
  } finally { release(); }
  await reclaim;
  await expect(selected.assertSelected()).rejects.toThrow('SYNTHETIC_OBSERVATION_CANCELLED');
  const competing = await acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: context.signal })
    .then(async handle => { await handle.release(); return undefined; }, cause => cause as unknown);
  expect(competing).toMatchObject({ reason: 'busy' });
});

it.for(profileRestoreActivationPhases)('observes target-local restore %s without an import or deletion journal', async (phase, context) => {
  const f = await fixture(context, phase);
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath;
    const before = await readFile(path), registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const sentinel = join(f.workspacePaths.workspaceRoot, 'preserved-payload.bin');
    const payload = Buffer.from('SYNTHETIC_UNOPENED_PAYLOAD');
    await writeFile(sentinel, payload, { flag: 'wx' });
    const selected = await f.captureLocalRestore();
    expect(selected.journal.phase).toBe(phase);
    await selected.assertSelected();
    expect((await f.registry.inspect())?.activeWorkspaceId).toBe(f.binding.workspaceId);
    expect((await readFile(path)).equals(before)).toBe(true);
    expect((await readFile(sentinel)).equals(payload)).toBe(true);
    expect((await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(registryBytes)).toBe(true);
    await expect(readFile(f.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hasAnyJournalSlot(f.blockedJournals.deletion)).toBe(false);
    selected.revoke();
    await expect(selected.assertSelected()).rejects.toThrow('SYNTHETIC_LOCAL_RESTORE_CHANGED');
  });
});

it.for(['missing', 'malformed', 'invalidPair'] as const)('does not turn %s local restore metadata into a positive observation', async (change, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath, bytes = await readFile(path);
    const registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    if (change === 'missing') await rename(path, path + '.retained');
    else if (change === 'malformed') await writeFile(path, '{}\n');
    else await writeFile(path + '.next', JSON.stringify({ ...JSON.parse(bytes.toString()), revision: 5 }) + '\n', { flag: 'wx' });
    const changed = change === 'missing' ? undefined : await readFile(change === 'invalidPair' ? path + '.next' : path);
    await expect(f.captureLocalRestore()).rejects.toThrow(change === 'missing'
      ? 'SYNTHETIC_LOCAL_RESTORE_CHANGED' : 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect((await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(registryBytes)).toBe(true);
    if (change === 'missing') expect((await readFile(path + '.retained')).equals(bytes)).toBe(true);
    else if (change === 'malformed') expect(await readFile(path, 'utf8')).toBe('{}\n');
    else {
      if (changed === undefined) throw new Error('SYNTHETIC_LOCAL_JOURNAL_BYTES_MISSING');
      expect((await readFile(path + '.next')).equals(changed)).toBe(true);
    }
  });
});

it.for(['bytes', 'identity', 'rootIdentity', 'sideSlot'] as const)('expires a local restore observation after %s changes and retains both versions', async (change, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const selected = await f.captureLocalRestore(), path = f.blockedJournals.unprovedTargetRestore.currentPath;
    const bytes = await readFile(path);
    const local = new ProfileRestoreActivationJournalStore(path);
    const beforeSlots = await local.inspectDeletionSlots(() => context.signal.throwIfAborted());
    if (change === 'bytes') await writeFile(path, '{}\n');
    else if (change === 'identity') {
      await rename(path, path + '.retained'); await writeFile(path, bytes, { flag: 'wx' });
    } else if (change === 'rootIdentity') {
      const beforeRoot = await readWorkspaceProcessReservationIdentity(f.workspacePaths.workspaceRoot);
      await rename(f.workspacePaths.workspaceRoot, f.workspacePaths.workspaceRoot + '.retained');
      await mkdir(f.workspacePaths.workspaceRoot, { mode: 0o700 });
      await rename(createDesktopProfilePaths(f.workspacePaths.workspaceRoot + '.retained').runtimeRoot,
        createDesktopProfilePaths(f.workspacePaths.workspaceRoot).runtimeRoot);
      expect(await readWorkspaceProcessReservationIdentity(f.workspacePaths.workspaceRoot)).not.toBe(beforeRoot);
      const afterSlots = await local.inspectDeletionSlots(() => context.signal.throwIfAborted());
      if (beforeSlots.current?.identity === undefined || afterSlots.current?.identity === undefined) {
        throw new Error('SYNTHETIC_LOCAL_JOURNAL_IDENTITY_MISSING');
      }
      expect(sameCrashSafeFileSlotIdentity(beforeSlots.current.identity, afterSlots.current.identity)).toBe(true);
      expect(Buffer.from(afterSlots.current.bytes).equals(beforeSlots.current.bytes)).toBe(true);
    } else await writeFile(path + '.backup', bytes, { flag: 'wx' });
    const changed = await readFile(path);
    const failure = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
    expect(failure).toBeInstanceOf(Error);
    // Restoring the apparent content must not revive an observation that already failed.
    if (change === 'bytes') await writeFile(path, bytes);
    await expect(selected.assertSelected()).rejects.toBe(failure);
    if (change === 'bytes') expect(changed.toString()).toBe('{}\n');
    expect((await readFile(path)).equals(bytes)).toBe(true);
    if (change === 'identity') expect((await readFile(path + '.retained')).equals(bytes)).toBe(true);
    if (change === 'rootIdentity') {
      expect(await readdir(f.workspacePaths.workspaceRoot + '.retained')).toEqual([]);
    }
    if (change === 'sideSlot') expect((await readFile(path + '.backup')).equals(bytes)).toBe(true);
  });
});

it('keeps target-local restore observation closed after real main ownership is transferred and reclaimed', async context => {
  const f = await fixture(context, 'failedSafe');
  await f.run(async () => {
    const selected = await f.captureLocalRestore(), path = f.blockedJournals.unprovedTargetRestore.currentPath;
    const before = await readFile(path);
    f.bind();
    const failure = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
    expect(failure).toBeInstanceOf(Error);
    await f.reclaim(); await f.assertOwned();
    await expect(selected.assertSelected()).rejects.toBe(failure);
    expect((await readFile(path)).equals(before)).toBe(true);
  });
});

it('joins a delayed local restore read before returning its original cancellation', async context => {
  const cancellation = new AbortController();
  const f = await fixture({ signal: cancellation.signal, onTestFinished: context.onTestFinished.bind(context) }, 'prepared');
  const selected = await f.captureLocalRestore(), path = f.blockedJournals.unprovedTargetRestore.currentPath;
  const before = await readFile(path);
  let release!: () => void, entered!: () => void, returned = false, reachedTarget = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.releaseOnClose(release);
  const inspect = ProfileRestoreActivationJournalStore.prototype.inspectDeletionSlots;
  vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectDeletionSlots').mockImplementation(async function(this: ProfileRestoreActivationJournalStore, ...args) {
    const slots = await inspect.apply(this, args);
    if (!reachedTarget && slots.current?.value.operationId === selected.journal.operationId) {
      reachedTarget = true;
      entered(); await held; returned = true;
    }
    return slots;
  });
  let settled = false;
  const reading = selected.assertSelected().then(
    () => { settled = true; return undefined; },
    cause => { settled = true; return cause as unknown; },
  );
  const reason = new Error('SYNTHETIC_LOCAL_RESTORE_CANCELLED');
  try {
    await Promise.race([started, reading.then(() => { throw new Error('LOCAL_RESTORE_READ_NOT_HELD'); })]);
    expect(reachedTarget).toBe(true);
    cancellation.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(returned).toBe(false);
  } finally { release(); }
  expect(await reading).toBe(reason);
  expect(returned).toBe(true);
  await expect(selected.assertSelected()).rejects.toBe(reason);
  expect((await readFile(path)).equals(before)).toBe(true);
});

it('keeps the real reservation until a quit-requested local journal read has joined', async context => {
  const f = await fixture(context, 'prepared');
  const selected = await f.captureLocalRestore();
  const path = f.blockedJournals.unprovedTargetRestore.currentPath;
  const before = await readFile(path), registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
  const startup = createRecoveryStartupExperiment(), observation = createRecoveryObservationExperiment();
  let release!: () => void, entered!: () => void, targetHeld = false, readReturned = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.releaseOnClose(release);
  const inspect = ProfileRestoreActivationJournalStore.prototype.inspectDeletionSlots;
  vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectDeletionSlots').mockImplementation(async function(this: ProfileRestoreActivationJournalStore, ...args) {
    const slots = await inspect.apply(this, args);
    if (!targetHeld && slots.current?.value.operationId === selected.journal.operationId) {
      targetHeld = true; entered(); await held; readReturned = true;
    }
    return slots;
  });
  const released = vi.fn(f.closeMainReservation), quit = vi.fn();
  const handle = createDesktopBeforeQuitHandler({
    invalidateStartupReporting: startup.beforeQuit, readLifecycle: startup.readLifecycle, quitApplication: quit,
  });
  const finished = startup.start(async port => {
    port.registerObservation(observation);
    try { await observation.run(() => selected.assertSelected()); }
    catch (error) {
      if (error !== observation.signal.reason) throw error;
    } finally {
      observation.closeAdmission(); await observation.waitForSettlement(); selected.revoke();
      await f.assertOwned(); await released();
    }
    return undefined;
  });
  try {
    await Promise.race([started, finished.then(() => { throw new Error('LOCAL_STARTUP_READ_NOT_HELD'); })]);
    const event = { preventDefault: vi.fn() }, pending = handle(event);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(readReturned).toBe(false); expect(released).not.toHaveBeenCalled(); expect(quit).not.toHaveBeenCalled();
    await f.assertOwned();
    const competing = await acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: context.signal })
      .then(async reservation => { await reservation.release(); return undefined; }, cause => cause as unknown);
    expect(competing).toMatchObject({ reason: 'busy' });
    release(); await finished; await pending;
    expect(readReturned).toBe(true); expect(released).toHaveBeenCalledOnce(); expect(quit).toHaveBeenCalledOnce();
    const reacquired = await acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: context.signal });
    await reacquired.release();
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
    await expect(selected.assertSelected()).rejects.toMatchObject({ reason: 'lost' });
  } finally { release(); await finished; }
});

it.for(foreignWorkspaceIds.flatMap(workspaceId => (['currentPath', 'nextPath', 'backupPath'] as const).map(slot => ({ workspaceId, slot }))))(
  'rejects local observation for registered foreign $workspaceId $slot and preserves every company', async ({ workspaceId, slot }, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const foreign = f.foreignRestoreJournals.find(value => value.workspaceId === workspaceId);
      expect(f.foreignRestoreJournals.map(value => value.workspaceId)).toEqual([...foreignWorkspaceIds]);
      if (foreign === undefined) throw new Error('SYNTHETIC_FOREIGN_WORKSPACE_MISSING');
      const preserved: { path: string; bytes: Buffer }[] = [];
      for (const id of [f.binding.workspaceId, ...foreignWorkspaceIds]) {
        const path = join(deriveWorkspaceRoot(f.root, id, 1).workspaceRoot, 'preserved-payload.bin');
        const bytes = Buffer.from(`SYNTHETIC_UNOPENED_PAYLOAD_${id}`);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { flag: 'wx' });
        preserved.push({ path, bytes });
      }
      const path = foreign.paths[slot], bytes = Buffer.from('SYNTHETIC_OTHER_COMPANY_RESTORE');
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { flag: 'wx' });
      const targetBefore = await readFile(f.blockedJournals.unprovedTargetRestore.currentPath);
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      await expect(f.captureLocalRestore()).rejects.toThrow('SYNTHETIC_RECOVERY_CONFLICT');
      expect((await readFile(path)).equals(bytes)).toBe(true);
      expect((await readFile(f.blockedJournals.unprovedTargetRestore.currentPath)).equals(targetBefore)).toBe(true);
      expect((await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(registryBefore)).toBe(true);
      for (const item of preserved) expect((await readFile(item.path)).equals(item.bytes)).toBe(true);
    });
  },
);

const localRestoreSlotPairs = [
  { pair: 'backup/current', earlier: 'backupPath', later: 'currentPath' },
  { pair: 'current/next', earlier: 'currentPath', later: 'nextPath' },
  { pair: 'backup/next', earlier: 'backupPath', later: 'nextPath' },
] as const;

it.for(localRestoreSlotPairs.flatMap(pair => (['same', 'forward', 'rollback'] as const).map(transition => ({ ...pair, transition }))))(
  'observes local $pair $transition without promoting or clearing slots', async ({ earlier, later, transition }, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const paths = f.blockedJournals.unprovedTargetRestore;
      const base = captureProfileRestoreActivationJournal(JSON.parse(await readFile(paths.currentPath, 'utf8')));
      const previous = captureProfileRestoreActivationJournal({ ...base,
        ...(transition === 'rollback' ? { phase: 'rollbackStarting', revision: 11 } : {}) });
      const next = captureProfileRestoreActivationJournal({ ...previous,
        ...(transition === 'forward' ? { phase: 'movingCurrentDatabase', revision: 1 } :
          transition === 'rollback' ? { phase: 'failedSafe', revision: 12 } : {}) });
      await rm(paths.currentPath);
      await writeFile(paths[earlier], JSON.stringify(previous) + '\n', { flag: 'wx' });
      await writeFile(paths[later], JSON.stringify(next) + '\n', { flag: 'wx' });
      const store = new ProfileRestoreActivationJournalStore(paths.currentPath);
      const before = await store.inspectDeletionSlots(() => context.signal.throwIfAborted());
      const selected = await f.captureLocalRestore();
      expect(selected.journal).toEqual(next);
      await selected.assertSelected();
      const after = await store.inspectDeletionSlots(() => context.signal.throwIfAborted());
      for (const slot of ['current', 'next', 'backup'] as const) {
        const old = before[slot], current = after[slot];
        if (old === undefined) { expect(current).toBeUndefined(); continue; }
        if (old.identity === undefined || current?.identity === undefined) throw new Error('SYNTHETIC_LOCAL_JOURNAL_IDENTITY_MISSING');
        expect(Buffer.from(current.bytes).equals(old.bytes)).toBe(true);
        expect(sameCrashSafeFileSlotIdentity(old.identity, current.identity)).toBe(true);
      }
    });
  },
);

it.for(['backupPath', 'nextPath'] as const)('observes one local %s without publishing current', async (slot, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const paths = f.blockedJournals.unprovedTargetRestore, before = await readFile(paths.currentPath);
    await rename(paths.currentPath, paths[slot]);
    const selected = await f.captureLocalRestore();
    expect(selected.journal.phase).toBe('prepared');
    await selected.assertSelected();
    await expect(readFile(paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFile(paths[slot])).equals(before)).toBe(true);
  });
});

it.for(['operation', 'revision', 'phase', 'threeSlots'] as const)('retains conflicting local slots after %s', async (change, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const paths = f.blockedJournals.unprovedTargetRestore, current = await readFile(paths.currentPath);
    const base = captureProfileRestoreActivationJournal(JSON.parse(current.toString()));
    const next = captureProfileRestoreActivationJournal({ ...base,
      ...(change === 'operation' ? { operationId: randomUUID() } :
        change === 'revision' ? { revision: 3, phase: 'movingCurrentDatabase' } :
        change === 'phase' ? { revision: 1, phase: 'accepted' } : {}) });
    const nextBytes = Buffer.from(JSON.stringify(next) + '\n');
    await writeFile(paths.nextPath, nextBytes, { flag: 'wx' });
    if (change === 'threeSlots') await writeFile(paths.backupPath, current, { flag: 'wx' });
    await expect(f.captureLocalRestore()).rejects.toThrow(change === 'threeSlots'
      ? 'SYNTHETIC_LOCAL_RESTORE_CHANGED' : 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
    expect((await readFile(paths.currentPath)).equals(current)).toBe(true);
    expect((await readFile(paths.nextPath)).equals(nextBytes)).toBe(true);
    if (change === 'threeSlots') expect((await readFile(paths.backupPath)).equals(current)).toBe(true);
  });
});

it.for(['foreignRestore', 'registry', 'sharedImport'] as const)('rejects %s introduced during the target-local read and preserves its evidence', async (change, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath, before = await readFile(path);
    const journal = captureProfileRestoreActivationJournal(JSON.parse(before.toString()));
    const inspect = ProfileRestoreActivationJournalStore.prototype.inspectDeletionSlots;
    const foreign = f.foreignRestoreJournals.find(value => value.workspaceId === foreignWorkspaceIds[1]);
    if (foreign === undefined) throw new Error('SYNTHETIC_FOREIGN_WORKSPACE_MISSING');
    let inserted = false, changedPath = '', changedBytes = Buffer.alloc(0);
    vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectDeletionSlots').mockImplementation(async function(this: ProfileRestoreActivationJournalStore, ...args) {
      const selected = await inspect.apply(this, args);
      if (!inserted && selected.current?.value.operationId === journal.operationId) {
        inserted = true;
        if (change === 'foreignRestore') {
          changedPath = foreign.paths.nextPath;
          await mkdir(dirname(changedPath), { recursive: true, mode: 0o700 });
          await writeFile(changedPath, 'SYNTHETIC_LATE_FOREIGN_RESTORE', { flag: 'wx' });
        } else if (change === 'registry') {
          changedPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
          const current = await f.registry.inspect();
          if (current?.formatVersion !== 2) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
          await f.registry.write({ ...current, workspaces: current.workspaces.map(entry => entry.workspaceId === f.binding.workspaceId
            ? { ...entry, workspaceLabel: 'Synthetic changed selection' } : entry) });
        } else {
          changedPath = f.journalPath;
          await new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: changedPath }).write({
            formatVersion: 2, operationId: randomUUID(), workspaceId: f.binding.workspaceId,
            workspaceLabel: 'Synthetic competing import', createdAt: time, previousActiveWorkspaceId: null,
            state: 'prepared', lineageIdentity: null,
          });
        }
        changedBytes = await readFile(changedPath);
      }
      return selected;
    });
    await expect(f.captureLocalRestore()).rejects.toThrow(change === 'foreignRestore' ? 'SYNTHETIC_RECOVERY_CONFLICT'
      : change === 'registry' ? 'SYNTHETIC_OBSERVED_REGISTRY_CHANGED' : 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(inserted).toBe(true);
    expect((await readFile(changedPath)).equals(changedBytes)).toBe(true);
    expect((await readFile(path)).equals(before)).toBe(true);
    expect((await f.registry.inspect())?.activeWorkspaceId).toBe(f.binding.workspaceId);
  });
});

it('rejects a replaced predecessor slot even when the latest local version and all bytes are unchanged', async context => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const paths = f.blockedJournals.unprovedTargetRestore, original = await readFile(paths.currentPath);
    const journal = captureProfileRestoreActivationJournal(JSON.parse(original.toString()));
    await writeFile(paths.backupPath, original, { flag: 'wx' });
    const advanced = Buffer.from(JSON.stringify({ ...journal, phase: 'movingCurrentDatabase', revision: 1 }) + '\n');
    await writeFile(paths.currentPath, advanced);
    const selected = await f.captureLocalRestore();
    expect(selected.journal.phase).toBe('movingCurrentDatabase');
    const local = new ProfileRestoreActivationJournalStore(paths.currentPath);
    const beforeSlots = await local.inspectDeletionSlots(() => context.signal.throwIfAborted());
    await rename(paths.backupPath, paths.backupPath + '.retained');
    await writeFile(paths.backupPath, original, { flag: 'wx' });
    const afterSlots = await local.inspectDeletionSlots(() => context.signal.throwIfAborted());
    if (beforeSlots.backup?.identity === undefined || afterSlots.backup?.identity === undefined ||
        beforeSlots.current?.identity === undefined || afterSlots.current?.identity === undefined) {
      throw new Error('SYNTHETIC_LOCAL_JOURNAL_IDENTITY_MISSING');
    }
    expect(sameCrashSafeFileSlotIdentity(beforeSlots.current.identity, afterSlots.current.identity)).toBe(true);
    expect(sameCrashSafeFileSlotIdentity(beforeSlots.backup.identity, afterSlots.backup.identity)).toBe(false);
    await expect(selected.assertSelected()).rejects.toThrow('SYNTHETIC_LOCAL_RESTORE_CHANGED');
    expect((await readFile(paths.backupPath)).equals(original)).toBe(true);
    expect((await readFile(paths.backupPath + '.retained')).equals(original)).toBe(true);
    expect((await readFile(paths.currentPath)).equals(advanced)).toBe(true);
  });
});

type DiscoveryFixture = Awaited<ReturnType<typeof fixture>>;
type DiscoveryReceipt = Extract<Awaited<ReturnType<typeof discoverRecoveryTargetExperiment>>, { mode: 'offered' }>;
const discover = (f: DiscoveryFixture) => f.run(() => discoverRecoveryTargetExperiment({
  root: f.root, buildInfo, releaseInfo, authority: f,
}));
const discoverLocalSourceTrial = (f: DiscoveryFixture) => f.run(() => discoverRecoveryTargetExperiment({
  root: f.root, buildInfo, releaseInfo, authority: f, localRestoreSelection: 'normalSourceTrial',
}));

it('reads canonical recovery sources without returning a target or mutation authority', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const journal = await readFile(f.journalPath), registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const source = await readDesktopWorkspaceRecoverySources({ root: f.root, buildInfo, releaseInfo, authority: f });
    expect(source.mode).toBe('observed');
    expect(source.reason).toBeUndefined();
    expect(source.owners).toEqual(['workspaceImport']);
    expect(source.candidateEntries.map(entry => entry.workspaceId)).toEqual([f.binding.workspaceId]);
    expect(source.registry?.activeWorkspaceId).toBe(f.binding.workspaceId);
    expect(Object.keys(source).sort()).toEqual(['candidateEntries', 'evidence', 'mode', 'owners', 'reason', 'registry']);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.evidence)).toBe(true);
    expect(await readFile(f.journalPath)).toEqual(journal);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
  });
});

it('captures source root, build identity and authority callbacks before awaited journal reads', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const request = { root: f.root, buildInfo: { ...buildInfo }, releaseInfo: { ...releaseInfo },
      authority: { assertCurrent: f.assertCurrent, assertOwned: f.assertOwned } };
    const replaced = vi.fn((): never => { throw new Error('SYNTHETIC_REPLACED_SOURCE_CALLBACK'); });
    request.authority.assertOwned = async () => {
      request.root = join(f.root, 'unselected-root');
      request.buildInfo.buildRevision = 'f'.repeat(40);
      request.releaseInfo.buildRevision = 'e'.repeat(40);
      request.authority.assertCurrent = replaced;
      request.authority.assertOwned = async () => replaced();
      await f.assertOwned();
    };
    const source = await readDesktopWorkspaceRecoverySources(request);
    expect(source.mode).toBe('observed');
    expect(source.reason).toBeUndefined();
    expect(source.owners).toEqual(['workspaceImport']);
    expect(replaced).not.toHaveBeenCalled();
  });
});

it('censuses local restore-v1 as evidence without turning it into guarded-writer eligibility', async context => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath, bytes = await readFile(path);
    const source = await readDesktopWorkspaceRecoverySources({ root: f.root, buildInfo, releaseInfo, authority: f });
    expect(source.candidateEntries).toEqual([]);
    const registry = source.registry;
    if (registry === undefined) throw new Error('SYNTHETIC_SOURCE_REGISTRY_MISSING');
    const census = await readDesktopWorkspaceRecoveryCensus({ root: f.root, registry, authority: f });
    expect(census.localRestores.map(value => value.entry.workspaceId)).toEqual([f.binding.workspaceId]);
    expect(census.otherRecoveryPresent).toBe(false);
    expect(Object.keys(census).sort()).toEqual(['evidence', 'localRestores', 'otherRecoveryPresent']);
    expect(census.localRestores[0]?.observation.bytes).toEqual(Uint8Array.from(bytes));
    const selected = await readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo, authority: f });
    expect(selected).toMatchObject({ mode: 'notOffered', reason: 'noJournalTarget', target: undefined });
    expect(await readFile(path)).toEqual(bytes);
  });
});

it('preserves a main authority failure remapped inside the actual import journal reader', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    let active = true;
    const cause = new Error('SYNTHETIC_SOURCE_AUTHORITY_ORIGINAL');
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectRecoverySelection;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectRecoverySelection').mockImplementationOnce(function(this: WorkspaceBackupImportJournalStore, ...args) {
      active = false;
      return inspect.apply(this, args);
    });
    await expect(readDesktopWorkspaceRecoverySources({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent() { if (!active) throw cause; f.assertCurrent(); }, assertOwned: f.assertOwned },
    })).rejects.toBe(cause);
    expect(await readFile(f.journalPath)).toBeDefined();
  });
});

it('drains canonical source work through the production startup scope after cancellation', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const scope = createRecoveryObservationExperiment(), held = holdDiscoveryRead(f);
    const reading = scope.run(() => readDesktopWorkspaceRecoverySources({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent() { scope.assertCurrent(); f.assertCurrent(); }, assertOwned: f.assertOwned },
    }));
    void reading.catch(() => undefined);
    await held.entered;
    scope.closeAdmission();
    let settled = false;
    const closing = scope.waitForSettlement().then(() => { settled = true; });
    void closing.catch(() => undefined);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally { held.release(); }
    await expect(reading).rejects.toBe(scope.signal.reason);
    await closing;
    expect(held.events).toEqual(['readSettled']);
    expect(await readFile(f.journalPath)).toBeDefined();
  });
});

function holdDiscoveryRead(f: DiscoveryFixture, boundary: 'before' | 'after' = 'after') {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  f.releaseOnClose(() => { enter(); release(); });
  const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
  vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
    if (boundary === 'before') { enter(); await held; }
    try {
      const selected = await inspect.apply(this, args);
      if (boundary === 'after') { enter(); await held; }
      return selected;
    } finally { events.push('readSettled'); }
  });
  return { entered, release, events };
}

function productionSelection(f: DiscoveryFixture, authority = { assertCurrent: f.assertCurrent, assertOwned: f.assertOwned }) {
  const selection = createDesktopWorkspaceRecoverySelection({ root: f.root, buildInfo, releaseInfo, authority });
  f.releaseOnClose(selection.closeAdmission);
  return selection;
}

it('production selection captures inputs synchronously without starting any I/O', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const inspect = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectRecoverySelection');
    const input = { root: f.root, buildInfo: { ...buildInfo }, releaseInfo: { ...releaseInfo },
      authority: { assertCurrent: f.assertCurrent, assertOwned: f.assertOwned } };
    const selection = createDesktopWorkspaceRecoverySelection(input);
    f.releaseOnClose(selection.closeAdmission);
    expect(inspect).not.toHaveBeenCalled();
    input.root = join(f.root, 'unselected-root'); input.buildInfo.buildRevision = 'f'.repeat(40);
    input.releaseInfo.buildRevision = 'e'.repeat(40);
    input.authority.assertCurrent = () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
    input.authority.assertOwned = async () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
    try {
      expect((await selection.discover()).mode).toBe('offered');
      await expect(selection.discover()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    } finally { selection.closeAdmission(); await selection.waitForSettlement(); }
  });
});

it.for(['target', 'other', 'none'] as const)('production handoff preserves the %s pointer and survives startup close only in its new owner', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = (await f.registry.inspect())!;
    const pointer = active === 'target' ? f.binding.workspaceId : active === 'other' ? otherWorkspaceId : null;
    await f.registry.write({ ...registry, activeWorkspaceId: pointer });
    const beforeRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), beforeJournal = await readFile(f.journalPath);
    const wrapper = createRecoveryStartupExperiment(), selection = productionSelection(f);
    let transferred: Awaited<ReturnType<Extract<Awaited<ReturnType<typeof selection.discover>>, { mode: 'offered' }>['handoff']>> | undefined;
    const outcome = await wrapper.start(async port => {
      port.registerObservation(selection);
      const selected = await selection.discover();
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      expect(selected.persistedActiveWorkspaceId).toBe(pointer);
      transferred = await selected.handoff(f);
      expect(selected.assertCurrent).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await expect(selected.handoff(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      return { async shutdown() { transferred!.closeAdmission(); await transferred!.waitForSettlement(); } };
    });
    expect(outcome.status).toBe('fulfilled');
    expect(selection.signal.aborted).toBe(true);
    try {
      await transferred!.assertSelected(); await transferred!.readSelected(f);
      expect(transferred!.persistedActiveWorkspaceId).toBe(pointer);
      expect(Object.keys(transferred!).sort()).toEqual(['assertCurrent', 'assertSelected', 'closeAdmission',
        'owners', 'persistedActiveWorkspaceId', 'readSelected', 'readStatus', 'target', 'transferSourceSelection', 'waitForSettlement']);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(beforeRegistry);
      expect(await readFile(f.journalPath)).toEqual(beforeJournal);
    } finally { await wrapper.shutdown(); }
    expect(transferred!.assertCurrent).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  });
});

it.for(['selected', 'expired', 'idleStatus'] as const)(
  'original selection transfer drains %s without closing main-owned busy status', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selection = productionSelection(f), offered = await selection.discover();
      if (offered.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const main = await offered.handoff(f), maintenance = new InMemoryWorkspaceMaintenanceLease();
      const idleInput = { context: { operationState: 'idle' as const, assertCurrent: f.assertCurrent },
        maintenance, authority: f, runtimeAbsence: f };
      const idle = await main.readStatus(idleInput);
      const held = holdDiscoveryRead(f), expired = new Error('SYNTHETIC_ORIGINAL_REQUEST_EXPIRED');
      let current = true, settled = false;
      const authority = { assertCurrent() { f.assertCurrent(); if (!current) throw expired; }, assertOwned: f.assertOwned };
      const reading = kind === 'idleStatus' ? main.readStatus(idleInput) : main.readSelected(authority);
      void reading.catch(() => undefined);
      const replacement = { assertCurrent: f.assertCurrent, assertSelected: vi.fn(f.assertOwned) };
      const capture = vi.fn(async (owner: DesktopWorkspaceRecoveryReadAuthority) => {
        owner.assertCurrent(); await owner.assertOwned(); return replacement;
      });
      let transfer: ReturnType<typeof main.transferSourceSelection> | undefined;
      try {
        await held.entered; context.signal.throwIfAborted();
        if (kind === 'expired') current = false;
        transfer = main.transferSourceSelection(capture).finally(() => { settled = true; });
        void transfer.catch(() => undefined);
        await expect(main.readSelected(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(settled).toBe(false); expect(capture).not.toHaveBeenCalled();
        held.release();
        if (kind === 'expired') await expect(reading).rejects.toBe(expired); else await reading;
        await expect(transfer).resolves.toBe(replacement);
        expect(capture).toHaveBeenCalledOnce(); expect(replacement.assertSelected).toHaveBeenCalledOnce();
        expect(idle.assertCurrent).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await expect(main.assertSelected()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await expect(main.transferSourceSelection(capture)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        const before = await readFile(f.journalPath);
        await writeFile(f.journalPath, Buffer.concat([before, Buffer.from('\n')]));
        const reads = vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots).mock.calls.length;
        const busy = await main.readStatus({ ...idleInput, context: { operationState: 'busy', assertCurrent: f.assertCurrent } });
        busy.assertCurrent(); expect(busy.value).toMatchObject({ operationState: 'busy', runtimeState: 'absent' });
        expect(busy.value).not.toHaveProperty('target');
        expect(vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots)).toHaveBeenCalledTimes(reads);
        main.assertCurrent(); await f.assertOwned();
      } finally {
        held.release(); await Promise.allSettled([reading, transfer]);
        main.closeAdmission(); selection.closeAdmission();
        await Promise.all([main.waitForSettlement(), selection.waitForSettlement()]);
      }
    });
  },
);

it.for(['beforeTransfer', 'duringTransfer'] as const)(
  'original selection transfer joins a held read after main closes %s', async (when, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selection = productionSelection(f), offered = await selection.discover();
      if (offered.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const main = await offered.handoff(f), held = holdDiscoveryRead(f);
      const reading = main.readSelected(f); void reading.catch(() => undefined);
      let transfer: ReturnType<typeof main.transferSourceSelection> | undefined, closing: Promise<void> | undefined, settled = false;
      const capture = vi.fn(async () => ({ assertCurrent: f.assertCurrent, assertSelected: f.assertOwned }));
      try {
        await held.entered; context.signal.throwIfAborted();
        if (when === 'beforeTransfer') main.closeAdmission();
        transfer = main.transferSourceSelection(capture); void transfer.catch(() => undefined);
        if (when === 'duringTransfer') main.closeAdmission();
        closing = main.waitForSettlement().then(() => { settled = true; });
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(settled).toBe(false); expect(capture).not.toHaveBeenCalled();
        held.release();
        await expect(reading).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await expect(transfer).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await closing; expect(settled).toBe(true); expect(capture).not.toHaveBeenCalled();
        await f.assertOwned();
      } finally {
        held.release(); await Promise.allSettled([reading, transfer, closing]);
        main.closeAdmission(); selection.closeAdmission();
        await Promise.all([main.waitForSettlement(), selection.waitForSettlement()]);
      }
    });
  },
);

it.for(['source', 'replacement'] as const)(
  'original selection transfer retains its first %s failure without adopting a new baseline', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selection = productionSelection(f), offered = await selection.discover();
      if (offered.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const main = await offered.handoff(f), failure = new Error('SYNTHETIC_REPLACEMENT_SELECTION_FAILED');
      const before = await readFile(f.journalPath);
      try {
        const outcome = await main.transferSourceSelection(async () => {
          if (kind === 'source') await writeFile(f.journalPath, Buffer.concat([before, Buffer.from('\n')]));
          return { assertCurrent: f.assertCurrent, async assertSelected() { throw failure; } };
        }).catch((cause: unknown) => cause);
        expect(outcome).toBeInstanceOf(Error);
        if (kind === 'replacement') expect(outcome).toBe(failure);
        await writeFile(f.journalPath, before);
        expect(main.assertCurrent).toThrow(outcome as Error);
        await expect(main.assertSelected()).rejects.toBe(outcome);
        expect(await readFile(f.journalPath)).toEqual(before);
        await f.assertOwned();
      } finally {
        main.closeAdmission(); selection.closeAdmission();
        await Promise.all([main.waitForSettlement(), selection.waitForSettlement()]);
      }
    });
  },
);

it('production selection does not promote local restore-v1 into protected-writer evidence', async context => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const before = await readFile(f.blockedJournals.unprovedTargetRestore.currentPath);
    const selection = productionSelection(f);
    try { expect(await selection.discover()).toMatchObject({ mode: 'notOffered' }); }
    finally { selection.closeAdmission(); await selection.waitForSettlement(); }
    expect(await readFile(f.blockedJournals.unprovedTargetRestore.currentPath)).toEqual(before);
  });
});

it.for(['current', 'expired'] as const)('production handoff drains a %s old read and rejects concurrent or late work', async (state, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const held = holdDiscoveryRead(f), expired = new Error('SYNTHETIC_REQUEST_EXPIRED');
    let current = true, completed = false;
    const reading = selected.readSelected({ assertCurrent() { if (!current) throw expired; }, assertOwned: f.assertOwned });
    void reading.catch(() => undefined);
    let handoff: ReturnType<typeof selected.handoff> | undefined;
    let main: Awaited<ReturnType<typeof selected.handoff>> | undefined;
    try {
      await held.entered;
      if (state === 'expired') current = false;
      handoff = selected.handoff(f).then(value => { completed = true; main = value; return value; });
      void handoff.catch(() => undefined);
      await expect(selected.handoff(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      const reads = vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots).mock.calls.length;
      await expect(selected.readSelected(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots)).toHaveBeenCalledTimes(reads);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(completed).toBe(false); expect(held.events).toEqual([]);
      held.release();
      if (state === 'expired') await expect(reading).rejects.toBe(expired);
      else await expect(reading).resolves.toBeUndefined();
      await handoff; expect(held.events).toEqual(['readSettled']);
      selection.closeAdmission(); await selection.waitForSettlement();
      await main!.assertSelected();
    } finally {
      held.release(); await Promise.allSettled([reading, handoff]);
      selection.closeAdmission(); main?.closeAdmission();
      await Promise.all([selection.waitForSettlement(), main?.waitForSettlement()]);
    }
  });
});

it.for(['registry', 'journal', 'binding', 'root', 'localRestore'] as const)(
  'production handoff rejects changed %s evidence without rebasing or modifying it', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selection = productionSelection(f), selected = await selection.discover();
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      let changedPath = f.journalPath;
      if (kind === 'registry') changedPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
      if (kind === 'binding') changedPath = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath;
      if (kind === 'root') await mkdir(f.workspacePaths.workspaceRoot, { recursive: true });
      else if (kind === 'localRestore') {
        changedPath = f.blockedJournals.unprovedTargetRestore.currentPath;
        await mkdir(dirname(changedPath), { recursive: true }); await writeFile(changedPath, '{}\n', { flag: 'wx' });
      } else await writeFile(changedPath, Buffer.concat([await readFile(changedPath), Buffer.from(' ')]));
      const preserved = await readFile(changedPath);
      try {
        await expect(selected.handoff(f)).rejects.toThrow();
        expect(selected.assertCurrent).toThrow();
        await expect(selected.handoff(f)).rejects.toThrow();
        expect(await readFile(changedPath)).toEqual(preserved);
      } finally { selection.closeAdmission(); await selection.waitForSettlement(); }
    });
  },
);

it('production request failure is isolated but detected main ownership loss is irreversible', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    let alive = true;
    const mainLost = new Error('SYNTHETIC_MAIN_OWNER_LOST');
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const main = await selected.handoff({ assertCurrent() { f.assertCurrent(); if (!alive) throw mainLost; }, assertOwned: f.assertOwned });
    selection.closeAdmission(); await selection.waitForSettlement();
    try {
      const requestFailure = new Error('SYNTHETIC_REQUEST_LOCAL_SOURCE');
      vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockRejectedValueOnce(requestFailure);
      await expect(main.readSelected(f)).rejects.toBe(requestFailure);
      await main.assertSelected();
      const held = holdDiscoveryRead(f), reading = main.readSelected(f);
      void reading.catch(() => undefined);
      try {
        await held.entered; alive = false; held.release();
        await expect(reading).rejects.toBe(mainLost);
        alive = true;
        await expect(main.readSelected(f)).rejects.toBe(mainLost);
        await expect(main.assertSelected()).rejects.toBe(mainLost);
      } finally { held.release(); await Promise.allSettled([reading]); }
    } finally { main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it.for(['discovery', 'handoff'] as const)('production quit waits for the %s read without publishing a late lifecycle', async (boundary, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), wrapper = createRecoveryStartupExperiment();
    let held: ReturnType<typeof holdDiscoveryRead> | undefined;
    let entered!: () => void;
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const publish = vi.fn();
    const outcome = wrapper.start(async port => {
      port.registerObservation(selection);
      if (boundary === 'discovery') { held = holdDiscoveryRead(f); entered(); }
      const selected = await selection.discover();
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      if (boundary === 'handoff') { held = holdDiscoveryRead(f); entered(); }
      const main = await selected.handoff(f);
      publish();
      return { async shutdown() { main.closeAdmission(); await main.waitForSettlement(); } };
    });
    await holding; await held!.entered;
    wrapper.beforeQuit(); let closed = false;
    const closing = wrapper.shutdown().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).toBe(false); expect(publish).not.toHaveBeenCalled();
    held!.release();
    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') { expect(result.reason).toBe(selection.signal.reason); expect(result.cleanupError).toBeUndefined(); }
    await closing; expect(closed).toBe(true);
    expect(held!.events).toEqual(['readSettled']); expect(publish).not.toHaveBeenCalled();
  });
});

it('production startup keeps the original source failure separate from intentional close', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), wrapper = createRecoveryStartupExperiment();
    const original = new Error('SYNTHETIC_ORIGINAL_RECOVERY_SOURCE', { cause: new Error('SYNTHETIC_SOURCE_CAUSE') });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.releaseOnClose(release);
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async () => {
      enter(); await held; throw original;
    });
    const outcome = wrapper.start(async port => { port.registerObservation(selection); await selection.discover(); return undefined; });
    await entered; wrapper.beforeQuit(); release();
    const result = await outcome;
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') { expect(result.reason).toBe(original); expect(result.cleanupError).toBeUndefined(); }
    await wrapper.shutdown();
    expect(await readFile(f.journalPath)).toBeDefined();
  });
});

it('production transferred owner joins an already started read before its close settles', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const main = await selected.handoff(f);
    selection.closeAdmission(); await selection.waitForSettlement();
    const held = holdDiscoveryRead(f), reading = main.readSelected(f);
    void reading.catch(() => undefined);
    let joined = false;
    try {
      await held.entered; main.closeAdmission();
      const closing = main.waitForSettlement().then(() => { joined = true; });
      await expect(main.readSelected(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(joined).toBe(false); expect(held.events).toEqual([]);
      held.release();
      await expect(reading).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await closing; expect(joined).toBe(true); expect(held.events).toEqual(['readSettled']);
    } finally { held.release(); await Promise.allSettled([reading]); main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it('production main assertion rejects a reentrant close before granting its read authority', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    let close: (() => void) | undefined, closing = false;
    const main = await selected.handoff({ assertCurrent() { f.assertCurrent(); if (closing) close?.(); }, assertOwned: f.assertOwned });
    close = main.closeAdmission;
    selection.closeAdmission(); await selection.waitForSettlement();
    try { closing = true; expect(main.assertCurrent).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED'); }
    finally { main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it('production request cannot borrow its proof to bypass an asynchronous main ownership failure', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    let lost = false;
    const first = new Error('SYNTHETIC_ASYNC_MAIN_OWNERSHIP');
    const main = await selected.handoff({ assertCurrent: f.assertCurrent, async assertOwned() {
      await f.assertOwned(); if (lost) throw first;
    } });
    selection.closeAdmission(); await selection.waitForSettlement();
    try {
      lost = true;
      await expect(main.readSelected(f)).rejects.toBe(first);
      lost = false;
      await expect(main.readSelected(f)).rejects.toBe(first);
      await expect(main.assertSelected()).rejects.toBe(first);
    } finally { main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it('production request proof failure does not poison the independently proved main owner', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const main = await selected.handoff(f), requestFailure = new Error('SYNTHETIC_REQUEST_PROOF_FAILURE');
    selection.closeAdmission(); await selection.waitForSettlement();
    try {
      await expect(main.readSelected({ assertCurrent: f.assertCurrent, async assertOwned() { throw requestFailure; } })).rejects.toBe(requestFailure);
      await main.assertSelected(); await main.readSelected(f);
    } finally { main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it.for(['startup', 'main', 'receipt'] as const)('production handoff observes closure from its last %s callback before publishing', async (boundary, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const makeAttempt = (closeAt = Infinity) => {
      let calls = 0;
      let selection!: ReturnType<typeof productionSelection>;
      let closeSelected: (() => void) | undefined;
      const authority = { assertCurrent() {
        f.assertCurrent(); calls++;
        if (calls === closeAt) {
          if (boundary === 'receipt') closeSelected?.(); else selection.closeAdmission();
        }
      }, assertOwned: f.assertOwned };
      selection = productionSelection(f, boundary === 'startup' ? authority : f);
      return { selection, authority: boundary === 'startup' ? f : authority, calls: () => calls,
        setReceipt(value: { closeAdmission(): void }) { closeSelected = value.closeAdmission; } };
    };
    const reference = makeAttempt();
    let owned: { closeAdmission(): void; waitForSettlement(): Promise<void> } | undefined;
    try {
      const selected = await reference.selection.discover();
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      reference.setReceipt(selected);
      owned = await selected.handoff(reference.authority);
      expect(reference.selection.signal.aborted).toBe(false);
    } finally {
      reference.selection.closeAdmission(); owned?.closeAdmission();
      await Promise.all([reference.selection.waitForSettlement(), owned?.waitForSettlement()]);
    }
    expect(reference.calls()).toBeGreaterThan(0);
    // The unchanged reference identifies the final callback, without hard-coding guard counts.
    const attempt = makeAttempt(reference.calls()), published = vi.fn();
    const unpublished: { receipt?: typeof owned } = {};
    const before = await readFile(f.journalPath);
    try {
      const selected = await attempt.selection.discover();
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      attempt.setReceipt(selected);
      const failure = await selected.handoff(attempt.authority).then(value => { unpublished.receipt = value; published(); }, (cause: unknown) => cause);
      if (boundary === 'receipt') {
        expect(attempt.selection.signal.aborted).toBe(false);
        expect(failure).toBeInstanceOf(Error); expect(failure).toMatchObject({ message: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      } else {
        expect(attempt.selection.signal.aborted).toBe(true); expect(failure).toBe(attempt.selection.signal.reason);
      }
      expect(published).not.toHaveBeenCalled();
      expect(await readFile(f.journalPath)).toEqual(before);
    } finally {
      attempt.selection.closeAdmission(); unpublished.receipt?.closeAdmission();
      await Promise.all([attempt.selection.waitForSettlement(), unpublished.receipt?.waitForSettlement()]);
    }
  });
});

type ProductionRecoveryOffer = Extract<Awaited<ReturnType<ReturnType<typeof productionSelection>['discover']>>, { mode: 'offered' }>;
type ProductionRecoveryReceipt = Awaited<ReturnType<ProductionRecoveryOffer['handoff']>>;
type StatusProjectionInput = Omit<Parameters<ProductionRecoveryReceipt['readStatus']>[0], 'context'> & {
  service: Pick<WorkspaceManagementService, 'captureStatusReadContext'>;
};

function statusReceipt<Selection extends Omit<ProductionRecoveryReceipt, 'transferSourceSelection'>>(selected: Selection) {
  return Object.freeze({ ...selected, revoke: selected.closeAdmission,
    readStatus(input: StatusProjectionInput) {
      return selected.readStatus({ ...input, context: input.service.captureStatusReadContext() });
    },
  });
}

async function discoverStatus(f: DiscoveryFixture) {
  const selection = productionSelection(f), selected = await selection.discover();
  if (selected.mode !== 'offered') return selected;
  return Object.freeze({ ...statusReceipt(selected),
    async handoff(authority: Parameters<ProductionRecoveryOffer['handoff']>[0]) { return statusReceipt(await selected.handoff(authority)); },
    revoke() { selection.closeAdmission(); selected.closeAdmission(); },
  });
}

type StatusDiscoveryReceipt = Extract<Awaited<ReturnType<typeof discoverStatus>>, { mode: 'offered' }>;

function statusProjectionFixture(f: DiscoveryFixture) {
  const maintenance = new InMemoryWorkspaceMaintenanceLease(), jobs: Promise<unknown>[] = [];
  const leases: Awaited<ReturnType<typeof maintenance.acquire>>[] = [];
  let enter!: () => void, release!: () => void, absent = true;
  const commandEntered = new Promise<void>(resolve => { enter = resolve; });
  const commandPending = new Promise<void>(resolve => { release = resolve; });
  f.releaseOnClose(() => { enter(); release(); });
  const blocked = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'create');
  const absenceLost = new Error('SYNTHETIC_RUNTIME_ABSENCE_LOST');
  const assertAbsent = () => { if (!absent) throw absenceLost; };
  // A controlled startup-proof port, deliberately not inferred from the real main reservation.
  const runtimeAbsence = { assertCurrent: vi.fn(assertAbsent), assertOwned: vi.fn(async () => assertAbsent()) };
  const unexpected = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_COMMAND'); });
  const service = new WorkspaceManagementService({
    createEmpty: { create: unexpected }, importBackup: { import: unexpected },
    switchWorkspace: { switchTo: unexpected }, renameWorkspace: { rename: unexpected },
    registry: { read: unexpected }, maintenanceState: maintenance,
    operationGuard: { async assertNoUnresolvedOperations() { enter(); await commandPending; throw blocked; },
      async readRecoveryState() { return 'recoveryRequired'; } },
  });
  const track = <T>(job: Promise<T>) => { jobs.push(job); void job.catch(() => undefined); return job; };
  return { service, maintenance, runtimeAbsence, unexpected, absenceLost, blocked, commandEntered,
    setAbsent(value: boolean) { absent = value; },
    releaseCommand: release,
    startCommand() { return track(service.createEmpty('Synthetic projection command')); },
    acquire() { return track(maintenance.acquire('backup').then(handle => { leases.push(handle); return handle; })); },
    read(selected: StatusDiscoveryReceipt | ReturnType<typeof statusReceipt>) {
      return track(selected.readStatus({ service, maintenance, authority: f, runtimeAbsence }));
    },
    async close() {
      service.closeAdmission(); release();
      await Promise.allSettled(jobs); await service.shutdown();
      for (const handle of leases) await handle.release();
    },
  };
}

it.for(['target', 'other', 'none'] as const)('production status composition preserves the %s pointer before ordinary factories', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = (await f.registry.inspect())!;
    const pointer = active === 'target' ? f.binding.workspaceId : active === 'other' ? otherWorkspaceId : null;
    await f.registry.write({ ...registry, activeWorkspaceId: pointer });
    const selection = productionSelection(f), selected = await selection.discover();
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const main = await selected.handoff(f);
    selection.closeAdmission(); await selection.waitForSettlement();
    const control = statusProjectionFixture(f);
    const candidatePaths = vi.spyOn(candidateRuntimePaths, 'resolveWorkspaceCandidateRuntimePaths');
    const log = vi.fn();
    const management = await createWorkspaceManagementComposition({ mode: 'recoveryManagement',
      operationalIdentity: { appVersion: metadata.appVersion, buildRevision: metadata.buildRevision, runtimeInstanceId: randomUUID() },
      operationalLogger: { write: log }, recoveryManagement: {
      targetWorkspaceId: main.target.workspaceId, assertCurrent: main.assertCurrent, assertSelected: main.assertSelected,
      readStatus: context => main.readStatus({ context, maintenance: control.maintenance, authority: f, runtimeAbsence: control.runtimeAbsence }),
    } });
    const service = management.service;
    const repairingRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
    const beforeRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), beforeJournal = await readFile(f.journalPath);
    try {
      const result = await service.getRecoveryManagementStatus(); result.assertCurrent();
      expect(result.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: pointer,
        target: { workspaceId: main.target.workspaceId, workspaceLabel: main.target.workspaceLabel } });
      await expect(service.getStatus()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      await expect(service.createEmpty('Synthetic forbidden')).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      const observed = management.captureOperationObservation();
      expect(observed.readObservation()).toMatchObject({ scope: 'currentOperation', status: 'available', cleanupError: null,
        firstError: { eventName: 'workspaceManagement.operationFailed', operationId: 'workspace.create',
          errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' } });
      expect(log).toHaveBeenCalledOnce();
      expect(repairingRead).not.toHaveBeenCalled(); expect(candidatePaths).not.toHaveBeenCalled();
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(beforeRegistry);
      expect(await readFile(f.journalPath)).toEqual(beforeJournal);
      expect(control.runtimeAbsence.assertOwned).toHaveBeenCalledTimes(2);
    } finally { await management.shutdown(); await control.close(); main.closeAdmission(); await main.waitForSettlement(); }
  });
});

it.for(['target', 'other', 'none'] as const)('discovers the real target independently of the %s active pointer', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = (await f.registry.inspect())!;
    await f.registry.write({ ...registry, activeWorkspaceId: active === 'target' ? f.binding.workspaceId
      : active === 'other' ? otherWorkspaceId : null });
    const bytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const inspect = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots');
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    expect(selected.target.workspaceId).toBe(f.binding.workspaceId);
    expect(selected.persistedActiveWorkspaceId).toBe(active === 'target'
      ? f.binding.workspaceId : active === 'other' ? otherWorkspaceId : null);
    expect(selected.owners).toEqual(['workspaceImport']);
    expect(inspect).toHaveBeenCalledTimes(2);
    const production = await readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo, authority: f });
    expect(production.mode).toBe('candidate');
    expect(production.target?.workspaceId).toBe(selected.target.workspaceId);
    expect(production.persistedActiveWorkspaceId).toBe(selected.persistedActiveWorkspaceId);
    await selected.assertSelected();
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(bytes);
    expect(Object.keys(selected)).not.toContain('delete');
    selected.revoke();
  });
});

const guardedRecoveryOwners = ['workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration'] as const;

async function prepareGuardedRecoverySource(f: DiscoveryFixture, owner: typeof guardedRecoveryOwners[number] | 'combined') {
  if (owner === 'workspaceImport') return;
  if (owner !== 'combined') await rm(f.journalPath);
  const add = async (kind: Exclude<typeof guardedRecoveryOwners[number], 'workspaceImport'>) => {
    const binding = captureWorkspaceRemnantBinding({ ...f.binding, owner: kind });
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
      { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
    if (kind === 'workspaceLegacyAdoption') {
      await new WorkspaceLegacyAdoptionJournalStore(f.root).write({ ...createAdoptionJournal('prepared'),
        operationId: binding.operationId, workspaceId: binding.workspaceId });
    } else {
      await new ProfileRestoreActivationJournalStore(deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath)
        .write({ formatVersion: 1, operationId: binding.operationId, phase: 'prepared', revision: 0,
          hadActiveDatabase: true, hadActiveDocuments: true });
    }
  };
  if (owner === 'combined') { await add('workspaceLegacyAdoption'); await add('workspaceActivationMigration'); }
  else await add(owner);
}

async function withNativeRecoveryStatus(f: DiscoveryFixture, work: (input: {
  main: ProductionRecoveryReceipt;
  management: Awaited<ReturnType<typeof createWorkspaceManagementComposition>>;
}) => Promise<void>) {
  const selection = productionSelection(f);
  let main: ProductionRecoveryReceipt | undefined;
  let management: Awaited<ReturnType<typeof createWorkspaceManagementComposition>> | undefined;
  let firstFailure: { error: unknown } | undefined;
  try {
    const offered = await selection.discover();
    if (offered.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    await expect(selectDesktopWorkspaceRecoveryChoice({ selection: offered, ownership: f, signal: selection.signal,
      async showMessageBox() { return { response: 1 }; } })).resolves.toBe('manage');
    main = await offered.handoff(f);
    selection.closeAdmission(); await selection.waitForSettlement();
    const owner = main, maintenance = new InMemoryWorkspaceMaintenanceLease();
    // Bound current-source eligibility and real native exclusion are both required.
    management = await createWorkspaceManagementComposition({ mode: 'recoveryManagement',
      operationalIdentity: { appVersion: metadata.appVersion, buildRevision: metadata.buildRevision, runtimeInstanceId: randomUUID() },
      operationalLogger: { write: vi.fn() }, recoveryManagement: {
        targetWorkspaceId: owner.target.workspaceId, assertCurrent: owner.assertCurrent, assertSelected: owner.assertSelected,
        readStatus: context => owner.readStatus({ context, maintenance, authority: f, runtimeAbsence: f }),
      } });
    await work({ main, management });
  } catch (error) { firstFailure = { error }; throw error; }
  finally {
    const cleanup: unknown[] = [];
    try { await management?.shutdown(); } catch (error) { cleanup.push(error); }
    main?.closeAdmission();
    try { await main?.waitForSettlement(); } catch (error) { cleanup.push(error); }
    selection.closeAdmission();
    try { await selection.waitForSettlement(); } catch (error) { cleanup.push(error); }
    if (cleanup.length !== 0) {
      const errors = [...(firstFailure === undefined ? [] : [firstFailure.error]), ...cleanup];
      throw new AggregateError(errors, 'Synthetic native recovery status cleanup failed', { cause: errors[0] });
    }
  }
}

it('publication handoff keeps the selected last company and never rereads discovery after its own journal', async context => {
  const f = await fixture(context);
  const phases = ['fixtureReady'];
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state !== 'pass') await writeFile(join(f.root, 'publication-handoff-phases.private.json'),
      JSON.stringify({ schemaVersion: 1, phases }) + '\n', { flag: 'wx', mode: 0o600 });
  });
  await f.run(async () => {
    const initial = await f.registry.inspect();
    if (initial === undefined) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
    await f.registry.write({ ...initial, workspaces: initial.workspaces.filter(entry => entry.workspaceId === f.binding.workspaceId) });
    await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    const sentinel = join(f.workspacePaths.workspaceRoot, 'retained-publication-payload');
    await writeFile(sentinel, 'retained', { flag: 'wx' });
    const beforeRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), beforeJournal = await readFile(f.journalPath);
    await withNativeRecoveryStatus(f, async ({ main }) => {
      phases.push('mainReady');
      const maintenance = new InMemoryWorkspaceMaintenanceLease(), lease = await maintenance.acquire('delete');
      const checkLease = maintenance.captureCurrentOwner(['delete'], lease);
      const guard = () => { checkLease(); main.assertCurrent(); f.assertCurrent(); };
      const owned = async () => { guard(); await f.assertOwned(); guard(); };
      const target = await captureDeletionTarget({ installationRoot: f.root, workspaceId: main.target.workspaceId,
        typedLabel: main.target.workspaceLabel, registry: f.registry, assertAuthority: guard });
      phases.push('targetCaptured');
      let external: Awaited<ReturnType<typeof captureWorkspaceDeletionExternalSelectionFromRoot>> | undefined;
      const snapshots = vi.spyOn(recoverySources, 'readDesktopWorkspaceRecoveryTarget');
      let transferredAt: number | undefined;
      const readOwned = async () => {
        await owned(); target.assertValid();
        if (await hasAnyJournalSlot(f.blockedJournals.unprovedTargetRestore)) throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        guard(); external?.assertCurrent();
      };
      const selected = async () => {
        await readOwned();
        if (external === undefined) await main.assertSelected(); else await external.assertSelected();
        await readOwned();
      };
      const handoff = vi.fn(async (journal: Parameters<typeof captureWorkspaceDeletionExternalSelectionFromRoot>[0]['journal'],
        afterRegistry: Parameters<typeof captureWorkspaceDeletionExternalSelectionFromRoot>[0]['afterRegistry']) => {
        phases.push('handoffStarted');
        external = await main.transferSourceSelection(async authority => {
          phases.push('replacementCaptureStarted');
          const selected = await captureWorkspaceDeletionExternalSelectionFromRoot({
            userDataRoot: f.root, buildInfo, releaseInfo, journal, afterRegistry,
            assertCurrent() { guard(); authority.assertCurrent(); },
            async assertOwned() { await authority.assertOwned(); await owned(); },
            assertWritersAbsent: owned,
          });
          phases.push('replacementCaptured'); return selected;
        });
        phases.push('handoffCompleted');
        transferredAt = snapshots.mock.calls.length;
      });
      const publish = createWorkspaceDeletionPublisher({ userDataRoot: f.root, registry: f.registry,
        assertWritersAbsent: owned, beforeJournalPublication: handoff });
      try {
        await selected();
        phases.push('publicationStarted');
        const result = await publish(guard, selected, target.target,
          { operationId: randomUUID(), target: target.target, backupDisposition: 'explicitDataLoss' }, readOwned, owned);
        phases.push('publicationCompleted');
        expect(result.journal.phase).toBe('authorized'); expect(handoff).toHaveBeenCalledOnce();
        expect(external).toBeDefined(); expect(transferredAt).toBeDefined();
        await external!.assertSelected();
        phases.push('replacementRechecked');
        expect(snapshots).toHaveBeenCalledTimes(transferredAt!);
        expect((await new WorkspaceDeletionJournalStore(f.root).inspect(guard)).plan.mode).toBe('published');
        phases.push('publishedJournalChecked');
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(beforeRegistry);
        expect(await readFile(f.journalPath)).toEqual(beforeJournal);
        expect(await readFile(sentinel, 'utf8')).toBe('retained');
        main.assertCurrent(); await owned();
        phases.push('retainedBytesChecked');
      } finally { external?.revoke(); await lease.release(); phases.push('leaseReleased'); }
      expect(maintenance.readState()).toBe('idle');
    });
  });
}, 10_000);

it.for(guardedRecoveryOwners)('joins guarded %s selection with native main ownership before status publication', async (owner, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    await prepareGuardedRecoverySource(f, owner);
    const originalRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const originalBinding = new WorkspaceRemnantBindingStore(f.root,
      workspaceRemnantBindingKey(captureWorkspaceRemnantBinding({ ...f.binding, owner })));
    const bindingBefore = await originalBinding.inspect({ assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
    const repairingRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
    const candidate = vi.spyOn(candidateRuntimePaths, 'resolveWorkspaceCandidateRuntimePaths');
    await withNativeRecoveryStatus(f, async ({ main, management }) => {
      expect(main.owners).toEqual([owner]);
      const status = await management.service.getRecoveryManagementStatus();
      status.assertCurrent();
      expect(status.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        operationState: 'idle', maintenanceState: 'idle', persistedActiveWorkspaceId: f.binding.workspaceId,
        target: { workspaceId: f.binding.workspaceId, workspaceLabel: main.target.workspaceLabel } });
      await expect(management.service.getStatus()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      expect(repairingRead).not.toHaveBeenCalled(); expect(candidate).not.toHaveBeenCalled();
      expect(Object.keys(main)).not.toContain('delete');
    });
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(originalRegistry);
    expect(await originalBinding.inspect({ assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned })).toEqual(bindingBefore);
  });
});

it.for(['target', 'other'] as const)('does not substitute an empty selector for the persisted %s recovery choice during deletion preparation', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const initial = await f.registry.inspect();
    if (initial === undefined) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
    const persisted = active === 'target' ? f.binding.workspaceId : otherWorkspaceId;
    await f.registry.write({ ...initial, activeWorkspaceId: persisted });
    await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
    const registryBefore = await readFile(registryPath), journalBefore = await readFile(f.journalPath);
    await withNativeRecoveryStatus(f, async ({ main }) => {
      expect(main.persistedActiveWorkspaceId).toBe(persisted);
      const maintenance = new InMemoryWorkspaceMaintenanceLease(), lease = await maintenance.acquire('delete');
      const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_RECOVERY_PREPARATION_NOT_ADMITTED'); });
      const unexpectedAsync = vi.fn(async (): Promise<never> => unexpected());
      const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ assertSelectorCurrent: main.assertCurrent,
        reservation: { assertMainCurrent: f.assertCurrent, assertMainOwned: f.assertOwned },
        maintenanceLease: maintenance, runtimeRelaunch: new DeferredWorkspaceRuntimeRelaunch(unexpected) });
      try {
        await expect(prepareWorkspaceDeletion({ operationId: randomUUID(), runtimeGeneration: randomUUID(),
          request: { formatVersion: 1, workspaceId: main.target.workspaceId,
            typedLabel: main.target.workspaceLabel, backupChoice: 'explicitDataLoss' },
          installationRoot: f.root, registry: f.registry,
          runtime: { kind: 'selector', lifecycle },
          lifetime: { assertCurrent: main.assertCurrent, closeAdmissionForOwnStop: unexpected },
          assertLease: maintenance.captureCurrentOwner(['delete'], lease),
          assertMainReservation: f.assertOwned, assertMainReservationCurrent: f.assertCurrent,
          closeServiceAdmission: unexpected, confirmDataLoss: unexpectedAsync,
          confirmDeletion: unexpectedAsync, confirmReturn: unexpectedAsync,
          setReturnGuard: unexpected, publish: unexpectedAsync,
        })).rejects.toThrow('WORKSPACE_DELETE_RUNTIME_MISMATCH');
        expect(lifecycle.readState()).toBe('ready');
        expect(unexpected).not.toHaveBeenCalled(); expect(unexpectedAsync).not.toHaveBeenCalled();
        await main.assertSelected();
        expect(await readFile(registryPath)).toEqual(registryBefore);
        expect(await readFile(f.journalPath)).toEqual(journalBefore);
      } finally { await lease.release(); }
      expect(maintenance.readState()).toBe('idle');
    });
  });
});

it('requires real child close and a fresh main reservation before admitting guarded recovery metadata', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
    await f.closeMainReservation();
    const child = startDeletionProcessChild(context, { root: f.root, mode: 'publish', cut: 'reservationAcquired',
      operationId: randomUUID(), workspaceId: f.binding.workspaceId, label: 'Synthetic recovery observation',
      buildInfo, releaseInfo, testId: context.task.id });
    let resumedOwner: Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>> | undefined;
    let mainActive = true, firstFailure: { error: unknown } | undefined;
    try {
      expect(await child.message('cut')).toMatchObject({ pid: child.pid, cut: 'reservationAcquired' });
      await assertDeletionReservationBusy(() => acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: context.signal }));
      expect(child.readEvidence().after.closed).toBe(false);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
      await child.killAndJoin();
      expect(child.readEvidence()).toMatchObject({ after: { closed: true, terminationRequested: true } });
      expect(child.readEvidence().close).not.toBeNull();
      resumedOwner = await acquireDesktopWorkspaceReservation({ userDataRoot: f.root, signal: context.signal,
        assertSingleInstanceOwnership() {
          context.signal.throwIfAborted();
          if (!mainActive) throw new Error('SYNTHETIC_RESUMED_MAIN_CLOSED');
        } });
      const owner = resumedOwner;
      const assertCurrent = () => { context.signal.throwIfAborted(); owner.assertMainCurrent(); };
      const resumed = { ...f, assertCurrent,
        async assertOwned() { assertCurrent(); await owner.assertMainOwned(); assertCurrent(); } };
      await withNativeRecoveryStatus(resumed, async ({ management }) => {
        const status = await management.service.getRecoveryManagementStatus(); status.assertCurrent();
        expect(status.value).toMatchObject({ mode: 'recoveryManagement', runtimeState: 'absent',
          persistedActiveWorkspaceId: f.binding.workspaceId, target: { workspaceId: f.binding.workspaceId } });
      });
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
    } catch (error) { firstFailure = { error }; throw error; }
    finally {
      const results = await Promise.allSettled([Promise.resolve().then(() => resumedOwner?.close()), child.finish()]);
      mainActive = false;
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length !== 0) {
        const errors = [...(firstFailure === undefined ? [] : [firstFailure.error]), ...failures];
        throw new AggregateError(errors, 'Synthetic recovery child cleanup failed', { cause: errors[0] });
      }
    }
  });
});

it('keeps a changed binding after the native choice and refuses a late management choice', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selection = productionSelection(f), offered = await selection.discover();
    if (offered.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding));
    const original = await readFile(paths.currentPath), retained = paths.currentPath + '.retained';
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
    try {
      await expect(selectDesktopWorkspaceRecoveryChoice({ selection: offered, ownership: f, signal: selection.signal,
        async showMessageBox() {
          await rename(paths.currentPath, retained);
          await writeFile(paths.currentPath, original, { flag: 'wx', mode: 0o600 });
          return { response: 1 };
        } })).rejects.toThrow();
      expect(await readFile(paths.currentPath)).toEqual(original); expect(await readFile(retained)).toEqual(original);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
    } finally { selection.closeAdmission(); await selection.waitForSettlement(); }
  });
});

it.for(['candidateBound', 'nativeReleased', 'ownerClosed'] as const)(
  'rejects recovery status after native admission changes by %s without reviving the old owner', async (change, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journalBefore = await readFile(f.journalPath);
      await withNativeRecoveryStatus(f, async ({ main, management }) => {
        const initial = await management.service.getRecoveryManagementStatus(); initial.assertCurrent();
        if (change === 'candidateBound') f.bind();
        else if (change === 'nativeReleased') await f.closeMainReservation();
        else main.closeAdmission();
        let first: unknown;
        try { initial.assertCurrent(); } catch (cause) { first = cause; }
        expect(first).toBeInstanceOf(Error);
        await expect(management.service.getRecoveryManagementStatus()).rejects.toMatchObject({
          code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', operationKind: 'status',
        });
        if (change === 'candidateBound') { await f.reclaim(); await f.assertOwned(); }
        await expect(management.service.getRecoveryManagementStatus()).rejects.toMatchObject({
          code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', operationKind: 'status',
        });
        await expect(main.assertSelected()).rejects.toBe(first);
        await expect(main.readSelected(f)).rejects.toBe(first);
      });
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
      expect(await readFile(f.journalPath)).toEqual(journalBefore);
    });
  },
);

it.for(['workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration', 'combined'] as const)(
  'discovers %s using original-owner keys rather than a deletion target header', async (owner, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      await prepareGuardedRecoverySource(f, owner);
      const before = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const selected = await discover(f);
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      expect(selected.target.workspaceId).toBe(f.binding.workspaceId);
      expect(selected.owners).toEqual(owner === 'combined'
        ? ['workspaceImport', 'workspaceLegacyAdoption', 'workspaceActivationMigration'] : [owner]);
      const production = await readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo, authority: f });
      expect(production.mode).toBe('candidate');
      expect(production.target?.workspaceId).toBe(selected.target.workspaceId);
      expect(production.owners).toEqual(selected.owners);
      await selected.assertSelected();
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(before);
      selected.revoke();
    });
  },
);

it.for((['workspaceImport', 'workspaceLegacyAdoption', 'workspaceReplacement', 'workspaceActivationMigration'] as const)
  .flatMap(owner => (['target', 'other', 'none'] as const).map(active => ({ owner, active }))))(
  'observes local restore and independently bound $owner with $active pointer without granting recovery or deletion', async ({ owner, active }, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const localPath = f.blockedJournals.unprovedTargetRestore.currentPath;
    const local = await readFile(localPath);
    const registry = (await f.registry.inspect())!;
    await f.registry.write({ ...registry, activeWorkspaceId: active === 'target' ? f.binding.workspaceId
      : active === 'other' ? otherWorkspaceId : null });
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    expect(selected.target.workspaceId).toBe(f.binding.workspaceId);
    expect(selected.owners).toEqual(['localRestore']);
    selected.revoke();
    const binding = captureWorkspaceRemnantBinding({ ...f.binding, owner });
    await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
      { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
    if (owner === 'workspaceImport') await new WorkspaceBackupImportJournalStore({ installationRoot: f.root, filePath: f.journalPath }).write({
      formatVersion: 2, operationId: f.binding.operationId, workspaceId: f.binding.workspaceId,
      workspaceLabel: 'Synthetic recovery observation', createdAt: time, previousActiveWorkspaceId: null,
      state: 'prepared', lineageIdentity: null,
    });
    else if (owner === 'workspaceLegacyAdoption') await new WorkspaceLegacyAdoptionJournalStore(f.root)
      .write({ ...createAdoptionJournal('prepared'), operationId: binding.operationId, workspaceId: binding.workspaceId });
    else await new ProfileRestoreActivationJournalStore(deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath)
      .write({ formatVersion: 1, operationId: binding.operationId, phase: 'prepared', revision: 0,
        hadActiveDatabase: true, hadActiveDocuments: true });
    const normalAdmission = () => readColdWorkspaceRecoveryAdmissionFromRoot(f.root).then(
      admission => ({ status: 'fulfilled', admission }), cause => {
        expect(cause).toBeInstanceOf(WorkspaceManagementRecoveryRequiredError);
        return { status: 'rejected', code: cause.message };
      });
    const beforeNormal = await normalAdmission();
    const beforeRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const mixed = await discover(f);
    expect(mixed.mode).toBe('offered');
    if (mixed.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    expect(mixed.owners).toEqual([owner, 'localRestore']);
    expect(Object.keys(mixed)).not.toContain('delete');
    const production = await readDesktopWorkspaceRecoveryTarget({ root: f.root, buildInfo, releaseInfo, authority: f });
    expect(production).toMatchObject({ mode: 'notOffered', reason: 'unprovedLocalRestore', target: undefined });
    await mixed.assertSelected(); mixed.revoke();
    expect(await normalAdmission()).toEqual(beforeNormal);
    expect(await readFile(localPath)).toEqual(local);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(beforeRegistry);
  });
});

it.for(['next', 'backup'] as const)('discovers an allowed original %s-only slot without promoting it', async (slot, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    await rename(f.journalPath, f.journalPath + '.' + slot);
    const bytes = await readFile(f.journalPath + '.' + slot);
    const selected = await discover(f);
    expect(selected.mode).toBe('offered');
    if (selected.mode === 'offered') selected.revoke();
    await expect(readFile(f.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.journalPath + '.' + slot)).toEqual(bytes);
  });
});

it.for(['registry', 'journal', 'binding', 'foreignRestore'] as const)(
  'expires a discovered target after %s changes and never adopts a new baseline', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selected = await discover(f);
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const path = kind === 'registry' ? join(f.root, WORKSPACE_REGISTRY_FILE_NAME) : kind === 'journal' ? f.journalPath
        : kind === 'binding' ? createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath
        : f.blockedJournals.foreignRestore.nextPath;
      if (kind === 'foreignRestore') {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, JSON.stringify({ formatVersion: 1, operationId: randomUUID(), phase: 'prepared', revision: 0,
          hadActiveDatabase: true, hadActiveDocuments: true }) + '\n');
      } else {
        const bytes = await readFile(path);
        await rename(path, path + '.retained'); await writeFile(path, bytes, { flag: 'wx' });
      }
      const retained = await readFile(path);
      await expect(selected.handoff(f)).rejects.toThrow();
      await expect(selected.assertSelected()).rejects.toThrow();
      expect(await readFile(path)).toEqual(retained);
    });
  },
);

it.for(['noJournal', 'unboundImport', 'legacyRegistry', 'missingRegistry', 'creation'] as const)(
  'offers no new management for recognized %s and preserves the ordinary owner', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      if (kind === 'noJournal') await rm(f.journalPath);
      if (kind === 'unboundImport') await rm(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath);
      if (kind === 'missingRegistry') await rm(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      if (kind === 'legacyRegistry') {
        const registry = (await f.registry.inspect())!;
        await writeFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME), JSON.stringify({ ...registry, formatVersion: 1 }) + '\n');
      }
      if (kind === 'creation') {
        await writeFile(f.blockedJournals.creation.currentPath, JSON.stringify({
          formatVersion: 2, operationId: randomUUID(), workspaceId: otherWorkspaceId,
          workspaceLabel: 'Synthetic creation', previousActiveWorkspaceId: f.binding.workspaceId,
          state: 'prepared', createdAt: time, lineageIdentity: null,
        }) + '\n');
      }
      const ordinary = vi.fn();
      const result = await discover(f);
      if (result.mode === 'notOffered') ordinary();
      expect(result.mode).toBe('notOffered'); expect(ordinary).toHaveBeenCalledOnce();
      if (kind === 'noJournal') expect(result).toMatchObject({ reason: 'noJournalTarget' });
    });
  },
);

it.for(['malformedRegistry', 'malformedJournal', 'malformedCreation', 'genericConflict', 'io'] as const)(
  'does not turn %s into permission to fall back to ordinary startup', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      if (kind === 'malformedRegistry') await writeFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME), '{"formatVersion":2}\n');
      if (kind === 'malformedJournal') await writeFile(f.journalPath, '{"formatVersion":2}\n');
      if (kind === 'malformedCreation') await writeFile(f.blockedJournals.creation.backupPath, '{}\n');
      const cause = new Error(kind === 'genericConflict' ? 'LOCAL_UPDATE_STATE_MIGRATION_CONFLICT' : 'SYNTHETIC_IO_FAILURE');
      if (kind === 'genericConflict' || kind === 'io') {
        vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockRejectedValueOnce(cause);
      }
      const ordinary = vi.fn();
      await expect(discover(f).then(result => { if (result.mode === 'notOffered') ordinary(); })).rejects.toThrow();
      expect(ordinary).not.toHaveBeenCalled();
    });
  },
);

it('hands copied expectations to a new lifetime without retaining or reviving startup authority', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    let startupActive = true, serviceActive = true;
    const checkStartup = () => { f.assertCurrent(); if (!startupActive) throw new Error('SYNTHETIC_STARTUP_CLOSED'); };
    const selected = await discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent: checkStartup, assertOwned: f.assertOwned } });
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const service = await selected.handoff({ assertCurrent() {
      f.assertCurrent(); if (!serviceActive) throw new Error('SYNTHETIC_SERVICE_CLOSED');
    }, assertOwned: f.assertOwned });
    startupActive = false;
    await expect(selected.assertSelected()).rejects.toThrow();
    await service.assertSelected();
    await expect(selected.handoff(f)).rejects.toThrow();
    serviceActive = false;
    await expect(service.assertSelected()).rejects.toThrow('SYNTHETIC_SERVICE_CLOSED');
    serviceActive = true;
    await expect(service.assertSelected()).rejects.toThrow('SYNTHETIC_SERVICE_CLOSED');
    service.revoke();
  });
});

it('drains a delayed discovery read before rejecting a closed startup and preserves the first error', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    let active = true, release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.releaseOnClose(release);
    const events: string[] = [], cause = new Error('SYNTHETIC_DISCOVERY_OWNER_CLOSED');
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
      const result = await inspect.apply(this, args);
      entered(); await held;
      events.push('readSettled'); return result;
    });
    const pending = f.run(() => discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent() { f.assertCurrent(); if (!active) throw cause; }, assertOwned: f.assertOwned } })
      .then(() => { throw new Error('SYNTHETIC_UNEXPECTED_OFFER'); }, error => { events.push('rejected'); throw error; }));
    void pending.catch(() => undefined);
    await started; active = false;
    expect(events).toEqual([]); release();
    await expect(pending).rejects.toBe(cause);
    expect(events).toEqual(['readSettled', 'rejected']);
    expect(await readFile(f.journalPath)).toBeDefined();
  });
});

it('hands discovery across the real startup wrapper and closes the new lifetime only with its lifecycle', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const wrapper = createRecoveryStartupExperiment();
    const observation = createRecoveryObservationExperiment();
    let serviceActive = true;
    let selected: Awaited<ReturnType<typeof discoverRecoveryTargetExperiment>> | undefined;
    let service: Awaited<ReturnType<Extract<NonNullable<typeof selected>, { mode: 'offered' }>['handoff']>> | undefined;
    const outcome = await wrapper.start(async port => {
      port.registerObservation(observation);
      selected = await observation.run(() => discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo,
        authority: { assertCurrent() { observation.assertCurrent(); f.assertCurrent(); }, assertOwned: f.assertOwned } }));
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const admitted = selected;
      service = await observation.run(() => admitted.handoff({
        assertCurrent() {
          f.assertCurrent();
          if (port.isClosing() || !serviceActive) throw new Error('SYNTHETIC_SERVICE_CLOSED');
        }, assertOwned: f.assertOwned,
      }));
      return { async shutdown() { serviceActive = false; service?.revoke(); } };
    });
    expect(outcome.status).toBe('fulfilled');
    expect(service).toBeDefined();
    await service!.assertSelected();
    expect(() => observation.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    if (selected?.mode === 'offered') await expect(selected.assertSelected()).rejects.toThrow();
    await wrapper.shutdown();
    await expect(service!.assertSelected()).rejects.toThrow();
    expect(wrapper.port.isClosing()).toBe(true);
  });
});

it.for(['appears', 'replaced'] as const)('expires global discovery when its root %s with all metadata unchanged', async (change, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    if (change === 'replaced') await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const before = await readFile(f.journalPath);
    if (change === 'replaced') await rename(f.workspacePaths.workspaceRoot, f.workspacePaths.workspaceRoot + '.retained');
    await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    await expect(selected.handoff(f)).rejects.toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
    expect(await readFile(f.journalPath)).toEqual(before);
  });
});

it('drains the already started discovery read before publishing a separate handoff lifetime', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const events: string[] = [];
    f.releaseOnClose(release);
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
      const result = await inspect.apply(this, args); entered(); await held;
      events.push('readSettled'); return result;
    });
    const reading = f.run(() => selected.assertSelected().then(() => { events.push('oldReadJoined'); }));
    void reading.catch(() => undefined);
    await started;
    const handoff = f.run(() => selected.handoff(f).then(value => { events.push('servicePublished'); return value; }));
    void handoff.catch(() => undefined);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual([]);
    await expect(selected.assertSelected()).rejects.toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
    release(); await reading;
    const service = await handoff;
    expect(events).toEqual(['readSettled', 'oldReadJoined', 'servicePublished']);
    await service.assertSelected(); service.revoke();
  });
});

it.for(['lineage', 'foreignImport', 'activationAliases'] as const)(
  'refuses ambiguous discovered ownership for %s without changing its files', async (kind, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      if (kind === 'activationAliases') {
        for (const owner of ['workspaceReplacement', 'workspaceActivationMigration'] as const) {
          const binding = captureWorkspaceRemnantBinding({ ...f.binding, owner });
          await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
            { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
        }
        await new ProfileRestoreActivationJournalStore(deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath)
          .write({ formatVersion: 1, operationId: f.binding.operationId, phase: 'prepared', revision: 0,
            hadActiveDatabase: true, hadActiveDocuments: true });
      } else {
        const path = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath;
        const binding = { ...f.binding, ...(kind === 'lineage'
          ? { lineageIdentity: { formatVersion: 1, profileId: 'f'.repeat(64) } }
          : { workspaceId: otherWorkspaceId, lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) } }) };
        await writeFile(path, JSON.stringify(binding) + '\n');
      }
      const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
      await expect(discover(f)).rejects.toThrow();
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
    });
  },
);

it.for(foreignWorkspaceIds.flatMap(workspaceId => ['current', 'next', 'backup'].map(slot => ({ workspaceId, slot }))))(
  'never offers a guessed target when another registered $workspaceId has a $slot restore', async ({ workspaceId, slot }, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const paths = f.foreignRestoreJournals.find(value => value.workspaceId === workspaceId)!.paths;
      const path = slot === 'current' ? paths.currentPath : slot === 'next' ? paths.nextPath : paths.backupPath;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const bytes = Buffer.from(JSON.stringify({ formatVersion: 1, operationId: randomUUID(), phase: 'prepared', revision: 0,
        hadActiveDatabase: true, hadActiveDocuments: true }) + '\n');
      await writeFile(path, bytes);
      // Roots are owned and valid; refusal must concern multiple real targets, not a missing root.
      const selected = await discover(f);
      expect(selected).toMatchObject({ mode: 'notOffered', reason: 'multipleTargets' });
      expect(await readFile(path)).toEqual(bytes);
    });
  },
);

it.for(['next', 'backup'] as const)('preserves ordinary registry recovery with malformed discarded %s bytes', async (slot, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const path = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), bytes = await readFile(path);
    const sibling = `${path}.${slot}`, invalid = Buffer.from('{');
    const controlRoot = join(f.root, 'ordinary-registry-control');
    await mkdir(controlRoot);
    const controlPath = join(controlRoot, WORKSPACE_REGISTRY_FILE_NAME);
    await writeFile(controlPath, bytes, { flag: 'wx' });
    await writeFile(controlPath + `.${slot}`, invalid, { flag: 'wx' });
    await writeFile(sibling, invalid, { flag: 'wx' });
    const strict = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots');
    expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'registryRecovery' });
    expect(strict).not.toHaveBeenCalled();
    expect(await readFile(path)).toEqual(bytes);
    expect(await readFile(sibling)).toEqual(invalid);
    const control = new WorkspaceRegistryStore({ installationRoot: controlRoot, filePath: controlPath });
    expect(await f.registry.read()).toEqual(await control.read());
    expect(await readFile(path)).toEqual(await readFile(controlPath));
    await expect(readFile(sibling)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(controlPath + `.${slot}`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

it('does not decode a valid backup in place of malformed selected registry bytes', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const path = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), bytes = await readFile(path);
    await writeFile(path + '.backup', bytes, { flag: 'wx' });
    await writeFile(path, '{');
    await expect(discover(f)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('{');
    expect(await readFile(path + '.backup')).toEqual(bytes);
  });
});

it('keeps a valid bound two-slot import eligible after registry preflight', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const bytes = await readFile(f.journalPath);
    await writeFile(f.journalPath + '.backup', bytes, { flag: 'wx' });
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    expect(selected.target.workspaceId).toBe(f.binding.workspaceId);
    expect(selected.owners).toEqual(['workspaceImport']);
    expect(await readFile(f.journalPath)).toEqual(bytes);
    expect(await readFile(f.journalPath + '.backup')).toEqual(bytes);
    selected.revoke();
  });
});

it('rejects a changed registry identity between source and strict slot inspection', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const path = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), bytes = await readFile(path);
    const inspect = f.registry.inspectRecoverySelection.bind(f.registry);
    vi.spyOn(f.registry, 'inspectRecoverySelection').mockImplementationOnce(async authority => {
      const source = await inspect(authority);
      await rename(path, path + '.retained');
      await writeFile(path, bytes, { flag: 'wx' });
      return source;
    });
    await expect(inspectDesktopRecoveryRegistrySelection({ registry: f.registry, assertCurrent: f.assertCurrent }))
      .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(await readFile(path)).toEqual(bytes);
    expect(await readFile(path + '.retained')).toEqual(bytes);
  });
});

it.for(['inspectRecoverySelection', 'inspectSlots'] as const)(
  'preserves the exact authority failure inside real registry %s', async (method, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      let invalid = false;
      const first = new Error('SYNTHETIC_REGISTRY_AUTHORITY_ORIGINAL');
      if (method === 'inspectRecoverySelection') {
        const original = f.registry.inspectRecoverySelection.bind(f.registry);
        vi.spyOn(f.registry, 'inspectRecoverySelection').mockImplementationOnce(authority => {
          invalid = true;
          return original(authority);
        });
      } else {
        const original = f.registry.inspectSlots.bind(f.registry);
        vi.spyOn(f.registry, 'inspectSlots').mockImplementationOnce(authority => {
          invalid = true;
          return original(authority);
        });
      }
      await expect(inspectDesktopRecoveryRegistrySelection({ registry: f.registry, assertCurrent() {
        if (invalid) throw first;
        f.assertCurrent();
      } })).rejects.toBe(first);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toBeDefined();
    });
  },
);

it.for(['threeSlots', 'mixedOperations'] as const)('preserves normal unbound import selection for %s', async (kind, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    await rm(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath);
    const bytes = await readFile(f.journalPath);
    await writeFile(f.journalPath + '.backup', bytes);
    if (kind === 'threeSlots') await writeFile(f.journalPath + '.next', bytes);
    else await writeFile(f.journalPath, JSON.stringify({ ...JSON.parse(bytes.toString()), operationId: randomUUID() }) + '\n');
    const before = await readFile(f.journalPath);
    expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'unboundImport' });
    expect(await readFile(f.journalPath)).toEqual(before);
    expect(await readFile(f.journalPath + '.backup')).toEqual(bytes);
  });
});

it('keeps a bound legacy import on the normal recovery route without offering deletion', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
    const registryBytes = await readFile(registryPath);
    const current = JSON.parse((await readFile(f.journalPath)).toString()) as Record<string, unknown>;
    const legacyBytes = Buffer.from(JSON.stringify({ ...current, formatVersion: 1 }) + '\n');
    await writeFile(f.journalPath, legacyBytes);

    expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'legacyImport' });
    expect(await readFile(f.journalPath)).toEqual(legacyBytes);
    expect(await readFile(registryPath)).toEqual(registryBytes);
    await f.assertOwned();
  });
});

it('drains an old read even when authority is already lost before handoff begins', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    let active = true, release!: () => void, entered!: () => void;
    const firstFailure = new Error('SYNTHETIC_DISCOVERY_AUTHORITY_LOST');
    const selected = await discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo,
      authority: { assertCurrent() { f.assertCurrent(); if (!active) throw firstFailure; }, assertOwned: f.assertOwned } });
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.releaseOnClose(release);
    const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
    const events: string[] = [];
    vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementationOnce(async function(this: WorkspaceBackupImportJournalStore, ...args) {
      const result = await inspect.apply(this, args); entered(); await held;
      events.push('readSettled'); return result;
    });
    const reading = f.run(() => selected.assertSelected()); void reading.catch(() => undefined);
    await started; active = false;
    const handoff = f.run(() => selected.handoff(f).catch(cause => { events.push('handoffRejected'); throw cause; }));
    void handoff.catch(() => undefined);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual([]);
    release();
    await expect(reading).rejects.toBe(firstFailure);
    await expect(handoff).rejects.toBe(firstFailure);
    expect(events).toEqual(['readSettled', 'handoffRejected']);
  });
});

const normalSlotCases = [
  'current', 'backup', 'next', 'currentBackup', 'currentNext', 'backupNext', 'threeSlots',
  'tornSibling', 'oversizedSibling', 'mixedOperations', 'reversedTransition',
] as const;

it.for((['import', 'adoption'] as const).flatMap(owner => normalSlotCases.map(kind => ({ owner, kind }))))(
  'keeps normal $owner journal recovery byte-equivalent for $kind after observation', async ({ owner, kind }, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const directRoot = join(f.root, 'direct-normal-control');
      await mkdir(directRoot, { mode: 0o700 });
      await rm(f.journalPath);
      await rm(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath);
      const filePath = (root: string) => owner === 'import' ? join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)
        : createWorkspaceLegacyAdoptionJournalPaths(root).currentPath;
      const store = (root: string) => owner === 'import'
        ? new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath: filePath(root) })
        : new WorkspaceLegacyAdoptionJournalStore(root);
      const value = owner === 'import'
        ? { formatVersion: 2, operationId: f.binding.operationId, workspaceId: f.binding.workspaceId,
            workspaceLabel: 'Synthetic normal import', createdAt: time, previousActiveWorkspaceId: null,
            state: 'prepared', lineageIdentity: null }
        : { ...createAdoptionJournal('prepared'), workspaceId: f.binding.workspaceId };
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      const paths = ['', '.backup', '.next'] as const;
      const slots = kind === 'backup' ? ['.backup'] : kind === 'next' ? ['.next']
        : kind === 'currentBackup' ? ['', '.backup'] : kind === 'currentNext' ? ['', '.next']
          : kind === 'backupNext' ? ['.backup', '.next'] : kind === 'threeSlots' ? [...paths]
            : kind === 'current' ? [''] : ['', '.backup'];
      for (const root of [f.root, directRoot]) {
        await mkdir(dirname(filePath(root)), { recursive: true, mode: 0o700 });
        for (const suffix of slots) {
          let content = bytes;
          if (suffix === '.backup') {
            if (kind === 'tornSibling') content = Buffer.from('{');
            if (kind === 'oversizedSibling') content = Buffer.alloc(16 * 1024 + 1, 32);
            if (kind === 'mixedOperations') content = Buffer.from(JSON.stringify({ ...value,
              operationId: '22222222-2222-4222-8222-222222222222' }) + '\n');
            if (kind === 'reversedTransition') content = Buffer.from(JSON.stringify({ ...value,
              state: owner === 'import' ? 'candidateRootCreated' : 'candidatePrepared' }) + '\n');
          }
          await writeFile(filePath(root) + suffix, content, { flag: 'wx' });
        }
      }
      const snapshot = async (root: string) => Promise.all(paths.map(async suffix => {
        try { return await readFile(filePath(root) + suffix); }
        catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null; throw cause; }
      }));
      const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const before = await snapshot(f.root);
      if (kind === 'reversedTransition') {
        if (owner === 'import') {
          const valid = await new WorkspaceBackupImportJournalStore({ installationRoot: directRoot, filePath: filePath(directRoot) })
            .inspectSlots(f.assertCurrent);
          expect(valid.backup?.value.state).toBe('candidateRootCreated'); expect(valid.current?.value.state).toBe('prepared');
          expect(() => assertWorkspaceBackupImportJournalTransition(valid.backup!.value, valid.current!.value)).toThrow();
        } else {
          const valid = await new WorkspaceLegacyAdoptionJournalStore(directRoot).inspectSlots(f.assertCurrent);
          expect(valid.backup?.value.state).toBe('candidatePrepared'); expect(valid.current?.value.state).toBe('prepared');
          expect(() => assertWorkspaceLegacyAdoptionTransition(valid.backup!.value, valid.current!.value)).toThrow();
        }
      }
      const strict = owner === 'import' ? vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots')
        : vi.spyOn(WorkspaceLegacyAdoptionJournalStore.prototype, 'inspectSlots');
      expect(await discover(f)).toEqual({ mode: 'notOffered', reason: owner === 'import' ? 'unboundImport' : 'unboundAdoption' });
      expect(strict).not.toHaveBeenCalled();
      expect(await snapshot(f.root)).toEqual(before);
      const direct = await store(directRoot).read();
      const afterObservation = await store(f.root).read();
      expect(afterObservation).toEqual(direct);
      expect(await snapshot(f.root)).toEqual(await snapshot(directRoot));
      expect(await snapshot(f.root)).toEqual([bytes, null, null]);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
    });
  },
);

it.for(['import', 'adoption'] as const)('rejects a malformed selected %s journal instead of using a valid sibling', async (owner, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    await rm(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath);
    const path = owner === 'import' ? f.journalPath : createWorkspaceLegacyAdoptionJournalPaths(f.root).currentPath;
    if (owner === 'adoption') {
      await rm(f.journalPath);
      await new WorkspaceLegacyAdoptionJournalStore(f.root).write({ ...createAdoptionJournal('prepared'), workspaceId: f.binding.workspaceId });
    }
    const sibling = await readFile(path);
    await writeFile(path + '.backup', sibling, { flag: 'wx' }); await writeFile(path, '{');
    await expect(discover(f)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('{');
    expect(await readFile(path + '.backup')).toEqual(sibling);
  });
});

it.for(['current', 'backup', 'next', 'currentBackup', 'currentNext', 'backupNext', 'threeSlots', 'freshRejected'] as const)(
  'preserves actual legacy adoption recovery and its retained bytes for %s', async (shape, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      await rm(f.journalPath);
      await rm(createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding)).currentPath);
      const directRoot = join(f.root, 'direct-adoption-control'); await mkdir(directRoot, { mode: 0o700 });
      const target = validateWorkspaceId('33333333-3333-4333-8333-333333333333');
      const value = { ...createAdoptionJournal('recoveryRequired', shape === 'freshRejected' ? 'fresh' : 'legacy'), workspaceId: target };
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      const registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      await writeFile(join(directRoot, WORKSPACE_REGISTRY_FILE_NAME), registryBytes, { flag: 'wx' });
      const slots = shape === 'backup' ? ['.backup'] : shape === 'next' ? ['.next']
        : shape === 'currentBackup' ? ['', '.backup'] : shape === 'currentNext' ? ['', '.next']
          : shape === 'backupNext' ? ['.backup', '.next'] : shape === 'threeSlots' ? ['', '.backup', '.next'] : [''];
      const legacyBytes = Buffer.from('Synthetic legacy database bytes; never opened as SQLite');
      for (const root of [f.root, directRoot]) {
        const paths = createWorkspaceLegacyAdoptionJournalPaths(root);
        await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
        for (const suffix of slots) await writeFile(paths.currentPath + suffix, bytes, { flag: 'wx' });
        const profile = createDesktopProfilePaths(root);
        await mkdir(dirname(profile.databaseFilePath), { recursive: true, mode: 0o700 });
        await writeFile(profile.databaseFilePath, legacyBytes, { flag: 'wx' });
        await mkdir(deriveWorkspaceLegacyAdoptionPaths(root, value.operationId, target).operationRoot, { recursive: true, mode: 0o700 });
      }
      const path = createWorkspaceLegacyAdoptionJournalPaths(f.root).currentPath;
      const snapshot = async (root: string) => Promise.all(['', '.backup', '.next'].map(async suffix => {
        try { return await readFile(createWorkspaceLegacyAdoptionJournalPaths(root).currentPath + suffix); }
        catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null; throw cause; }
      }));
      const before = await snapshot(f.root);
      expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'unboundAdoption' });
      expect(await snapshot(f.root)).toEqual(before);
      const recover = (root: string) => recoverWorkspaceLegacyAdoption({ userDataRoot: root,
        journal: new WorkspaceLegacyAdoptionJournalStore(root),
        registry: new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) }),
        rootStore: new NodeWorkspaceLegacyAdoptionRootStore() });
      if (shape === 'freshRejected') {
        await expect(recover(directRoot)).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
        await expect(recover(f.root)).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
        expect(await readFile(path)).toEqual(bytes);
      } else {
        await expect(recover(directRoot)).resolves.toBe('relaunchRequired');
        await expect(recover(f.root)).resolves.toBe('relaunchRequired');
        expect(await snapshot(f.root)).toEqual([null, null, null]);
        await expect(readdir(deriveWorkspaceLegacyAdoptionPaths(f.root, value.operationId, target).operationRoot))
          .rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(await snapshot(f.root)).toEqual(await snapshot(directRoot));
      for (const root of [f.root, directRoot]) {
        expect(await readFile(createDesktopProfilePaths(root).databaseFilePath)).toEqual(legacyBytes);
        expect(await readFile(join(root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBytes);
      }
    });
  },
);

it.for(['next', 'backup'] as const)('does not mistake a partial %s binding for normal-owner absence', async (slot, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding));
    await rename(paths.currentPath, paths[`${slot}Path`]);
    const retained = await readFile(paths[`${slot}Path`]);
    await expect(discover(f)).rejects.toThrow();
    expect(await readFile(paths[`${slot}Path`])).toEqual(retained);
  });
});

it.for(['sharedActivation', 'localRestore'] as const)(
  'keeps %s normal source recovery distinct from local management eligibility', async (kind, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      let path = f.blockedJournals.unprovedTargetRestore.currentPath;
      const bytes = await readFile(path);
      if (kind === 'sharedActivation') {
        await rm(path);
        path = deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath;
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { flag: 'wx' });
      }
      const sibling = Buffer.from('{synthetic discarded sibling');
      await writeFile(path + '.backup', sibling, { flag: 'wx' });
      const store = new ProfileRestoreActivationJournalStore(path);
      const normal = await store.peek();
      expect(normal).toEqual(JSON.parse(bytes.toString()));
      if (kind === 'sharedActivation') expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'unboundActivation' });
      else await expect(discover(f)).rejects.toThrow();
      expect(await readFile(path)).toEqual(bytes);
      expect(await readFile(path + '.backup')).toEqual(sibling);
      // The unchanged normal owner, not failed discovery, owns sibling recovery.
      expect(await store.read()).toEqual(normal);
      expect(await readFile(path)).toEqual(bytes);
      await expect(readFile(path + '.backup')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  },
);

it.for(normalSlotCases)('keeps shared unbound activation source and final bytes equivalent for %s', async (kind, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const localPath = f.blockedJournals.unprovedTargetRestore.currentPath;
    const initial = await readFile(localPath); await rm(localPath);
    const paths = deriveWorkspaceBackupReplacementOperationsPaths(f.root);
    const path = paths.activationJournalPath;
    const directPath = join(f.root, 'direct-activation-control', path.split(/[\\/]/).at(-1)!);
    const suffixes = kind === 'backup' ? ['.backup'] : kind === 'next' ? ['.next']
      : kind === 'currentBackup' || kind === 'reversedTransition' ? ['', '.backup']
        : kind === 'currentNext' ? ['', '.next'] : kind === 'backupNext' ? ['.backup', '.next']
          : kind === 'threeSlots' ? ['', '.backup', '.next'] : kind === 'current' ? [''] : ['', '.backup'];
    for (const filePath of [path, directPath]) {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      for (const suffix of suffixes) {
        const bytes = suffix !== '.backup' ? initial : kind === 'tornSibling' ? Buffer.from('{')
          : kind === 'oversizedSibling' ? Buffer.alloc(1024 * 1024, 32) : kind === 'mixedOperations'
            ? Buffer.from(JSON.stringify({ ...JSON.parse(initial.toString()), operationId: '33333333-3333-4333-8333-333333333333' }))
            : kind === 'reversedTransition' ? Buffer.from(JSON.stringify({ ...JSON.parse(initial.toString()),
              phase: 'movingCurrentDatabase', revision: 1 })) : initial;
        await writeFile(filePath + suffix, bytes, { flag: 'wx' });
      }
    }
    const snapshot = (filePath: string) => Promise.all(['', '.backup', '.next'].map(async suffix => {
      try { return await readFile(filePath + suffix); }
      catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null; throw cause; }
    }));
    const before = await snapshot(path);
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    if (kind === 'reversedTransition') {
      const valid = await new ProfileRestoreActivationJournalStore(directPath).inspectDeletionSlots(f.assertCurrent);
      expect(valid.backup?.value.phase).toBe('movingCurrentDatabase'); expect(valid.current?.value.phase).toBe('prepared');
      expect(() => assertProfileRestoreActivationJournalStep(valid.backup!.value, valid.current!.value)).toThrow();
    }
    const strict = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectDeletionSlots');
    expect(await discover(f)).toEqual({ mode: 'notOffered', reason: 'unboundActivation' });
    expect(strict).not.toHaveBeenCalled();
    expect(await snapshot(path)).toEqual(before);
    const observed = new ProfileRestoreActivationJournalStore(path), direct = new ProfileRestoreActivationJournalStore(directPath);
    expect(await observed.peek()).toEqual(await direct.peek());
    expect(await observed.read()).toEqual(await direct.read());
    expect(await snapshot(path)).toEqual(await snapshot(directPath));
    expect(await snapshot(path)).toEqual([initial, null, null]);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
  });
});

it.for((['workspaceReplacement', 'workspaceActivationMigration'] as const)
  .flatMap(owner => (['next', 'backup'] as const).map(slot => ({ owner, slot }))))(
  'refuses a partial $slot binding for shared $owner instead of guessing normal recovery', async ({ owner, slot }, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const binding = captureWorkspaceRemnantBinding({ ...f.binding, owner });
      const bindingPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
        { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
      const path = deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath;
      await new ProfileRestoreActivationJournalStore(path).write({ formatVersion: 1, operationId: binding.operationId,
        phase: 'prepared', revision: 0, hadActiveDatabase: true, hadActiveDocuments: true });
      await rename(bindingPaths.currentPath, bindingPaths[`${slot}Path`]);
      const bytes = await readFile(bindingPaths[`${slot}Path`]), journal = await readFile(path);
      await expect(discover(f)).rejects.toThrow();
      expect(await readFile(bindingPaths[`${slot}Path`])).toEqual(bytes);
      expect(await readFile(path)).toEqual(journal);
    });
  },
);

it.for((['workspaceReplacement', 'workspaceActivationMigration'] as const)
  .flatMap(owner => (['bytes', 'identity', 'sideAppears'] as const).map(change => ({ owner, change }))))(
  'rejects shared $owner $change drift between source observation and strict selection', async ({ owner, change }, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const binding = captureWorkspaceRemnantBinding({ ...f.binding, owner });
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
        { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
      const path = deriveWorkspaceBackupReplacementOperationsPaths(f.root).activationJournalPath;
      const journal = { formatVersion: 1 as const, operationId: binding.operationId,
        phase: 'prepared' as const, revision: 0, hadActiveDatabase: true, hadActiveDocuments: true };
      await new ProfileRestoreActivationJournalStore(path).write(journal);
      const source = await readFile(path);
      const advanced = Buffer.from(JSON.stringify({ ...journal, phase: 'movingCurrentDatabase', revision: 1 }) + '\n');
      const bindingPath = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath;
      const bindingBytes = await readFile(bindingPath);
      const registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const inspect = ProfileRestoreActivationJournalStore.prototype.inspectRecoverySelection;
      let changed = false;
      vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectRecoverySelection').mockImplementationOnce(
        async function(this: ProfileRestoreActivationJournalStore, ...args) {
          const selected = await inspect.apply(this, args);
          expect(selected.value?.operationId).toBe(binding.operationId);
          if (change === 'identity') { await rename(path, path + '.retained'); await writeFile(path, source, { flag: 'wx' }); }
          else await writeFile(path + (change === 'sideAppears' ? '.next' : ''), advanced);
          changed = true; return selected;
        });
      await expect(discover(f)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(changed).toBe(true);
      if (change === 'identity') {
        expect(await readFile(path)).toEqual(source); expect(await readFile(path + '.retained')).toEqual(source);
      } else {
        expect(await readFile(path + (change === 'sideAppears' ? '.next' : ''))).toEqual(advanced);
        if (change === 'sideAppears') expect(await readFile(path)).toEqual(source);
      }
      expect(await readFile(bindingPath)).toEqual(bindingBytes);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBytes);
    });
  },
);

it.for(['next', 'identity', 'binding', 'authority'] as const)(
  'never publishes a normal-owner route after %s changes during observation', async (change, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const bindingPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(f.binding));
      await rm(bindingPaths.currentPath);
      let active = true, reads = 0;
      const original = WorkspaceBackupImportJournalStore.prototype.inspectRecoverySelection;
      vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectRecoverySelection').mockImplementation(async function(this: WorkspaceBackupImportJournalStore, ...args) {
        const selected = await original.apply(this, args);
        if (++reads === 1) {
          const bytes = await readFile(f.journalPath);
          if (change === 'next') await writeFile(f.journalPath + '.next', bytes, { flag: 'wx' });
          if (change === 'identity') { await rename(f.journalPath, f.journalPath + '.retained'); await writeFile(f.journalPath, bytes, { flag: 'wx' }); }
          if (change === 'authority') active = false;
        }
        return selected;
      });
      if (change === 'binding') {
        const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
        vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect').mockImplementationOnce(async function(this: WorkspaceRemnantBindingStore, ...args) {
          const absent = await inspect.apply(this, args);
          expect(absent.mode).toBe('absent');
          await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(f.binding)).publish(f.binding,
            { assertAuthority: f.assertCurrent, assertExternalSelection: f.assertOwned });
          return absent;
        });
      }
      await expect(discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo, authority: {
        assertCurrent() { f.assertCurrent(); if (!active) throw new Error('SYNTHETIC_NORMAL_ROUTE_CLOSED'); }, assertOwned: f.assertOwned,
      } })).rejects.toThrow();
      expect(await readFile(f.journalPath)).toBeDefined();
    });
  },
);

it.for(normalSlotCases)('keeps local payload source trial byte-equivalent to normal recovery for %s', async (kind, context) => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath;
    const initial = await readFile(path); await rm(path);
    const directPath = join(f.root, 'direct-local-source-control', path.split(/[\\/]/).at(-1)!);
    const suffixes = kind === 'backup' ? ['.backup'] : kind === 'next' ? ['.next']
      : kind === 'currentBackup' || kind === 'reversedTransition' ? ['', '.backup']
        : kind === 'currentNext' ? ['', '.next'] : kind === 'backupNext' ? ['.backup', '.next']
          : kind === 'threeSlots' ? ['', '.backup', '.next'] : kind === 'current' ? [''] : ['', '.backup'];
    for (const filePath of [path, directPath]) {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      for (const suffix of suffixes) {
        const bytes = suffix !== '.backup' ? initial : kind === 'tornSibling' ? Buffer.from('{')
          : kind === 'oversizedSibling' ? Buffer.alloc(1024 * 1024, 32) : kind === 'mixedOperations'
            ? Buffer.from(JSON.stringify({ ...JSON.parse(initial.toString()), operationId: '33333333-3333-4333-8333-333333333333' }))
            : kind === 'reversedTransition' ? Buffer.from(JSON.stringify({ ...JSON.parse(initial.toString()),
              phase: 'movingCurrentDatabase', revision: 1 })) : initial;
        await writeFile(filePath + suffix, bytes, { flag: 'wx' });
      }
    }
    const snapshot = (filePath: string) => Promise.all(['', '.backup', '.next'].map(async suffix => {
      try { return await readFile(filePath + suffix); }
      catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null; throw cause; }
    }));
    const before = await snapshot(path), registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
    const observed = new ProfileRestoreActivationJournalStore(path), direct = new ProfileRestoreActivationJournalStore(directPath);
    const strict = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectDeletionSlots');
    const selected = await discoverLocalSourceTrial(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    expect(selected.target.workspaceId).toBe(f.binding.workspaceId);
    expect(selected.owners).toEqual(['localRestore']);
    // Only the absent legacy journal uses strict slots; local payload does not.
    expect(strict).toHaveBeenCalledTimes(2);
    await selected.assertSelected();
    expect(await snapshot(path)).toEqual(before);
    expect(Object.keys(selected).sort()).toEqual(['assertCurrent', 'assertSelected', 'handoff', 'mode', 'owners', 'persistedActiveWorkspaceId', 'readSelected', 'revoke', 'target']);
    selected.revoke();
    await expect(selected.assertSelected()).rejects.toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
    expect(await observed.peek()).toEqual(await direct.peek());
    expect(await observed.read()).toEqual(await direct.read());
    expect(await snapshot(path)).toEqual(await snapshot(directPath));
    expect(await snapshot(path)).toEqual([initial, null, null]);
    expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
  });
});

it.for(['empty', 'malformed', 'oversized', 'bom', 'unknownField'] as const)(
  'does not turn invalid local source %s into a normal route or a management offer', async (kind, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const path = f.blockedJournals.unprovedTargetRestore.currentPath, valid = await readFile(path);
      const invalid = kind === 'empty' ? Buffer.alloc(0) : kind === 'malformed' ? Buffer.from('{')
        : kind === 'oversized' ? Buffer.alloc(1024 * 1024, 32) : kind === 'bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid])
          : Buffer.from(JSON.stringify({ ...JSON.parse(valid.toString()), syntheticExtra: true }));
      await writeFile(path, invalid); await writeFile(path + '.backup', valid, { flag: 'wx' });
      const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      await expect(discoverLocalSourceTrial(f)).rejects.toThrow();
      await expect(new ProfileRestoreActivationJournalStore(path).peek()).rejects.toThrow('PROFILE_RESTORE_JOURNAL_INVALID');
      expect(await readFile(path)).toEqual(invalid); expect(await readFile(path + '.backup')).toEqual(valid);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
    });
  },
);

it.for(['bytes', 'identity', 'sibling', 'registry', 'foreignRestore'] as const)(
  'expires the local payload trial permanently after %s changes and retains all changed bytes', async (change, context) => {
    const f = await fixture(context, 'prepared');
    await f.run(async () => {
      const path = f.blockedJournals.unprovedTargetRestore.currentPath, source = await readFile(path);
      const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), registry = await readFile(registryPath);
      const inspect = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectRecoverySelection');
      const selected = await discoverLocalSourceTrial(f);
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      let changedPath = path;
      const advanced = Buffer.from(JSON.stringify({ ...JSON.parse(source.toString()), phase: 'movingCurrentDatabase', revision: 1 }) + '\n');
      if (change === 'identity') { await rename(path, path + '.retained'); await writeFile(path, source, { flag: 'wx' }); }
      else if (change === 'registry') {
        changedPath = registryPath;
        const current = (await f.registry.inspect())!;
        await f.registry.write({ ...current, activeWorkspaceId: null });
      } else {
        if (change === 'sibling') changedPath += '.next';
        if (change === 'foreignRestore') {
          changedPath = f.blockedJournals.foreignRestore.currentPath;
          await mkdir(dirname(changedPath), { recursive: true, mode: 0o700 });
        }
        await writeFile(changedPath, advanced);
      }
      const changedBytes = await readFile(changedPath);
      const first = await selected.assertSelected().then(() => undefined, cause => cause as unknown);
      expect(first).toBeInstanceOf(Error);
      expect(first).toMatchObject({ message: 'SYNTHETIC_RECOVERY_DISCOVERY_CHANGED' });
      const readsAfterFailure = inspect.mock.calls.length;
      expect(await readFile(changedPath)).toEqual(changedBytes);
      if (change !== 'bytes') expect(await readFile(path)).toEqual(source);
      if (change === 'identity') expect(await readFile(path + '.retained')).toEqual(source);
      if (change !== 'registry') expect(await readFile(registryPath)).toEqual(registry);
      // Even another readable source must not trigger new I/O or replace the first error.
      await writeFile(changedPath, change === 'registry' ? registry : source);
      await expect(selected.assertSelected()).rejects.toBe(first);
      expect(inspect).toHaveBeenCalledTimes(readsAfterFailure);
      expect(await readFile(changedPath)).toEqual(change === 'registry' ? registry : source);
      selected.revoke();
    });
  },
);

it('drains the local payload source trial before rejecting lost authority', async context => {
  const f = await fixture(context, 'prepared');
  await f.run(async () => {
    const path = f.blockedJournals.unprovedTargetRestore.currentPath, bytes = await readFile(path);
    const operationId = captureProfileRestoreActivationJournal(JSON.parse(bytes.toString())).operationId;
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME), registry = await readFile(registryPath);
    let active = true, release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.releaseOnClose(release);
    const events: string[] = [], first = new Error('SYNTHETIC_LOCAL_SOURCE_CLOSED');
    const inspect = ProfileRestoreActivationJournalStore.prototype.inspectRecoverySelection;
    vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'inspectRecoverySelection').mockImplementation(async function(this: ProfileRestoreActivationJournalStore, ...args) {
      const selected = await inspect.apply(this, args);
      if (selected.value?.operationId === operationId) { entered(); await held; events.push('readSettled'); }
      return selected;
    });
    const pending = f.run(() => discoverRecoveryTargetExperiment({ root: f.root, buildInfo, releaseInfo,
      localRestoreSelection: 'normalSourceTrial', authority: {
        assertCurrent() { f.assertCurrent(); if (!active) throw first; }, assertOwned: f.assertOwned,
      } }).then(() => { throw new Error('SYNTHETIC_UNEXPECTED_OFFER'); }, cause => { events.push('rejected'); throw cause; }));
    void pending.catch(() => undefined);
    await started; active = false;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual([]); release();
    await expect(pending).rejects.toBe(first);
    expect(events).toEqual(['readSettled', 'rejected']);
    expect(await readFile(path)).toEqual(bytes); expect(await readFile(registryPath)).toEqual(registry);
  });
});

it('exposes only a synchronous receipt lifetime and revokes the old lifetime on handoff', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const inspect = vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots');
    const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
    expect(selected.assertCurrent()).toBeUndefined(); expect(inspect).not.toHaveBeenCalled();
    const transferred = await selected.handoff(f);
    try {
      inspect.mockClear();
      expect(selected.assertCurrent).toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
      expect(transferred.assertCurrent()).toBeUndefined(); expect(inspect).not.toHaveBeenCalled();
      expect(Object.keys(transferred)).not.toContain('delete');
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
    } finally { transferred.revoke(); }
    expect(transferred.assertCurrent).toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
  });
});

it('isolates a request-local discovery read failure from the main selection lifetime', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    try {
      const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
      const first = new Error('SYNTHETIC_REQUEST_LOCAL_READ');
      vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockRejectedValueOnce(first);
      await expect(selected.readSelected(f)).rejects.toBe(first);
      await selected.assertSelected();
      await selected.readSelected(f);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
      expect(await readFile(f.journalPath)).toEqual(journal);
    } finally { selected.revoke(); }
  });
});

it('expires a status-phase read without changing the actual service command or main selection', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const held = holdDiscoveryRead(f), maintenance = new InMemoryWorkspaceMaintenanceLease();
    let enterAdmission!: () => void, releaseAdmission!: () => void;
    const admitted = new Promise<void>(resolve => { enterAdmission = resolve; });
    const pendingAdmission = new Promise<void>(resolve => { releaseAdmission = resolve; });
    f.releaseOnClose(() => { enterAdmission(); releaseAdmission(); });
    const blocked = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'create');
    const unexpected = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_COMMAND'); });
    const service = new WorkspaceManagementService({
      createEmpty: { create: unexpected }, importBackup: { import: unexpected },
      switchWorkspace: { switchTo: unexpected }, renameWorkspace: { rename: unexpected },
      registry: { read: unexpected }, maintenanceState: maintenance,
      operationGuard: { async assertNoUnresolvedOperations() { enterAdmission(); await pendingAdmission; throw blocked; },
        async readRecoveryState() { return 'recoveryRequired'; } },
    });
    const phase = service.captureStatusReadContext();
    const reading = selected.readSelected({ assertCurrent: phase.assertCurrent, assertOwned: f.assertOwned });
    void reading.catch(() => undefined);
    let command: Promise<unknown> | undefined, commandSettled = false;
    try {
      await held.entered; context.signal.throwIfAborted();
      command = service.createEmpty('Synthetic phase control').finally(() => { commandSettled = true; });
      void command.catch(() => undefined);
      await admitted; context.signal.throwIfAborted();
      expect(service.captureStatusReadContext().operationState).toBe('busy');
      held.release();
      await expect(reading).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      expect(commandSettled).toBe(false);
      releaseAdmission();
      await expect(command).rejects.toBe(blocked);
      expect(unexpected).not.toHaveBeenCalled();
      expect(() => phase.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await selected.assertSelected();
      const fresh = service.captureStatusReadContext();
      await selected.readSelected({ assertCurrent: fresh.assertCurrent, assertOwned: f.assertOwned });
    } finally {
      held.release(); releaseAdmission();
      await Promise.allSettled([reading, command]);
      selected.revoke(); await service.shutdown();
    }
  });
});

it.for(['current', 'expired'] as const)('drains a %s request-local discovery read before handing off the main selection', async (state, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const held = holdDiscoveryRead(f), first = new Error('SYNTHETIC_STATUS_REQUEST_EXPIRED');
    let current = true;
    const reading = selected.readSelected({ assertCurrent() { if (!current) throw first; }, assertOwned: f.assertOwned });
    void reading.catch(() => undefined);
    let transferring: ReturnType<typeof selected.handoff> | undefined;
    let service: Awaited<ReturnType<typeof selected.handoff>> | undefined, completed = false;
    try {
      await held.entered; context.signal.throwIfAborted();
      if (state === 'expired') current = false;
      transferring = selected.handoff(f).then(value => { completed = true; service = value; return value; });
      void transferring.catch(() => undefined);
      const readsBeforeLateRequest = vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots).mock.calls.length;
      await expect(selected.readSelected(f)).rejects.toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
      expect(vi.mocked(WorkspaceBackupImportJournalStore.prototype.inspectSlots)).toHaveBeenCalledTimes(readsBeforeLateRequest);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(completed).toBe(false); expect(held.events).toEqual([]);
      held.release();
      if (state === 'expired') await expect(reading).rejects.toBe(first);
      else await expect(reading).resolves.toBeUndefined();
      await transferring;
      expect(completed).toBe(true); expect(held.events).toEqual(['readSettled']);
      await service!.readSelected(f); await service!.assertSelected();
      await expect(selected.readSelected(f)).rejects.toThrow('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
    } finally {
      held.release(); await Promise.allSettled([reading, transferring]);
      service?.revoke(); selected.revoke();
    }
  });
});

it('does not hide genuine main reservation loss behind request-local read isolation', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const held = holdDiscoveryRead(f), reading = selected.readSelected(f);
    void reading.catch(() => undefined);
    try {
      await held.entered; context.signal.throwIfAborted();
      f.bind(); held.release();
      const first = await reading.then(() => undefined, cause => cause as unknown);
      expect(first).toBeInstanceOf(Error);
      await f.reclaim();
      await expect(selected.readSelected(f)).rejects.toBe(first);
      await expect(selected.assertSelected()).rejects.toBe(first);
      const fresh = await discover(f);
      expect(fresh.mode).toBe('offered'); if (fresh.mode === 'offered') fresh.revoke();
    } finally { held.release(); await Promise.allSettled([reading]); selected.revoke(); }
  });
});

it.for(['resolved', 'rejected'] as const)('rejects a %s asynchronous read assertion without poisoning main selection', async (state, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discover(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const owned = vi.fn(f.assertOwned);
    try {
      await expect(selected.readSelected({ async assertCurrent() {
        if (state === 'rejected') throw new Error('SYNTHETIC_ASYNC_READ_ASSERTION');
      }, assertOwned: owned })).rejects.toThrow();
      expect(owned).not.toHaveBeenCalled();
      await selected.assertSelected(); await selected.readSelected(f);
    } finally { selected.revoke(); }
  });
});

it.for(['target', 'other', 'none'] as const)('recovery status projection preserves the %s pointer without a repairing status read', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const registry = (await f.registry.inspect())!;
    const persisted = active === 'target' ? f.binding.workspaceId : active === 'other' ? otherWorkspaceId : null;
    await f.registry.write({ ...registry, activeWorkspaceId: persisted });
    const beforeRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), beforeJournal = await readFile(f.journalPath);
    const selected = await discoverStatus(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const control = statusProjectionFixture(f), ordinary = vi.spyOn(control.service, 'getStatus');
    try {
      const result = await control.read(selected);
      expect(result.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: persisted,
        target: { workspaceId: selected.target.workspaceId, workspaceLabel: selected.target.workspaceLabel } });
      result.assertCurrent();
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(JSON.stringify(result.value)).not.toContain(f.root);
      expect(JSON.stringify(result.value)).not.toContain('lineageIdentity');
      expect(JSON.stringify(result.value)).not.toContain(f.binding.operationId);
      expect(ordinary).not.toHaveBeenCalled(); expect(control.unexpected).not.toHaveBeenCalled();
      expect(control.runtimeAbsence.assertOwned).toHaveBeenCalledTimes(2);
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(beforeRegistry);
      expect(await readFile(f.journalPath)).toEqual(beforeJournal);
    } finally { await control.close(); selected.revoke(); }
  });
});

it.for(['serviceCommand', 'maintenance'] as const)('recovery status projection hides target during %s without rereading journals', async (kind, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discoverStatus(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const control = statusProjectionFixture(f), inspect = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots');
    try {
      if (kind === 'serviceCommand') { control.startCommand(); await control.commandEntered; context.signal.throwIfAborted(); }
      else await control.acquire();
      const changed = Buffer.from('SYNTHETIC_JOURNAL_CHANGED_DURING_COMMAND');
      await writeFile(f.journalPath, changed);
      const result = await control.read(selected);
      expect(result.value).toEqual({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: kind === 'maintenance' ? 'busy' : 'idle', operationState: 'busy' });
      expect(Object.hasOwn(result.value, 'target')).toBe(false);
      expect(Object.hasOwn(result.value, 'persistedActiveWorkspaceId')).toBe(false);
      result.assertCurrent();
      expect(inspect).not.toHaveBeenCalled(); expect(control.unexpected).not.toHaveBeenCalled();
      expect(await readFile(f.journalPath)).toEqual(changed);
    } finally { await control.close(); selected.revoke(); }
  });
});

it.for(['serviceCommand', 'leaseABA', 'runtimeAppears', 'selectionDrift'] as const)(
  'recovery status projection rejects %s during its idle read without a fallback value', async (change, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selected = await discoverStatus(f);
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const control = statusProjectionFixture(f), held = holdDiscoveryRead(f, change === 'selectionDrift' ? 'before' : 'after');
      const registry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME)), journal = await readFile(f.journalPath);
      const reading = control.read(selected);
      try {
        await held.entered; context.signal.throwIfAborted();
        if (change === 'serviceCommand') { control.startCommand(); await control.commandEntered; }
        if (change === 'leaseABA') { const handle = await control.acquire(); await handle.release(); }
        if (change === 'runtimeAppears') control.setAbsent(false);
        if (change === 'selectionDrift') await writeFile(f.journalPath, '{SYNTHETIC_CHANGED_JOURNAL');
        held.release();
        await expect(reading).rejects.toBeInstanceOf(Error);
        expect(held.events).toEqual(['readSettled']);
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registry);
        if (change === 'selectionDrift') {
          expect(await readFile(f.journalPath)).toEqual(Buffer.from('{SYNTHETIC_CHANGED_JOURNAL'));
          await expect(selected.assertSelected()).rejects.toThrow();
        } else {
          expect(await readFile(f.journalPath)).toEqual(journal);
          await selected.assertSelected();
        }
        if (change === 'runtimeAppears') {
          await f.assertOwned();
          await expect(control.read(selected)).rejects.toBe(control.absenceLost);
        }
        expect(control.unexpected).not.toHaveBeenCalled();
      } finally { held.release(); await control.close(); selected.revoke(); }
    });
  },
);

it.for(['serviceCommand', 'leaseABA', 'runtimeAppears', 'ownerClosed'] as const)(
  'recovery status projection keeps a private final publication guard after %s', async (change, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const selected = await discoverStatus(f);
      if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
      const control = statusProjectionFixture(f);
      try {
        const result = await control.read(selected), original = structuredClone(result.value);
        result.assertCurrent();
        if (change === 'serviceCommand') { control.startCommand(); await control.commandEntered; }
        if (change === 'leaseABA') { const handle = await control.acquire(); await handle.release(); }
        if (change === 'runtimeAppears') control.setAbsent(false);
        if (change === 'ownerClosed') selected.revoke();
        let first: unknown;
        try { result.assertCurrent(); } catch (cause) { first = cause; }
        expect(first).toBeInstanceOf(Error);
        if (change === 'runtimeAppears') control.setAbsent(true);
        let repeated: unknown;
        try { result.assertCurrent(); } catch (cause) { repeated = cause; }
        expect(repeated).toBe(first);
        expect(result.value).toEqual(original);
        expect(control.unexpected).not.toHaveBeenCalled();
      } finally { await control.close(); selected.revoke(); }
    });
  },
);

it('recovery status projection drains its runtime proof before handoff and expires the old publication', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discoverStatus(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const control = statusProjectionFixture(f);
    let enter!: () => void, release!: () => void, transferred = false;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    f.releaseOnClose(() => { enter(); release(); });
    const probe = control.runtimeAbsence.assertOwned;
    control.runtimeAbsence.assertOwned.mockImplementationOnce(async () => { enter(); await held; control.runtimeAbsence.assertCurrent(); });
    const reading = control.read(selected);
    let transferring: ReturnType<typeof selected.handoff> | undefined;
    let service: Awaited<ReturnType<typeof selected.handoff>> | undefined;
    try {
      await entered; context.signal.throwIfAborted();
      transferring = selected.handoff(f).then(value => { transferred = true; service = value; return value; });
      void transferring.catch(() => undefined);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(transferred).toBe(false);
      await expect(control.read(selected)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(probe).toHaveBeenCalledTimes(1);
      release();
      const response = await reading;
      await transferring;
      expect(transferred).toBe(true);
      expect(() => response.assertCurrent()).toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      const fresh = await control.read(service!); fresh.assertCurrent();
      expect(fresh.value).toEqual(response.value);
      expect(control.unexpected).not.toHaveBeenCalled();
    } finally {
      release(); await Promise.allSettled([reading, transferring]);
      await control.close(); service?.revoke(); selected.revoke();
    }
  });
});

it('recovery status projection does not substitute for a fresh action check after a later file change', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discoverStatus(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const control = statusProjectionFixture(f);
    try {
      const response = await control.read(selected), original = structuredClone(response.value);
      const inspect = vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots');
      const changed = Buffer.from('SYNTHETIC_CHANGE_AFTER_COMPLETED_STATUS');
      await writeFile(f.journalPath, changed);
      response.assertCurrent();
      expect(inspect).not.toHaveBeenCalled();
      expect(response.value).toEqual(original);
      await expect(selected.assertSelected()).rejects.toThrow();
      expect(await readFile(f.journalPath)).toEqual(changed);
      expect(() => response.assertCurrent()).toThrow();
      expect(control.unexpected).not.toHaveBeenCalled();
    } finally { await control.close(); selected.revoke(); }
  });
});

it('recovery status projection rejects a false absence result instead of publishing absent', async context => {
  const f = await fixture(context);
  await f.run(async () => {
    const selected = await discoverStatus(f);
    if (selected.mode !== 'offered') throw new Error('SYNTHETIC_DISCOVERY_NOT_OFFERED');
    const control = statusProjectionFixture(f);
    try {
      control.runtimeAbsence.assertOwned.mockResolvedValueOnce(false as never);
      await expect(control.read(selected)).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await selected.assertSelected();
      const fresh = await control.read(selected); fresh.assertCurrent();
      expect(fresh.value.runtimeState).toBe('absent');
      expect(control.unexpected).not.toHaveBeenCalled();
    } finally { await control.close(); selected.revoke(); }
  });
});

it.for(['target', 'other', 'none'] as const)('trial preserves persisted %s through native-owned recovery preparation', async (active, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    const initial = await f.registry.inspect();
    if (initial === undefined) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
    const persisted = active === 'target' ? f.binding.workspaceId : active === 'other' ? otherWorkspaceId : null;
    await f.registry.write({ ...initial, activeWorkspaceId: persisted });
    await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
    const before = await readFile(registryPath), journalBefore = await readFile(f.journalPath);
    await withNativeRecoveryStatus(f, async ({ main }) => {
      const maintenance = new InMemoryWorkspaceMaintenanceLease(), lease = await maintenance.acquire('delete');
      const assertLease = maintenance.captureCurrentOwner(['delete'], lease);
      const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_NO_RUNNING_RECOVERY_BACKEND'); });
      const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ kind: 'recoveryManagement',
        assertSelectorCurrent: main.assertCurrent, persistedActiveWorkspaceId: main.persistedActiveWorkspaceId,
        reservation: { assertMainCurrent: f.assertCurrent, assertMainOwned: f.assertOwned },
        assertDeleteLease: assertLease, assertRuntimeCurrent: f.assertCurrent, assertRuntimeAbsent: f.assertOwned,
        assertMainOwnedAndRuntimeAbsent: f.assertOwned });
      const publish = vi.fn(async (authority: () => void, current: () => Promise<void>, target: { previousActiveWorkspaceId: unknown }) => {
        authority(); await current(); authority(); expect(target.previousActiveWorkspaceId).toBe(persisted);
      });
      try {
        expect(await prepareWorkspaceDeletion({ operationId: randomUUID(), runtimeGeneration: randomUUID(),
          request: { formatVersion: 1, workspaceId: main.target.workspaceId,
            typedLabel: main.target.workspaceLabel, backupChoice: 'explicitDataLoss' },
          installationRoot: f.root, registry: f.registry,
          runtime: { kind: 'recoveryManagement', workspaceId: main.target.workspaceId,
            persistedActiveWorkspaceId: main.persistedActiveWorkspaceId, lifecycle,
            assertCurrent: main.assertCurrent, assertSelected: main.assertSelected },
          lifetime: { assertCurrent: main.assertCurrent, closeAdmissionForOwnStop() {} },
          assertLease, assertMainReservation: f.assertOwned, assertMainReservationCurrent: f.assertCurrent,
          closeServiceAdmission() {}, async confirmDataLoss() { return true; }, async confirmDeletion() { return true; },
          confirmReturn: unexpected, setReturnGuard: unexpected, publish,
        })).toBe('prepared');
        expect(publish).toHaveBeenCalledOnce(); expect(lifecycle.readState()).toBe('stopped');
        expect(unexpected).not.toHaveBeenCalled(); await main.assertSelected();
        expect(await readFile(registryPath)).toEqual(before);
        expect(await readFile(f.journalPath)).toEqual(journalBefore);
      } finally { await lease.release(); }
      expect(maintenance.readState()).toBe('idle');
    });
  });
});

it.for(['replaceLease', 'candidate', 'closeMain', 'source'] as const)('trial rejects %s before native-owned recovery preparation publication', async (changed, context) => {
  const f = await fixture(context);
  await f.run(async () => {
    await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
    const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
    const before = await readFile(registryPath), journalBefore = await readFile(f.journalPath);
    await withNativeRecoveryStatus(f, async ({ main }) => {
      const maintenance = new InMemoryWorkspaceMaintenanceLease(), lease = await maintenance.acquire('delete');
      let replacement: Awaited<ReturnType<typeof maintenance.acquire>> | undefined;
      const assertLease = maintenance.captureCurrentOwner(['delete'], lease);
      const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_RECOVERY_SHOULD_NOT_PUBLISH'); });
      const lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ kind: 'recoveryManagement',
        assertSelectorCurrent: main.assertCurrent, persistedActiveWorkspaceId: main.persistedActiveWorkspaceId,
        reservation: { assertMainCurrent: f.assertCurrent, assertMainOwned: f.assertOwned },
        assertDeleteLease: assertLease, assertRuntimeCurrent: f.assertCurrent, assertRuntimeAbsent: f.assertOwned,
        assertMainOwnedAndRuntimeAbsent: f.assertOwned });
      try {
        const work = prepareWorkspaceDeletion({ operationId: randomUUID(), runtimeGeneration: randomUUID(),
          request: { formatVersion: 1, workspaceId: main.target.workspaceId,
            typedLabel: main.target.workspaceLabel, backupChoice: 'explicitDataLoss' },
          installationRoot: f.root, registry: f.registry,
          runtime: { kind: 'recoveryManagement', workspaceId: main.target.workspaceId,
            persistedActiveWorkspaceId: main.persistedActiveWorkspaceId, lifecycle,
            assertCurrent: main.assertCurrent, assertSelected: main.assertSelected },
          lifetime: { assertCurrent: main.assertCurrent, closeAdmissionForOwnStop() {} },
          assertLease, assertMainReservation: f.assertOwned, assertMainReservationCurrent: f.assertCurrent,
          closeServiceAdmission() {}, async confirmDataLoss() {
            if (changed === 'replaceLease') { await lease.release(); replacement = await maintenance.acquire('delete'); }
            if (changed === 'candidate') f.bind();
            if (changed === 'closeMain') main.closeAdmission();
            if (changed === 'source') await f.registry.write({ ...(await f.registry.inspect())!, activeWorkspaceId: otherWorkspaceId });
            return true;
          }, confirmDeletion: unexpected, confirmReturn: unexpected, setReturnGuard: unexpected, publish: unexpected,
        });
        await expect(work).rejects.toThrow();
        expect(unexpected).not.toHaveBeenCalled(); expect(lifecycle.readState()).toBe('ready');
        if (changed !== 'source') expect(await readFile(registryPath)).toEqual(before);
        else expect((await f.registry.inspect())?.activeWorkspaceId).toBe(otherWorkspaceId);
        expect(await readFile(f.journalPath)).toEqual(journalBefore);
      } finally {
        if (changed === 'candidate') await f.reclaim();
        await replacement?.release(); await lease.release();
      }
    });
  });
});

it.for(['target', 'other', 'none', 'releaseFailure', 'invalidTerminal', 'heldShutdown'] as const)(
  'recovery service terminal joint %s keeps one lease and never relaunches', async (scenario, context) => {
    const f = await fixture(context);
    await f.run(async () => {
      const initial = await f.registry.inspect();
      if (initial === undefined) throw new Error('SYNTHETIC_OBSERVED_REGISTRY_MISSING');
      const persisted = scenario === 'target' ? f.binding.workspaceId : scenario === 'none' ? null : otherWorkspaceId;
      await f.registry.write({ ...initial, activeWorkspaceId: persisted });
      await mkdir(f.workspacePaths.workspaceRoot, { recursive: true, mode: 0o700 });
      const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
      const before = await readFile(registryPath), journalBefore = await readFile(f.journalPath);
      await withNativeRecoveryStatus(f, async ({ main }) => {
        const maintenance = new InMemoryWorkspaceMaintenanceLease();
        const cleanupCause = new Error('SYNTHETIC_SERVICE_RELEASE_FAILED');
        const realHandles: Awaited<ReturnType<typeof maintenance.acquire>>[] = [];
        let handle: Awaited<ReturnType<typeof maintenance.acquire>> | undefined;
        let originalHandle: typeof handle;
        let preparationLease: (() => void) | undefined;
        let lifecycle: MainOwnedSelectorWorkspaceLifecycle | undefined;
        let published: ReturnType<typeof captureWorkspaceDeletionJournal> | undefined;
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        const held = new Promise<void>(resolve => { release = resolve; });
        f.releaseOnClose(release);
        const leasePort = {
          async acquire(purpose: Parameters<typeof maintenance.acquire>[0]) {
            originalHandle = await maintenance.acquire(purpose); realHandles.push(originalHandle);
            const ownedHandle = originalHandle;
            handle = scenario === 'releaseFailure' ? Object.freeze({ async release() { throw cleanupCause; } }) : ownedHandle;
            return handle;
          },
          captureCurrentOwner(purposes: Parameters<typeof maintenance.captureCurrentOwner>[0], expected?: typeof handle) {
            expect(expected).toBe(handle);
            return maintenance.captureCurrentOwner(purposes, originalHandle);
          },
        };
        const command: WorkspaceDeletionMainCommand = {
          async publish(authority, selected, target, content, prepared) {
            authority(); await selected(); await prepared(); authority(); preparationLease!();
            published = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized',
              target: { formatVersion: 2, operationId: content.operationId, workspaceId: target.workspaceId,
                lineageIdentity: { formatVersion: 1, profileId: target.profileId }, registryEntrySha256: target.registryEntrySha256 },
              registryBeforeSha256: target.registrySha256, registryAfterSha256: 'e'.repeat(64),
              previousActiveWorkspaceId: target.previousActiveWorkspaceId, backupDisposition: 'explicitDataLoss',
              inventory: { formatVersion: 2, byteLength: 1, recordCount: 1, sha256: 'f'.repeat(64) },
              inventoryFileIdentity: 'a'.repeat(64), operationRootIdentity: 'b'.repeat(64), operationParentIdentity: 'c'.repeat(64) });
            return { journal: published, workspaceRootIdentity: target.rootIdentity };
          },
          async resume(operationId, owner) {
            if (published === undefined) throw new Error('SYNTHETIC_PUBLICATION_MISSING');
            expect(operationId).toBe(published.target.operationId); expect(maintenance.readState()).toBe('busy');
            preparationLease!(); await owner.assertOwned();
            if (scenario === 'heldShutdown') { enter(); await held; }
            owner.assertCurrent();
            owner.recordRemoved({ status: scenario === 'invalidTerminal' ? 'wrong' : 'removed',
              journal: { ...published, phase: 'registryPublished' } });
            return { formatVersion: 1, status: 'completed', navigation: persisted === otherWorkspaceId ? 'reopenPrevious' : 'selector' };
          },
        };
        const binding = bindWorkspaceDeletionContinuation({ kind: 'recoveryManagement', command,
          persistedActiveWorkspaceId: main.persistedActiveWorkspaceId, assertCurrent: main.assertCurrent,
          assertOwned: f.assertOwned, assertRuntimeCurrent: f.assertCurrent, assertRuntimeAbsent: f.assertOwned });
        const relaunch = vi.fn((): never => { throw new Error('SYNTHETIC_BUSINESS_RELAUNCH_FORBIDDEN'); });
        const confirmReturn = vi.fn(async () => relaunch());
        const result = createWorkspaceDeletionResultRuntime({ kind: 'recoveryManagement', assertCurrent: f.assertCurrent,
          assertMainCurrent: f.assertCurrent, assertOwned: f.assertOwned, assertRuntimeAbsent: f.assertOwned,
          maintenanceState: maintenance, readRuntimeState: () => lifecycle?.readState() === 'stopped' ? 'stopped' : 'unavailable' });
        const complete = vi.fn(result.complete);
        const composition = await createWorkspaceManagementComposition({ mode: 'recoveryManagement',
          operationalIdentity: { appVersion: metadata.appVersion, buildRevision: metadata.buildRevision, runtimeInstanceId: randomUUID() },
          operationalLogger: { write: vi.fn() }, recoveryManagement: {
          targetWorkspaceId: main.target.workspaceId, assertCurrent: main.assertCurrent, assertSelected: main.assertSelected,
          readStatus: phase => main.readStatus({ context: phase, maintenance, authority: f, runtimeAbsence: f }),
        }, deletionPreparation: { maintenanceLease: leasePort, async prepare(request, lifetime, assertLease, operationId) {
          preparationLease = assertLease;
          lifecycle = new MainOwnedSelectorWorkspaceLifecycle({ kind: 'recoveryManagement', assertSelectorCurrent: main.assertCurrent,
            persistedActiveWorkspaceId: main.persistedActiveWorkspaceId, assertDeleteLease: assertLease,
            reservation: { assertMainCurrent: f.assertCurrent, assertMainOwned: f.assertOwned },
            assertRuntimeCurrent: f.assertCurrent, assertRuntimeAbsent: f.assertOwned,
            assertMainOwnedAndRuntimeAbsent: f.assertOwned });
          return prepareWorkspaceDeletion({ operationId, runtimeGeneration: randomUUID(), request, lifetime, assertLease,
            installationRoot: f.root, registry: f.registry, runtime: { kind: 'recoveryManagement',
              workspaceId: main.target.workspaceId, persistedActiveWorkspaceId: main.persistedActiveWorkspaceId,
              lifecycle, assertCurrent: main.assertCurrent, assertSelected: main.assertSelected },
            assertMainReservation: f.assertOwned, assertMainReservationCurrent: f.assertCurrent,
            closeServiceAdmission: () => service.closeAdmission(), async confirmDataLoss() { return true; },
            async confirmDeletion() { return true; }, confirmReturn, setReturnGuard: relaunch, publish: binding.publish });
        } }, deletionContinuation: {
          captureAuthority(operationId, assertLease) {
            expect(assertLease).toBe(preparationLease); assertLease();
            return binding.continuation.captureAuthority(operationId, assertLease);
          }, resume: binding.continuation.resume,
        } });
        const service = composition.service;
        let shutdown: Promise<void> | undefined, settled = false, shutdownSettled = false;
        const commandWork = service.deleteWorkspace({ formatVersion: 1, workspaceId: main.target.workspaceId,
          typedLabel: main.target.workspaceLabel, backupChoice: 'explicitDataLoss' },
        { assertCurrent: main.assertCurrent, closeAdmissionForOwnStop() {} });
        const work = commandWork.then(async value => {
          if (value.status === 'completed') await complete(value);
          return value;
        }).then(value => ({ value }), cause => ({ cause })).finally(() => { settled = true; });
        try {
          if (scenario === 'heldShutdown') {
            await entered; context.signal.throwIfAborted();
            shutdown = composition.shutdown().finally(() => { shutdownSettled = true; });
            void shutdown.catch(() => undefined);
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(settled).toBe(false); expect(shutdownSettled).toBe(false);
            expect(maintenance.readState()).toBe('busy'); release();
          }
          const outcome = await work;
          expect(published).toBeDefined(); expect(preparationLease).toBeDefined();
          if (scenario === 'releaseFailure' || scenario === 'invalidTerminal' || scenario === 'heldShutdown') {
            expect(outcome).toHaveProperty('cause'); expect(complete).not.toHaveBeenCalled();
            if (scenario === 'releaseFailure') {
              expect(maintenance.readState()).toBe('busy');
              expect(outcome).toMatchObject({ cause: { cause: cleanupCause } });
            }
          } else {
            expect(outcome).toEqual({ value: { formatVersion: 1, status: 'completed',
              navigation: persisted === otherWorkspaceId ? 'reopenPrevious' : 'selector' } });
            expect(complete).toHaveBeenCalledOnce(); expect(result.readNextAction()).toBe('restartRequired');
            expect(maintenance.readState()).toBe('idle');
            expect(preparationLease).toThrow('WORKSPACE_MAINTENANCE_BUSY');
          }
          expect(relaunch).not.toHaveBeenCalled(); expect(confirmReturn).not.toHaveBeenCalled();
          expect(await readFile(registryPath)).toEqual(before); expect(await readFile(f.journalPath)).toEqual(journalBefore);
        } finally {
          release(); await work;
          shutdown ??= composition.shutdown();
          if (scenario === 'releaseFailure') await expect(shutdown).rejects.toMatchObject({ cause: cleanupCause });
          else await shutdown;
          for (const real of realHandles) await real.release();
        }
      });
    });
  },
);
