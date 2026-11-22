import { isDeepStrictEqual } from 'node:util';

import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { readAcceptedBusinessBuild, type VersionedAcceptedBuildMetadata } from '../update/acceptedBuildMetadata.js';
import { parseDirectSetupMigrationRecovery } from '../update/directSetupMigrationRecovery.js';
import { classifyPreWorkspaceBuildAdmission } from '../update/preWorkspaceBuildAdmission.js';
import { assertTerminalLocalUpdateJournal } from '../update/terminalLocalUpdateJournal.js';
import { parseUpdateJournal } from '../update/updateJournal.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import { sameCrashSafeFileSlotIdentity } from '../workspaces/persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { serializeWorkspaceRegistry } from '../workspaces/registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry, WorkspaceId } from '../workspaces/registry/workspaceRegistryTypes.js';

interface AcceptedWorkspaceRegistryBuildSelection {
  readonly metadata?: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  readonly legacyMetadata: ReadOnlyJournalSlots<VersionedAcceptedBuildMetadata>;
  readonly updateJournal: ReadOnlyJournalSlots<unknown>;
  readonly legacyUpdateJournal: ReadOnlyJournalSlots<unknown>;
  readonly directSetupRecovery: ReadOnlyJournalSlots<unknown>;
  readonly switchJournal: ReadOnlyJournalSlots<unknown>;
}

const absent = (slots: ReadOnlyJournalSlots<unknown>) =>
  slots.current === undefined && slots.next === undefined && slots.backup === undefined;
const settled = (slots: ReadOnlyJournalSlots<unknown>) => slots.next === undefined && slots.backup === undefined;

interface AcceptedWorkspaceRegistryObservation {
  registry: Pick<WorkspaceRegistryStore, 'inspectCurrentSlot'>;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  activeWorkspaceId: WorkspaceId;
  assertCurrent(): void;
  assertReadOwner(): Promise<void>;
  hasRegistrySideSlots(): Promise<boolean>;
  inspectBuildSelection(): Promise<AcceptedWorkspaceRegistryBuildSelection>;
  hasRecoveryConflict(registry: Readonly<LocalWorkspaceRegistry>): Promise<boolean>;
}

async function observeAcceptedWorkspaceRegistry(input: AcceptedWorkspaceRegistryObservation) {
  const assertAuthority = () => assertUpdateJournalAuthority(input.assertCurrent.bind(input));
  assertAuthority();
  await input.assertReadOwner();
  const sideSlotsPresent = await input.hasRegistrySideSlots();
  assertAuthority();
  if (sideSlotsPresent) return;
  const current = await input.registry.inspectCurrentSlot(assertAuthority);
  if (current?.value.formatVersion !== 1 || current.identity === undefined ||
      current.value.activeWorkspaceId !== input.activeWorkspaceId) return;
  const observed = { current, next: undefined, backup: undefined };
  const source = current.value;

  async function inspectEligibleBuild() {
    assertAuthority();
    await input.assertReadOwner();
    const conflict = await input.hasRecoveryConflict(source);
    assertAuthority();
    if (conflict) return undefined;
    const selection = await input.inspectBuildSelection();
    await input.assertReadOwner();
    assertAuthority();
    const { metadata, legacyMetadata, updateJournal, legacyUpdateJournal, directSetupRecovery, switchJournal } = selection;
    if (metadata?.current?.identity === undefined || !settled(metadata) || !absent(legacyMetadata) ||
        !absent(legacyUpdateJournal) || !absent(switchJournal) || !settled(updateJournal) || !settled(directSetupRecovery)) {
      return undefined;
    }
    const accepted = readAcceptedBusinessBuild(metadata.current.value);
    const { appVersion, buildRevision, releaseChannel } = input.releaseInfo;
    const journal = updateJournal.current === undefined ? undefined : parseUpdateJournal(updateJournal.current.value);
    const recovery = directSetupRecovery.current === undefined ? undefined : parseDirectSetupMigrationRecovery(directSetupRecovery.current.value);
    if (accepted?.appVersion !== appVersion || accepted.buildRevision !== buildRevision || accepted.releaseChannel !== releaseChannel ||
        (journal !== undefined && updateJournal.current?.identity === undefined) ||
        (recovery !== undefined && (recovery.state !== 'accepted' || directSetupRecovery.current?.identity === undefined)) ||
        (journal !== undefined && recovery !== undefined)) return undefined;
    try { assertTerminalLocalUpdateJournal(metadata.current.value, journal); }
    catch (cause) {
      if (cause instanceof Error && cause.message === 'LOCAL_UPDATE_STATE_MIGRATION_CONFLICT') return undefined;
      throw cause;
    }
    const admission = classifyPreWorkspaceBuildAdmission({ buildInfo: input.buildInfo, releaseInfo: input.releaseInfo,
      acceptedBuild: metadata.current.value, journal, directSetupRecovery: recovery });
    return admission.status === 'allowed' && admission.admission === 'exactAcceptedBuild' ? selection : undefined;
  }

  const acceptedSelection = await inspectEligibleBuild();
  if (acceptedSelection === undefined) return;
  return { observed, source, assertAuthority, inspectEligibleBuild, acceptedSelection };
}

/** Read only: a live backend can justify a clean restart, never a write. */
export async function needsAcceptedWorkspaceRegistryPromotion(input: AcceptedWorkspaceRegistryObservation): Promise<boolean> {
  return await observeAcceptedWorkspaceRegistry(input) !== undefined;
}

/** Cold main only: never repairs an ambiguous selection or accepts a build. */
export async function promoteAcceptedWorkspaceRegistry(input: Omit<AcceptedWorkspaceRegistryObservation, 'registry' | 'assertReadOwner'> & {
  registry: Pick<WorkspaceRegistryStore, 'inspectCurrentSlot' | 'inspectSlots' | 'promoteSettledLegacySelection'>;
  assertOwned(): Promise<void>;
  onUncertain(cause: unknown): void;
}): Promise<void> {
  const observation = await observeAcceptedWorkspaceRegistry({ ...input, assertReadOwner: input.assertOwned.bind(input) });
  if (observation === undefined) return;
  const { observed, source, assertAuthority, inspectEligibleBuild, acceptedSelection } = observation;
  const assertExternalSelection = async () => {
    if (!isDeepStrictEqual(await inspectEligibleBuild(), acceptedSelection)) throw new WorkspaceManagementRecoveryRequiredError();
  };
  const identity = await input.registry.promoteSettledLegacySelection(observed, {
    assertAuthority, assertExternalSelection, onUncertain: input.onUncertain.bind(input),
  });
  try {
    const expected = Buffer.from(serializeWorkspaceRegistry({ ...source, formatVersion: 2 }));
    await assertExternalSelection();
    const after = await input.registry.inspectSlots(assertAuthority);
    if (!settled(after) || after.current?.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(after.current.identity, identity) || !expected.equals(after.current.bytes)) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  } catch (cause) {
    input.onUncertain(cause);
    throw cause;
  }
}
