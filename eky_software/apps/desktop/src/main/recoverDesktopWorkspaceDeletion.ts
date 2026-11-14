import { join } from 'node:path';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { createWorkspaceDeletionCommand } from '../workspaces/deletion/workspaceDeletionCommand.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService, type WorkspaceDeletionCompletion } from '../workspaces/management/workspaceManagementService.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import type { WorkspaceManagementObserver } from '../workspaces/management/workspaceManagementTypes.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { captureColdWorkspaceDeletionAdmissionFromRoot } from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import { createWorkspaceDeletionColdContinuation } from './workspaceDeletionContinuation.js';

type ColdDeletionBuildAdmission = NonNullable<Awaited<
  ReturnType<typeof captureColdWorkspaceDeletionAdmissionFromRoot>
>>['buildAdmission'];

// Called while main still owns the installation, before any repairing startup.
export async function recoverDesktopWorkspaceDeletion(input: {
  userDataRoot: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'acquire' | 'captureCurrentOwner'>;
  reservation: { assertMainCurrent(): void; assertMainOwned(): Promise<void>; invalidate(): void };
  work: { pending: boolean; uncertainty?: { reason: unknown } };
  assertStartupCurrent(): void;
  observer: WorkspaceManagementObserver;
  observeBuildAdmission?(admission: ColdDeletionBuildAdmission): void;
}): Promise<WorkspaceDeletionCompletion | undefined> {
  const root = input.userDataRoot, buildInfo = Object.freeze({ ...input.buildInfo });
  const releaseInfo = input.releaseInfo === undefined ? undefined : Object.freeze({ ...input.releaseInfo });
  const work = input.work, lease = input.maintenanceLease, observer = input.observer;
  const startup = input.assertStartupCurrent.bind(input), main = input.reservation.assertMainCurrent.bind(input.reservation);
  const owned = input.reservation.assertMainOwned.bind(input.reservation), invalidate = input.reservation.invalidate.bind(input.reservation);
  if (work.pending || work.uncertainty !== undefined) throw new WorkspaceManagementRecoveryRequiredError();
  let continuation: ReturnType<typeof createWorkspaceDeletionColdContinuation> | undefined;
  const assertCurrent = () => {
    assertUpdateJournalAuthority(startup); assertUpdateJournalAuthority(main);
    if (!work.pending || work.uncertainty !== undefined) throw new WorkspaceManagementRecoveryRequiredError();
  };
  const assertOwned = async () => { assertCurrent(); await owned(); assertCurrent(); };
  const selectionInput = { userDataRoot: root, buildInfo, releaseInfo, assertCurrent, assertOwned,
    assertWritersAbsent: assertOwned };
  work.pending = true;
  try {
    const selection = await captureColdWorkspaceDeletionAdmissionFromRoot(selectionInput);
    if (selection === undefined) { assertCurrent(); return undefined; }
    try {
      const notification: unknown = input.observeBuildAdmission?.(selection.buildAdmission);
      if (notification !== undefined) void Promise.resolve(notification).catch(() => undefined);
    } catch { /* Reporting cannot replace admission, command failure or cleanup. */ }
    return await WorkspaceManagementService.recoverDeletionBeforeRuntime({
      selection, maintenanceLease: lease, observer, assertCurrent, isStopping: () => false,
      captureSelection: assertLease => captureColdWorkspaceDeletionAdmissionFromRoot({ ...selectionInput,
        assertCurrent: assertLease }),
      async captureAuthority(journal, assertLease) {
        assertLease();
        continuation = createWorkspaceDeletionColdContinuation({ ...selectionInput, journal, assertCurrent: assertLease });
        return continuation.owner;
      },
      async resumeSelected(journal, authority, observeStage) {
        if (continuation === undefined) throw new WorkspaceManagementRecoveryRequiredError();
        const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: join(root, WORKSPACE_REGISTRY_FILE_NAME) });
        const selectedOwner = continuation;
        const serviceCurrent = authority.assertCurrent.bind(authority), serviceOwned = authority.assertOwned.bind(authority);
        const reservationOwned = selectedOwner.assertReservationOwned.bind(selectedOwner);
        const coldSelection = Object.freeze({
          async assertReservationOwned() {
            assertUpdateJournalAuthority(serviceCurrent); await reservationOwned(); assertUpdateJournalAuthority(serviceCurrent);
          },
          async assertStableSelection() {
            assertUpdateJournalAuthority(serviceCurrent); await serviceOwned(); assertUpdateJournalAuthority(serviceCurrent);
          },
        });
        const command = createWorkspaceDeletionCommand({ userDataRoot: root, registry,
          assertWritersAbsent: assertOwned, observeStage, beforeMetadata: continuation.beforeMetadata, coldSelection });
        return command.resumeSelected(journal, authority);
      },
      onUncertain(reason) {
        work.uncertainty ??= { reason };
        // Burn physical main authority before service settlement and outer close.
        assertUpdateJournalAuthority(invalidate);
      },
    });
  } finally { work.pending = false; }
}
