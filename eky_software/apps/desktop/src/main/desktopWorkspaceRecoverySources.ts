import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { readWorkspaceProcessReservationIdentity } from '../runtime/workspaceProcessReservation.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { createReadOnlyJournalSlotPaths } from '../workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../workspaces/creation/workspaceCreationJournalPaths.js';
import { parseWorkspaceCreationJournalBytes, WORKSPACE_CREATION_JOURNAL_MAX_BYTES } from '../workspaces/creation/workspaceCreationJournalBytes.js';
import { createNodeCrashSafeFileSlotFileSystem, type CrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { WorkspaceFirstStartMigrationJournalStore } from '../workspaces/update/workspaceFirstStartMigrationJournalStore.js';
import { WorkspaceDeletionJournalStore } from '../workspaces/deletion/workspaceDeletionJournalStore.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../workspaces/registry/inspectWorkspaceRoot.js';
import { validateWorkspaceRegistry } from '../workspaces/registry/workspaceRegistryValidation.js';
import { ProfileRestoreActivationJournalStore, captureProfileRestoreActivationDeletionSlots } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { captureWorkspaceDeletionLocalUpdateSelection, createWorkspaceDeletionLocalUpdateReaders } from '../update/workspaceDeletionLocalUpdateSelection.js';
import { createLocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import { classifyPreWorkspaceBuildAdmission } from '../update/preWorkspaceBuildAdmission.js';
import { isTerminalUpdateJournalState } from '../update/startupRecoveryAuthority.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { WorkspaceLegacyAdoptionJournalStore, captureWorkspaceLegacyAdoptionDeletionSlots } from '../workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { WorkspaceBackupImportJournalStore, captureWorkspaceBackupImportDeletionSlots } from '../workspaces/import/workspaceBackupImportJournalStore.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../workspaces/import/workspaceBackupImportJournalPaths.js';
import { inspectWorkspaceBackupImportBindingAdmission } from '../workspaces/import/workspaceBackupImportBindingAdmission.js';
import { WorkspaceRemnantBindingStore } from '../workspaces/deletion/workspaceRemnantBindingStore.js';
import type { WorkspaceRemnantBindingV1 } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { assertNoDuplicateWorkspaceRegistryKeys } from '../workspaces/registry/workspaceRegistryDuplicateKeys.js';
import { deriveWorkspaceBackupReplacementOperationsPaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import type { ObservedRecoverySelection } from '../workspaces/persistence/crashSafeByteSlotStore.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryEntryV1 } from '../workspaces/registry/workspaceRegistryTypes.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import { inspectDesktopRecoveryRegistrySelection } from './desktopWorkspaceRecoveryRegistrySelection.js';

export interface DesktopWorkspaceRecoveryReadAuthority {
  assertCurrent(): void;
  assertOwned(): Promise<void>;
}

export interface DesktopWorkspaceRecoverySourceObservation {
  readonly mode: 'normal' | 'observed';
  readonly evidence: readonly unknown[];
  readonly registry: Readonly<LocalWorkspaceRegistry> | undefined;
  readonly candidateEntries: readonly Readonly<LocalWorkspaceRegistryEntryV1>[];
  readonly owners: readonly string[];
  readonly reason: string | undefined;
}

/** Eligibility snapshot only; callers still own fresh selection and runtime-absence proof. */
export async function readDesktopWorkspaceRecoveryTarget(
  input: Parameters<typeof readDesktopWorkspaceRecoverySources>[0],
) {
  const root = input.root, buildInfo = structuredClone(input.buildInfo);
  const releaseInfo = input.releaseInfo === undefined ? undefined : structuredClone(input.releaseInfo);
  const authority = Object.freeze({ assertCurrent: input.authority.assertCurrent.bind(input.authority),
    assertOwned: input.authority.assertOwned.bind(input.authority) });
  const source = await readDesktopWorkspaceRecoverySources({ root, buildInfo, releaseInfo, authority });
  const evidence = [...source.evidence];
  const notOffered = (reason: string | undefined) => Object.freeze({ mode: 'notOffered' as const, reason,
    evidence: Object.freeze(evidence), target: undefined, owners: source.owners,
    persistedActiveWorkspaceId: source.registry?.activeWorkspaceId });
  if (source.mode === 'normal' || source.reason !== undefined) return notOffered(source.reason);
  const target = source.candidateEntries[0];
  if (target === undefined) return notOffered('noJournalTarget');
  if (source.registry === undefined) throw changed();
  if (new Set(source.candidateEntries.map(entry => entry.workspaceId)).size !== 1) return notOffered('multipleTargets');
  const census = await readDesktopWorkspaceRecoveryCensus({ root, registry: source.registry, authority });
  evidence.push(...census.evidence);
  if (census.otherRecoveryPresent) return notOffered('otherRecoveryOwner');
  if (census.localRestores.length !== 0) return notOffered('unprovedLocalRestore');
  assertUpdateJournalAuthority(authority.assertCurrent);
  return Object.freeze({ mode: 'candidate' as const, reason: undefined, evidence: Object.freeze(evidence),
    owners: source.owners, persistedActiveWorkspaceId: source.registry.activeWorkspaceId,
    target: Object.freeze({ ...target, lineageIdentity: Object.freeze({ ...target.lineageIdentity }) }) });
}

/** Read-only source snapshot, not runtime-absence, recovery or deletion authority. */
export async function readDesktopWorkspaceRecoverySources(input: Readonly<{
  root: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  authority: DesktopWorkspaceRecoveryReadAuthority;
}>): Promise<Readonly<DesktopWorkspaceRecoverySourceObservation>> {
  const root = input.root, buildInfo = structuredClone(input.buildInfo);
  const releaseInfo = input.releaseInfo === undefined ? undefined : structuredClone(input.releaseInfo);
  const { assertCurrent, checked, owned } = captureReadAuthority(input.authority);
  const evidence: unknown[] = [], candidateEntries: Readonly<LocalWorkspaceRegistryEntryV1>[] = [];
  const owners: string[] = [];
  let selectedRegistry: Readonly<LocalWorkspaceRegistry> | undefined;
  const finish = (mode: DesktopWorkspaceRecoverySourceObservation['mode'], reason: string | undefined) =>
    Object.freeze({ mode, reason, evidence: Object.freeze([...evidence]), registry: selectedRegistry,
      candidateEntries: Object.freeze([...candidateEntries]), owners: Object.freeze([...owners]) });
  const registryStore = new WorkspaceRegistryStore({ installationRoot: root,
    filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
  const updatePaths = createLocalUpdateRuntimePaths({ userDataPath: root,
    legacyRuntimeRoot: createDesktopProfilePaths(root).runtimeRoot });
  const updateReaders = createWorkspaceDeletionLocalUpdateReaders(updatePaths);
  const imported = new WorkspaceBackupImportJournalStore({ installationRoot: root,
    filePath: join(root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) });
  const adopted = new WorkspaceLegacyAdoptionJournalStore(root);
  const activation = new ProfileRestoreActivationJournalStore(
    deriveWorkspaceBackupReplacementOperationsPaths(root).activationJournalPath);
  await owned();
  const remember = <T>(value: T): T => { evidence.push(structuredClone(value)); return value; };
  const registrySelection = remember(await checked(() => inspectDesktopRecoveryRegistrySelection({
    registry: registryStore, assertCurrent,
  })));
  selectedRegistry = registrySelection.mode === 'normal' ? registrySelection.source.value
    : registrySelection.slots.current?.value;
  if (registrySelection.mode === 'normal') {
    await owned();
    return finish('normal', registrySelection.reason);
  }
  const update = {
    metadata: remember(await checked(updateReaders.metadata)),
    legacyMetadata: remember(await checked(updateReaders.legacyMetadata)),
    journal: remember(await checked(updateReaders.journal)),
    legacyJournal: remember(await checked(updateReaders.legacyJournal)),
    directSetup: remember(await checked(updateReaders.directSetup)),
  };
  for (const slots of Object.values(update)) for (const record of Object.values(slots)) {
    if (record !== undefined) {
      if (record.identity === undefined) throw changed();
      assertNoDuplicateWorkspaceRegistryKeys(new TextDecoder('utf-8', { fatal: true }).decode(record.bytes));
    }
  }
  let reason: string | undefined = releaseInfo === undefined ? 'development' : undefined;
  const updateSlots = Object.values(update);
  if (updateSlots.some(slots => slots.next !== undefined || slots.backup !== undefined)) reason ??= 'updateRecovery';
  const metadata = update.metadata.current?.value ?? update.legacyMetadata.current?.value;
  const journal = update.journal.current?.value ?? update.legacyJournal.current?.value;
  if (journal !== undefined && !isTerminalUpdateJournalState(journal.state)) reason ??= 'updateRecovery';
  if (update.directSetup.current !== undefined && update.directSetup.current.value.state !== 'accepted') reason ??= 'updateRecovery';
  if (reason === undefined && releaseInfo !== undefined) {
    const eligibility = classifyPreWorkspaceBuildAdmission({ acceptedBuild: metadata,
      journal, directSetupRecovery: update.directSetup.current?.value,
      buildInfo, releaseInfo });
    if (eligibility.status === 'rejected' ||
        (eligibility.admission !== 'exactAcceptedBuild' && eligibility.admission !== 'authorizedNewerBuild')) reason = 'buildNotEligible';
    else {
      // Keep the strict existing checks, including duplicate fields and legacy/current agreement.
      const build = await checked(() => captureWorkspaceDeletionLocalUpdateSelection({
        readers: updateReaders, buildInfo, releaseInfo,
        assertCurrent, assertOwned: owned,
      }));
      try { await checked(build.assertSelected); } finally { build.revoke(); }
    }
  }
  const bind = async (key: unknown) => {
    const value = remember(await checked(() => new WorkspaceRemnantBindingStore(root, key).inspect({
      assertAuthority: assertCurrent, assertExternalSelection: owned,
    })));
    return value.mode === 'published' ? value.value : undefined;
  };
  const add = (binding: WorkspaceRemnantBindingV1) => {
    const entry = selectedRegistry?.workspaces.find(value => value.workspaceId === binding.workspaceId);
    if (entry === undefined) { reason ??= 'unregisteredTarget'; return; }
    if (!isDeepStrictEqual(entry.lineageIdentity, binding.lineageIdentity)) throw changed();
    candidateEntries.push(entry); owners.push(binding.owner);
  };
  const normalRoute = async (normalReason: string) => {
    await owned();
    return finish('normal', normalReason);
  };
  const assertSameObservation = <T>(observed: ObservedRecoverySelection, slots: ReadOnlyJournalSlots<T>) => {
    for (const slot of ['current', 'backup', 'next'] as const) {
      if (!isDeepStrictEqual(observed.identities[slot], slots[slot]?.identity)) throw changed();
    }
    if (observed.source !== undefined && !isDeepStrictEqual(observed.bytes, slots[observed.source]?.bytes)) throw changed();
  };
  const selection = <T>(slots: ReadOnlyJournalSlots<T>) => ({
    expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
    expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
  });
  // Normal recovery deliberately ignores discarded sibling content. Only a bound
  // management candidate may request the stricter all-slot deletion selection.
  const importObserved = remember(await checked(() => imported.inspectRecoverySelection(assertCurrent)));
  if (importObserved.value !== undefined) {
    const binding = await bind({ owner: 'workspaceImport', operationId: importObserved.value.operationId });
    if (binding === undefined) return normalRoute('unboundImport');
    if (importObserved.value.formatVersion !== 2) return normalRoute('legacyImport');
    if (await checked(() => inspectWorkspaceBackupImportBindingAdmission(root, importObserved.value)) !== 'bound') throw changed();
    const slots = remember(await checked(() => imported.inspectSlots(assertCurrent)));
    assertSameObservation(importObserved, slots);
    captureWorkspaceBackupImportDeletionSlots(binding, selection(slots)); add(binding);
  }
  const adoptionObserved = remember(await checked(() => adopted.inspectRecoverySelection(assertCurrent)));
  if (adoptionObserved.value !== undefined) {
    const binding = await bind({ owner: 'workspaceLegacyAdoption', workspaceId: adoptionObserved.value.workspaceId });
    if (binding === undefined) return normalRoute('unboundAdoption');
    const slots = remember(await checked(() => adopted.inspectSlots(assertCurrent)));
    assertSameObservation(adoptionObserved, slots);
    captureWorkspaceLegacyAdoptionDeletionSlots(binding, selection(slots)); add(binding);
  }
  const activationObserved = remember(await checked(() => activation.inspectRecoverySelection(assertCurrent)));
  if (activationObserved.value !== undefined) {
    const replacement = await bind({ owner: 'workspaceReplacement', operationId: activationObserved.value.operationId });
    const migration = await bind({ owner: 'workspaceActivationMigration', operationId: activationObserved.value.operationId });
    if (replacement !== undefined && migration !== undefined) throw changed();
    const binding = replacement ?? migration;
    if (binding === undefined) return normalRoute('unboundActivation');
    const slots = remember(await checked(() => activation.inspectDeletionSlots(assertCurrent)));
    assertSameObservation(activationObserved, slots);
    captureProfileRestoreActivationDeletionSlots(binding, selection(slots)); add(binding);
  }
  await owned();
  return finish('observed', reason);
}

/** Presence/source observations only. Local restore-v1 is never a guarded-writer proof. */
export async function readDesktopWorkspaceRecoveryCensus(input: Readonly<{
  root: string;
  registry: Readonly<LocalWorkspaceRegistry>;
  authority: DesktopWorkspaceRecoveryReadAuthority;
}>) {
  const root = input.root, registry = validateWorkspaceRegistry(structuredClone(input.registry));
  const { assertCurrent, checked, owned } = captureReadAuthority(input.authority);
  const evidence: unknown[] = [];
  const remember = <T>(value: T): T => { evidence.push(structuredClone(value)); return value; };
  const profilePaths = (workspaceRoot: string) => createReadOnlyJournalSlotPaths(
    createProfileSnapshotRuntimePaths(createDesktopProfilePaths(workspaceRoot).runtimeRoot).restoreActivationJournalPath);
  const localRestores: Readonly<{
    entry: Readonly<LocalWorkspaceRegistryEntryV1>;
    observation: Awaited<ReturnType<ProfileRestoreActivationJournalStore['inspectRecoverySelection']>>;
  }>[] = [];
  await owned();
  for (const entry of registry.workspaces) {
    const paths = deriveWorkspaceRoot(root, entry.workspaceId, entry.layoutVersion);
    const identityOrAbsence = (path: string) => checked(async () => {
      try { await lstat(path); }
      catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
        throw cause;
      }
      return readWorkspaceProcessReservationIdentity(path);
    });
    remember(await identityOrAbsence(paths.workspacesRoot));
    const identity = remember(await identityOrAbsence(paths.workspaceRoot));
    if (identity !== null) await checked(() => inspectWorkspaceRoot(paths));
    const local = new ProfileRestoreActivationJournalStore(profilePaths(paths.workspaceRoot).currentPath);
    const observation = remember(await checked(() => local.inspectRecoverySelection(assertCurrent)));
    if (observation.value === undefined) continue;
    await checked(() => inspectWorkspaceRoot(paths));
    localRestores.push(Object.freeze({ entry, observation }));
  }
  const creation = createNodeCrashSafeFileSlotFileSystem(
    createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)),
    WORKSPACE_CREATION_JOURNAL_MAX_BYTES);
  let creationPresent = false;
  for (const slot of ['current', 'next', 'backup'] as const) {
    let identity: CrashSafeFileSlotIdentity | undefined;
    const bytes = await checked(() => creation.readSlot(slot, value => { identity = value; }));
    if (bytes === undefined) remember(undefined);
    else {
      if (identity === undefined) throw changed();
      remember({ bytes, identity, value: parseWorkspaceCreationJournalBytes(bytes) });
      creationPresent = true;
    }
  }
  const switchSlots = remember(await checked(() => new WorkspaceSwitchJournalStore(root).inspectSlots(assertCurrent)));
  const migrationSlots = remember(await checked(() => new WorkspaceFirstStartMigrationJournalStore({ userDataPath: root }).inspectSlots()));
  const deletion = remember(await checked(() => new WorkspaceDeletionJournalStore(root).inspect(assertCurrent)));
  const legacyRestore = remember(await checked(() => new ProfileRestoreActivationJournalStore(profilePaths(root).currentPath).inspectDeletionSlots(assertCurrent)));
  await owned();
  return Object.freeze({ evidence: Object.freeze(evidence), localRestores: Object.freeze(localRestores),
    otherRecoveryPresent: creationPresent || Object.values(switchSlots).some(Boolean) ||
      Object.values(migrationSlots).some(Boolean) || Object.values(deletion.slots).some(Boolean) ||
      Object.values(legacyRestore).some(Boolean) });
}

function changed() {
  return new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
}

function captureReadAuthority(authority: DesktopWorkspaceRecoveryReadAuthority) {
  const current = authority.assertCurrent.bind(authority);
  const proveOwned = authority.assertOwned.bind(authority);
  let firstFailure: { cause: unknown } | undefined;
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    try { assertUpdateJournalAuthority(current); }
    catch (cause) { firstFailure = { cause }; throw cause; }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try {
      assertCurrent(); const value = await work(); assertCurrent(); return value;
    } catch (cause) {
      firstFailure ??= { cause };
      throw firstFailure.cause;
    }
  };
  const owned = () => checked(async () => {
    const result: unknown = await proveOwned();
    if (result !== undefined) throw changed();
  });
  return { assertCurrent, checked, owned };
}
