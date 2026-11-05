import { randomUUID, createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { resolvePackagedSmokeTempPath } from '../dist/main/packagedSmoke.js';
import { acquireWorkspaceProcessReservation, readWorkspaceProcessReservationIdentity } from '../dist/runtime/workspaceProcessReservation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../dist/workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceRegistryStore } from '../dist/workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../dist/workspaces/registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../dist/workspaces/registry/workspaceRegistrySerializer.js';
import { sameCrashSafeFileSlotIdentity } from '../dist/workspaces/persistence/crashSafeFileSlot.js';
import { captureDeletionTarget } from '../dist/workspaces/management/workspaceDeletionTarget.js';
import { createWorkspaceDeletionCommand } from '../dist/workspaces/deletion/workspaceDeletionCommand.js';
import { WorkspaceDeletionInventoryStore, createWorkspaceDeletionInventoryPaths } from '../dist/workspaces/deletion/workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths } from '../dist/workspaces/deletion/workspaceDeletionJournalStore.js';
import { deriveWorkspaceDeletionPayloadPaths } from '../dist/workspaces/deletion/workspaceDeletionPayloadPaths.js';
import { assertWorkspaceDeletionMetadataAbsent } from '../dist/workspaces/deletion/workspaceDeletionMetadataCleanup.js';
import { workspaceDeletionQuarantineFileSystem } from '../dist/workspaces/deletion/workspaceDeletionQuarantine.js';
import { readWorkspaceColdRecoveryOwnerPresence, assertWorkspaceColdRecoveryConflictsAbsent } from '../dist/workspaces/runtime/workspaceColdRecoveryAdmission.js';
import { createReadOnlyJournalSlotPaths } from '../dist/workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { createDesktopProfilePaths } from '../dist/runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../dist/update/localUpdateRuntimePaths.js';
import { captureWorkspaceDeletionLocalUpdateSelection, createWorkspaceDeletionLocalUpdateReaders }
  from '../dist/update/workspaceDeletionLocalUpdateSelection.js';
import { readAcceptedBusinessBuild } from '../dist/update/acceptedBuildMetadata.js';
import { inspectPackagedPilotSeries, requirePackagedSeriesPin } from './packagedPilotSeries.mjs';
import { createProfileSnapshotRuntimePaths } from '../dist/profileBackup/profileSnapshotRuntimePaths.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../dist/workspaces/creation/workspaceCreationJournalPaths.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../dist/workspaces/import/workspaceBackupImportJournalPaths.js';
import { createWorkspaceLegacyAdoptionJournalPaths } from '../dist/workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { createWorkspaceSwitchJournalPaths } from '../dist/workspaces/switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../dist/workspaces/update/workspaceFirstStartMigrationJournalPaths.js';
import { deriveWorkspaceRoot } from '../dist/workspaces/registry/deriveWorkspaceRoot.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../dist/workspaces/replacement/workspaceBackupReplacementPaths.js';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';

const invalid = () => new Error('PACKAGED_DELETION_PREPARATION_INVALID');
const fingerprint = value => ({ dev: value.dev, ino: value.ino, size: value.size,
  mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });

// Test assembly only. The caller must supply its real phase-tree/port proof.
export function createPackagedWorkspaceDeletionPreparation(input) {
  if (!(input?.signal instanceof AbortSignal) || typeof input.assertPreviousPhaseStopped !== 'function') throw invalid();
  const signal = input.signal, stopped = input.assertPreviousPhaseStopped.bind(input);
  let state = 'new', selectedContext, rootIdentity, smokeIdentity, prepared, verifiedRegistry, retainedReservation;
  const leases = new InMemoryWorkspaceMaintenanceLease();

  async function scoped(context, expected, next, work) {
    if (state !== expected) { state = 'failed'; throw invalid(); }
    state = `${expected}:running`;
    const running = state;
    let active = true, reservation, lease, failure, value, firstGuardFailure, closeUncertain = false, buildSelection;
    const retainExclusion = () => { closeUncertain = true; };
    const retainGuardFailure = error => { firstGuardFailure ??= { error }; return firstGuardFailure.error; };
    const current = () => {
      if (firstGuardFailure !== undefined) throw firstGuardFailure.error;
      try {
        signal.throwIfAborted();
        if (!active || state !== running) throw invalid();
        reservation?.invalidated.throwIfAborted();
      } catch (error) { throw retainGuardFailure(error); }
    };
    try {
      if (context === null || typeof context !== 'object' || !Object.isFrozen(context) ||
          Reflect.ownKeys(context).length !== 2 ||
          !Object.hasOwn(context, 'smokeRootDirectory') || !Object.hasOwn(context, 'smokeToken') ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(context, 'smokeToken') ?? {}, 'value') ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(context, 'smokeRootDirectory') ?? {}, 'value') ||
          typeof context.smokeToken !== 'string' || !/^[a-f0-9]{32}$/u.test(context.smokeToken)) throw invalid();
      const temp = resolvePackagedSmokeTempPath(tmpdir());
      const root = join(temp, 'eky-desktop-smoke', context.smokeToken);
      if (context.smokeRootDirectory !== root || selectedContext !== undefined && selectedContext !== context) throw invalid();
      selectedContext = context;
      current();
      const assertStopped = async () => {
        try {
          current();
          const result = await stopped(context, expected);
          current();
          if (result !== undefined) throw invalid();
        } catch (error) { throw retainGuardFailure(error); }
      };
      await assertStopped();
      await ordinaryPath(temp, root, true); current();
      const rootObserved = await readWorkspaceProcessReservationIdentity(root); current();
      if (smokeIdentity !== undefined && smokeIdentity !== rootObserved) throw invalid();
      smokeIdentity ??= rootObserved;
      const userDataRoot = join(root, 'user-data');
      await ordinaryPath(root, userDataRoot, true); current();
      reservation = await acquireWorkspaceProcessReservation({ userDataRoot, signal,
        ...(rootIdentity === undefined ? {} : { expectedIdentity: rootIdentity }) });
      current(); rootIdentity ??= reservation.identity;
      lease = await leases.acquire('delete');
      const leaseCurrent = leases.captureCurrentOwner(['delete'], lease);
      const assertOwned = async () => {
        try {
          current(); leaseCurrent(); await assertStopped();
          await reservation.assertOwned(); current(); leaseCurrent();
          if (await readWorkspaceProcessReservationIdentity(root) !== smokeIdentity) throw invalid();
          current(); leaseCurrent();
        } catch (error) { throw retainGuardFailure(error); }
      };
      await assertOwned();
      let assertBuild = expected === 'new' ? async () => { throw invalid(); } : async () => {};
      const captureBuild = async () => {
        if (expected !== 'new' || buildSelection !== undefined) throw invalid();
        const pilot = await inspectPackagedPilotSeries(requirePackagedSeriesPin(), { assertCurrent: current });
        const update = createLocalUpdateRuntimePaths({ userDataPath: userDataRoot,
          legacyRuntimeRoot: createDesktopProfilePaths(userDataRoot).runtimeRoot });
        const readers = createWorkspaceDeletionLocalUpdateReaders(update);
        buildSelection = await captureWorkspaceDeletionLocalUpdateSelection({ readers,
          buildInfo: pilot.buildInfo, releaseInfo: pilot.releaseInfo, assertCurrent: current, assertOwned });
        if (buildSelection.admission !== 'exactAcceptedBuild') throw invalid();
        assertBuild = async () => {
          await buildSelection.assertSelected();
          const slots = await readers.metadata(); current();
          const legacy = await readers.legacyMetadata(); current();
          const business = readAcceptedBusinessBuild(slots.current?.value ?? legacy.current?.value);
          if (business?.appVersion !== pilot.buildInfo.appVersion || business?.buildRevision !== pilot.buildInfo.buildRevision ||
              business?.releaseChannel !== pilot.releaseInfo.releaseChannel) throw invalid();
          await buildSelection.assertSelected();
        };
        await assertBuild();
      };
      const registry = new WorkspaceRegistryStore({ installationRoot: userDataRoot,
        filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
      value = await work({ root, userDataRoot, registry, current, assertOwned,
        captureBuild, assertBuild: () => assertBuild(), retainExclusion });
      await assertOwned();
    } catch (error) {
      // Slot owners may safely map a failed close. Do not infer settlement from their generic rejection.
      if (reservation !== undefined) retainExclusion();
      failure = { error: firstGuardFailure === undefined || firstGuardFailure.error === error ? error
      : new AggregateError([firstGuardFailure.error, error], 'PACKAGED_DELETION_PREPARATION_FAILED', { cause: firstGuardFailure.error }) }; }
    finally {
      active = false;
      buildSelection?.revoke();
      const closeFailure = error => { failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
          'PACKAGED_DELETION_PREPARATION_CLOSE_FAILED', { cause: failure.error }) }; }
      try { await lease?.release(); }
      catch (error) { retainExclusion(); closeFailure(error); }
      // A rejected close is not proof of settlement. The existing worker owner must end this process.
      if (closeUncertain) retainedReservation = reservation;
      else try { await reservation?.release(); }
      catch (error) { retainedReservation = reservation; closeFailure(error); }
    }
    try { signal.throwIfAborted(); if (state !== running || retainedReservation !== undefined && failure === undefined) throw invalid(); }
    catch (error) { failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
      'PACKAGED_DELETION_PREPARATION_FAILED', { cause: failure.error }) }; }
    if (failure !== undefined) { state = 'failed'; throw failure.error; }
    state = next;
    return value;
  }

  const verify = async owner => {
    if (prepared === undefined) throw invalid();
    const slots = await owner.registry.inspectSlots(owner.current);
    assertFinalRegistry(slots, prepared, verifiedRegistry);
    for (const selection of prepared.absentPaths) await requireAbsent(owner, selection);
    await assertWorkspaceDeletionMetadataAbsent(owner.userDataRoot, prepared.journal.target,
      { assertAuthority: owner.current, assertExternalSelection: owner.assertOwned });
    await assertRetained(owner, prepared.retained);
    const finalSlots = await owner.registry.inspectSlots(owner.current);
    assertFinalRegistry(finalSlots, prepared, slots.current);
    verifiedRegistry ??= { bytes: Buffer.from(finalSlots.current.bytes), identity: { ...finalSlots.current.identity } };
  };

  return Object.freeze({
    prepareAfterRestoredExit(context) {
      return scoped(context, 'new', 'prepared', async owner => {
        let slots = await owner.registry.inspectSlots(owner.current);
        const before = slots.current?.value;
        if (before === undefined || before.workspaces.length !== 1 ||
            before.activeWorkspaceId !== before.workspaces[0].workspaceId || slots.next !== undefined || slots.backup !== undefined) throw invalid();
        await owner.captureBuild();
        const entry = before.workspaces[0];
        await assertCleanPreparation(owner, before);
        const retained = await captureRetained(owner, entry.workspaceId);
        await assertCleanPreparation(owner, before);
        if (before.formatVersion === 1) {
          const promotedIdentity = await owner.registry.writeSelected({ ...before, formatVersion: 2 }, {
            expectedSlots: Object.fromEntries(Object.entries(slots).map(([key, slot]) => [key, slot?.bytes])),
            expectedIdentities: Object.fromEntries(Object.entries(slots).map(([key, slot]) => [key, slot?.identity])),
            assertAuthority: owner.current, assertExternalSelection: () => assertCleanPreparation(owner, before),
          });
          slots = await owner.registry.inspectSlots(owner.current);
          if (!isDeepStrictEqual(slots.current?.value, { ...before, formatVersion: 2 }) ||
              slots.next !== undefined || slots.backup !== undefined || slots.current.identity === undefined ||
              !sameCrashSafeFileSlotIdentity(slots.current.identity, promotedIdentity)) throw invalid();
        }
        await assertCleanPreparation(owner, slots.current.value);
        const selected = await captureDeletionTarget({ installationRoot: owner.userDataRoot, registry: owner.registry,
          workspaceId: entry.workspaceId, typedLabel: entry.workspaceLabel, assertAuthority: owner.current });
        const assertPublication = async () => { await owner.assertOwned(); await owner.assertBuild(); };
        const assertPreparation = async () => { await selected.assertCurrent(); await owner.assertBuild(); };
        const command = createWorkspaceDeletionCommand({ userDataRoot: owner.userDataRoot, registry: owner.registry,
          assertWritersAbsent: owner.assertOwned });
        const result = await command.publish(owner.current, assertPublication, selected.target,
          { operationId: randomUUID(), target: selected.target, backupDisposition: 'explicitDataLoss' }, assertPreparation);
        const journal = result.journal;
        if (journal.phase !== 'authorized' || journal.target.workspaceId !== entry.workspaceId ||
            journal.originalJournalProofs.length !== 0) throw invalid();
        const absentPaths = new Set();
        await new WorkspaceDeletionInventoryStore(owner.userDataRoot, journal.target.operationId).consumeSelectedRecords({
          target: journal.target, inventory: journal.inventory, inventoryFileIdentity: journal.inventoryFileIdentity,
          operationRootIdentity: journal.operationRootIdentity, operationParentIdentity: journal.operationParentIdentity },
          { assertAuthority: owner.current, assertExternalSelection: owner.assertOwned }, async row => {
            if (row.role === 'inspectionEvidence') return;
            for (const path of deriveWorkspaceDeletionPayloadPaths(owner.userDataRoot, journal.target, row)) {
              absentPaths.add(path.sourcePath); absentPaths.add(path.quarantinePath);
            }
          });
        const paths = createWorkspaceDeletionJournalPaths(owner.userDataRoot);
        absentPaths.add(paths.currentPath); absentPaths.add(paths.nextPath); absentPaths.add(paths.backupPath);
        absentPaths.add(createWorkspaceDeletionInventoryPaths(owner.userDataRoot, journal.target.operationId).directoryPath);
        await selected.assertCurrent(); await assertRetained(owner, retained);
        const absenceSelections = [];
        for (const path of absentPaths) absenceSelections.push(await captureAbsenceSelection(owner, path, absentPaths));
        const after = { ...slots.current.value, activeWorkspaceId: null, workspaces: [] };
        const afterBytes = Buffer.from(serializeWorkspaceRegistry(after));
        if (createHash('sha256').update(afterBytes).digest('hex') !== journal.registryAfterSha256) throw invalid();
        prepared = { journal, retained, absentPaths: absenceSelections, after, afterBytes };
      });
    },
    verifyAfterRecoveryExit(context) { return scoped(context, 'prepared', 'recovered', verify); },
    verifyAfterRestartExit(context) { return scoped(context, 'recovered', 'complete', verify); },
  });
}

async function assertCleanPreparation(owner, registry) {
  await owner.assertOwned();
  await owner.assertBuild();
  const root = owner.userDataRoot;
  const deletionJournal = createWorkspaceDeletionJournalPaths(root);
  const present = await readWorkspaceColdRecoveryOwnerPresence(
    createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)),
    createWorkspaceBackupImportJournalPaths(root, join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME)), deletionJournal);
  if (present.some(Boolean)) throw invalid();
  owner.current();
  const legacyRuntimeRoot = createDesktopProfilePaths(root).runtimeRoot;
  const update = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot });
  const runtimeRoots = [legacyRuntimeRoot, ...registry.workspaces.map(entry => createDesktopProfilePaths(
    deriveWorkspaceRoot(root, entry.workspaceId, entry.layoutVersion).workspaceRoot).runtimeRoot)];
  await assertWorkspaceColdRecoveryConflictsAbsent({
    adoptionJournal: createWorkspaceLegacyAdoptionJournalPaths(root), deletionJournal,
    firstStartMigrationJournal: createWorkspaceFirstStartMigrationJournalPaths(root),
    replacementJournal: createReadOnlyJournalSlotPaths(deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath),
    switchJournal: createWorkspaceSwitchJournalPaths(root),
    profileRestoreJournals: runtimeRoots.map(path => createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(path).restoreActivationJournalPath)),
    directSetupRecovery: createReadOnlyJournalSlotPaths(update.directSetupMigrationRecoveryPath),
    updateJournal: createReadOnlyJournalSlotPaths(update.journalPath), legacyUpdateJournal: createReadOnlyJournalSlotPaths(update.legacyJournalPath),
  });
  await owner.assertOwned();
}

async function captureRetained(owner, workspaceId) {
  const archive = join(owner.root, 'invoice-pdf-archive', workspaceId);
  await ordinaryPath(owner.root, archive, true); owner.current();
  const names = await readdir(archive); owner.current();
  if (names.length !== 1 || !/^Lasku-\d{1,50}\.pdf$/u.test(names[0])) throw invalid();
  const files = [join(owner.root, 'profile-backup', 'packaged-profile.ekybackup'),
    join(owner.root, 'profile-backup', 'restored-profile.ekybackup'), join(archive, names[0])];
  const retained = [];
  for (const path of files) retained.push({ path, proof: await hashRetainedFile(owner, path) });
  return retained;
}

async function assertRetained(owner, retained) {
  for (const { path, proof } of retained) if (!isDeepStrictEqual(await hashRetainedFile(owner, path), proof)) throw invalid();
}

async function hashRetainedFile(owner, path) {
  await owner.assertOwned();
  const before = await ordinaryPath(owner.root, path); owner.current();
  const file = await open(path, 'r');
  let failure, result;
  try {
    owner.current();
    const opened = await file.stat(); owner.current();
    if (!opened.isFile() || opened.nlink !== 1 || !isDeepStrictEqual(fingerprint(opened), fingerprint(before))) throw invalid();
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (true) {
      owner.current();
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      owner.current();
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
      if (!Number.isSafeInteger(position) || position > before.size) throw invalid();
    }
    const after = await file.stat(); owner.current();
    const current = await ordinaryPath(owner.root, path); owner.current();
    if (position !== before.size || !isDeepStrictEqual(fingerprint(before), fingerprint(after)) ||
        !isDeepStrictEqual(fingerprint(before), fingerprint(current))) throw invalid();
    result = { ...fingerprint(before), sha256: hash.digest('hex') };
  } catch (error) { failure = { error }; }
  try { await file.close(); }
  catch (error) { owner.retainExclusion(); failure = { error: failure === undefined ? error : new AggregateError([failure.error, error],
    'PACKAGED_DELETION_RETAINED_FILE_CLOSE_FAILED', { cause: failure.error }) }; }
  if (failure !== undefined) throw failure.error;
  await owner.assertOwned();
  return result;
}

function assertFinalRegistry(slots, prepared, previous) {
  const current = slots.current;
  if (current?.identity === undefined || !isDeepStrictEqual(current.value, prepared.after) ||
      !Buffer.from(current.bytes).equals(prepared.afterBytes) || slots.next !== undefined || slots.backup !== undefined ||
      previous !== undefined && (!Buffer.from(previous.bytes).equals(Buffer.from(current.bytes)) ||
        !sameCrashSafeFileSlotIdentity(previous.identity, current.identity))) throw invalid();
}

async function captureAbsenceSelection(owner, path, removableRoots) {
  const parts = relative(owner.userDataRoot, dirname(path)).split(sep).filter(Boolean);
  if (parts.some(part => part === '..')) throw invalid();
  let parent = owner.userDataRoot;
  const ancestors = [];
  for (const part of [undefined, ...parts]) {
    if (part !== undefined) parent = join(parent, part);
    const identity = await workspaceDeletionQuarantineFileSystem.ancestor(parent, false, owner.current);
    const removable = [...removableRoots].some(root => parent === root || parent.startsWith(`${root}${sep}`));
    ancestors.push({ path: parent, identity, removable });
  }
  return { path, ancestors };
}

async function requireAbsent(owner, selection) {
  const observed = [];
  for (const ancestor of selection.ancestors) {
    const identity = await workspaceDeletionQuarantineFileSystem.ancestor(ancestor.path, false, owner.current);
    if (identity === null && ancestor.identity !== null && !ancestor.removable ||
        identity !== null && identity !== ancestor.identity || observed.at(-1) === null && identity !== null) throw invalid();
    observed.push(identity);
  }
  let absent = false;
  try { await lstat(selection.path); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; absent = true; }
  owner.current();
  for (let index = selection.ancestors.length - 1; index >= 0; index--) {
    if (await workspaceDeletionQuarantineFileSystem.ancestor(selection.ancestors[index].path, false, owner.current) !== observed[index]) throw invalid();
  }
  if (!absent) throw invalid();
}
