import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import type { DesktopBuildInfo } from '../../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../../release/desktopReleaseInfo.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';
import { captureWorkspaceDeletionLocalUpdateSelection, createWorkspaceDeletionLocalUpdateReaders } from '../../update/workspaceDeletionLocalUpdateSelection.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../creation/workspaceCreationJournalPaths.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from '../deletion/workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from '../deletion/workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionOriginalJournalContinuation } from '../deletion/workspaceDeletionOriginalJournalSelection.js';
import { captureWorkspaceDeletionPhaseSelection } from '../deletion/workspaceDeletionPhaseSelection.js';
import { createReadOnlyJournalSlotPaths } from '../management/mainOwnedWorkspaceManagementOperationGuard.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { hasAnyJournalSlot, type ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { createWorkspaceSwitchJournalPaths } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../update/workspaceFirstStartMigrationJournalPaths.js';

interface WorkspaceDeletionRootSelectionInput {
  userDataRoot: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  assertCurrent(): void;
  assertOwned(): Promise<void>;
  assertWritersAbsent(): Promise<void>;
}

// A named pre-runtime observation. It never repairs slots or grants a lease,
// payload mutation, business startup, or ordinary create/import recovery.
export async function captureColdWorkspaceDeletionAdmissionFromRoot(input: WorkspaceDeletionRootSelectionInput) {
  const root = input.userDataRoot;
  const buildInfo = Object.freeze({ ...input.buildInfo });
  const releaseInfo = input.releaseInfo === undefined ? undefined : Object.freeze({ ...input.releaseInfo });
  const check = input.assertCurrent.bind(input), owned = input.assertOwned.bind(input), writers = input.assertWritersAbsent.bind(input);
  let active = true, firstFailure: { cause: unknown } | undefined;
  let phase: Awaited<ReturnType<typeof captureWorkspaceDeletionPhaseSelection>> | undefined;
  let original: Awaited<ReturnType<typeof captureWorkspaceDeletionOriginalJournalContinuation>> | undefined;
  let external: Awaited<ReturnType<typeof captureWorkspaceDeletionExternalSelectionFromRoot>> | undefined;
  const retain = (cause: unknown) => {
    firstFailure ??= { cause: cause instanceof WorkspaceManagementRecoveryRequiredError
      ? cause : new WorkspaceManagementRecoveryRequiredError({ cause }) };
    return firstFailure.cause;
  };
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    try {
      if (!active) throw new WorkspaceManagementRecoveryRequiredError();
      assertUpdateJournalAuthority(check);
    } catch (cause) { throw retain(cause); }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try { assertCurrent(); const value = await work(); assertCurrent(); return value; }
    catch (cause) { throw retain(cause); }
  };
  const assertOwner = () => checked(async () => {
    await checked(owned); await checked(writers); await checked(owned);
  });
  const revoke = () => { active = false; original?.revoke(); external?.revoke(); phase?.revoke(); };
  try {
    await assertOwner();
    const journalStore = new WorkspaceDeletionJournalStore(root);
    const initial = await checked(() => journalStore.inspect(assertCurrent));
    if (initial.plan.mode === 'absent') {
      await assertOwner();
      const last = await checked(() => journalStore.inspect(assertCurrent));
      if (last.plan.mode !== 'absent') throw new WorkspaceManagementRecoveryRequiredError();
      revoke();
      return undefined;
    }
    if (initial.plan.mode !== 'published') throw new WorkspaceManagementRecoveryRequiredError();
    const binding = captureWorkspaceDeletionJournal(initial.plan.selected);
    const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
    phase = await checked(() => captureWorkspaceDeletionPhaseSelection({
      operationId: binding.target.operationId, expectedBinding: binding,
      authority: { assertCurrent, assertOwned: assertOwner }, journal: journalStore, registry,
      assertWritersAbsent: () => checked(writers),
    }));
    const selectedPhase = phase;
    assertSameJournalSlots(initial.slots, selectedPhase.journalSlots);
    external = await checked(() => captureWorkspaceDeletionExternalSelectionFromRoot({
      userDataRoot: root, buildInfo, releaseInfo, journal: selectedPhase.journal,
      afterRegistry: selectedPhase.afterRegistry,
      assertCurrent, assertOwned: assertOwner, assertWritersAbsent: () => checked(writers),
    }));
    const selectedExternal = external;
    await selectedPhase.assertSelected();
    original = await checked(() => captureWorkspaceDeletionOriginalJournalContinuation(root,
      selectedPhase.journal, selectedPhase.registryState, { assertAuthority: assertCurrent,
        assertExternalSelection: selectedPhase.assertSelected, assertWritersAbsent: () => checked(writers) }));
    const selectedOriginal = original;
    const assertSelected = () => checked(async () => {
      await assertOwner(); await selectedPhase.assertSelected();
      await selectedExternal.assertBuildSelected(); await selectedExternal.assertForeignAbsent();
      await selectedOriginal.assertSelected();
      await selectedExternal.assertForeignAbsent(); await selectedExternal.assertBuildSelected();
      await selectedPhase.assertSelected(); await assertOwner();
    });
    await assertSelected();
    return Object.freeze({ journal: captureWorkspaceDeletionJournal(selectedPhase.journal),
      registryState: selectedPhase.registryState, registryNeedsRecovery: selectedPhase.registryNeedsRecovery,
      buildAdmission: selectedExternal.buildAdmission, assertCurrent, assertSelected, revoke });
  } catch (cause) { revoke(); throw retain(cause); }
}

// The stable base for an admitted operation. It intentionally does not pin the
// deletion's changing journal/registry or authorize any payload/metadata mutation.
export async function captureWorkspaceDeletionExternalSelectionFromRoot(input: WorkspaceDeletionRootSelectionInput & {
  journal: unknown;
  afterRegistry: unknown;
}) {
  const root = input.userDataRoot, buildInfo = Object.freeze({ ...input.buildInfo });
  const releaseInfo = input.releaseInfo === undefined ? undefined : Object.freeze({ ...input.releaseInfo });
  const check = input.assertCurrent.bind(input), owned = input.assertOwned.bind(input), writers = input.assertWritersAbsent.bind(input);
  let active = true, firstFailure: { cause: unknown } | undefined;
  let build: Awaited<ReturnType<typeof captureWorkspaceDeletionLocalUpdateSelection>> | undefined;
  const retain = (cause: unknown) => {
    firstFailure ??= { cause: cause instanceof WorkspaceManagementRecoveryRequiredError
      ? cause : new WorkspaceManagementRecoveryRequiredError({ cause }) };
    return firstFailure.cause;
  };
  const assertCurrent = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    try { if (!active) throw new WorkspaceManagementRecoveryRequiredError(); assertUpdateJournalAuthority(check); }
    catch (cause) { throw retain(cause); }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try { assertCurrent(); const value = await work(); assertCurrent(); return value; }
    catch (cause) { throw retain(cause); }
  };
  const assertOwner = () => checked(async () => {
    await checked(owned); await checked(writers); await checked(owned);
  });
  const revoke = () => { active = false; build?.revoke(); };
  try {
    assertCurrent();
    const journal = captureWorkspaceDeletionJournal(input.journal), after = validateWorkspaceRegistry(input.afterRegistry);
    if (after.formatVersion !== 2 || createHash('sha256').update(serializeWorkspaceRegistry(after)).digest('hex') !== journal.registryAfterSha256) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    const legacyRuntimeRoot = createDesktopProfilePaths(root).runtimeRoot;
    const workspaceIds = new Set(after.workspaces.map(entry => entry.workspaceId));
    workspaceIds.add(journal.target.workspaceId);
    if (journal.previousActiveWorkspaceId !== null) workspaceIds.add(journal.previousActiveWorkspaceId);
    const profiles = [...workspaceIds].map(id => ({ id,
      runtimeRoot: createDesktopProfilePaths(deriveWorkspaceRoot(root, id, 1).workspaceRoot).runtimeRoot }));
    const foreign = [
      createWorkspaceCreationJournalPaths(root, join(root, WORKSPACE_CREATION_JOURNAL_FILE_NAME)),
      createWorkspaceSwitchJournalPaths(root), createWorkspaceFirstStartMigrationJournalPaths(root),
      createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(legacyRuntimeRoot).restoreActivationJournalPath),
      ...profiles.filter(profile => profile.id !== journal.target.workspaceId).map(profile =>
        createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(profile.runtimeRoot).restoreActivationJournalPath)),
    ];
    const targetProfile = profiles.find(profile => profile.id === journal.target.workspaceId)!;
    const targetRestore = createReadOnlyJournalSlotPaths(createProfileSnapshotRuntimePaths(targetProfile.runtimeRoot).restoreActivationJournalPath);
    const updatePaths = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot });
    build = await checked(() => captureWorkspaceDeletionLocalUpdateSelection({
      readers: createWorkspaceDeletionLocalUpdateReaders(updatePaths), buildInfo, releaseInfo, assertCurrent, assertOwned: assertOwner,
    }));
    const selectedBuild = build;
    const assertForeignAbsent = () => checked(async () => {
      for (const paths of foreign) {
        if (await checked(() => hasAnyJournalSlot(paths))) throw new WorkspaceManagementRecoveryRequiredError();
      }
      // Target-local restore is selected payload, but its parent must remain canonical.
      await checked(() => hasAnyJournalSlot(targetRestore));
    });
    const assertBuildSelected = () => checked(() => selectedBuild.assertSelected());
    const assertSelected = () => checked(async () => {
      await assertOwner(); await assertBuildSelected(); await assertForeignAbsent();
      await assertBuildSelected(); await assertOwner();
    });
    await assertSelected();
    return Object.freeze({ buildAdmission: selectedBuild.admission,
      assertCurrent, assertSelected, assertBuildSelected, assertForeignAbsent, revoke });
  } catch (cause) { revoke(); throw retain(cause); }
}

function assertSameJournalSlots(expected: ReadOnlyJournalSlots<WorkspaceDeletionJournal>, actual: ReadOnlyJournalSlots<WorkspaceDeletionJournal>): void {
  for (const name of ['current', 'next', 'backup'] as const) {
    const before = expected[name], after = actual[name];
    if (before === undefined ? after !== undefined : after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !Buffer.from(before.bytes).equals(after.bytes)) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  }
}
