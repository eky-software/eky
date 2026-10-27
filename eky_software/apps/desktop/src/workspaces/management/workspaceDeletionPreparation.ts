import type { DeletionBackupContent, DeletionBackupPreparationOwner } from '../../profileBackup/portableProfileBackup.js';
import {
  beginDeletionBackupProof,
  type ExportIdentity,
  type InspectedDeletionBackupBinding,
} from '../../profileBackup/deletionBackupReceipt.js';
import type { ProfileSnapshotBrokerClient } from '../../profileBackup/profileSnapshotBrokerClient.js';
import { isOperationId } from '../../profileBackup/profileSnapshotBrokerProtocol.js';
import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { MainOwnedActiveWorkspaceLifecycle } from '../runtime/mainOwnedActiveWorkspaceLifecycle.js';
import type { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { parseWorkspaceDeletionRequest } from './workspaceManagementCapabilityProtocol.js';
import { captureDeletionTarget } from './workspaceDeletionTarget.js';
import type { WorkspaceDeletionPreparationLifetime, WorkspaceDeletionPreparationOutcome } from './workspaceManagementTypes.js';

type DeletionTarget = Awaited<ReturnType<typeof captureDeletionTarget>>['target'];
type ActiveDeletionRuntime = Readonly<{
  kind: 'active';
  workspaceId: WorkspaceId;
  lifecycle: Pick<MainOwnedActiveWorkspaceLifecycle,
    'quiesceForDelete' | 'stopForDelete' | 'readState' | 'assertNoActiveWorkspaceRuntime' | 'ensurePreviousWorkspaceRunning'>;
  broker: Pick<ProfileSnapshotBrokerClient, 'beginDeleteMaintenance' | 'assertDeleteMaintenance' | 'captureInspectionAuthority'>;
  createBackup(owner: DeletionBackupPreparationOwner): Promise<DeletionBackupContent | null>;
  recheckExport(): Promise<ExportIdentity>;
}>;
type SelectorDeletionRuntime = Readonly<{
  kind: 'selector';
  lifecycle: Pick<MainOwnedSelectorWorkspaceLifecycle,
    'quiesceWrites' | 'stopAndProveHandlesClosed' | 'assertStoppedCurrent' | 'assertNoActiveWorkspaceRuntime' | 'ensurePreviousWorkspaceRunning'>;
}>;

export interface WorkspaceDeletionPreparationOptions {
  readonly operationId: string;
  readonly request: unknown;
  readonly installationRoot: string;
  readonly runtimeGeneration: string;
  readonly lifetime: WorkspaceDeletionPreparationLifetime;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  readonly runtime: ActiveDeletionRuntime | SelectorDeletionRuntime;
  assertLease(): void;
  assertMainReservation(): Promise<void>;
  assertMainReservationCurrent(): void;
  closeServiceAdmission(): void;
  confirmDataLoss(target: DeletionTarget): Promise<boolean>;
  confirmDeletion(target: DeletionTarget): Promise<boolean>;
  confirmReturn(target: DeletionTarget): Promise<boolean>;
  setReturnGuard(guard: () => void): void;
  // W7.4 supplies the real journal consumer. W7.3 exposes no delete IPC.
  publish(assertAuthority: () => void, assertSelection: () => Promise<void>, target: DeletionTarget): Promise<void>;
}

export class WorkspaceDeletionPreparationFailure extends Error {
  constructor(readonly firstFailure: unknown, readonly cleanupFailure: unknown) {
    super('WORKSPACE_DELETE_PREPARATION_FAILED', { cause: firstFailure });
  }
}

/** Runs inside the admitted management request and its exact delete lease. */
export async function prepareWorkspaceDeletion(
  input: Readonly<WorkspaceDeletionPreparationOptions>,
): Promise<WorkspaceDeletionPreparationOutcome> {
  const request = parseWorkspaceDeletionRequest(input.request);
  if (!isOperationId(input.operationId) || !isOperationId(input.runtimeGeneration)) {
    throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
  }
  const { operationId, runtime, lifetime } = input;
  let phase: 'live' | 'closing' | 'stopped' | 'invalid' = 'live';
  let preparationStarted = false;
  let publishing = false;
  let publicationSpent = false;
  let capturedChannel: (() => void) | undefined;
  let inspectedContent: DeletionBackupContent | undefined;
  const assertRequest = () => {
    if (phase === 'invalid') throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
    try {
      assertUpdateJournalAuthority(lifetime.assertCurrent.bind(lifetime));
      assertUpdateJournalAuthority(input.assertLease.bind(input));
    } catch (error) { phase = 'invalid'; throw error; }
  };
  const selection = await captureDeletionTarget({
    installationRoot: input.installationRoot, workspaceId: request.workspaceId,
    typedLabel: request.typedLabel, registry: input.registry, assertAuthority: assertRequest,
  });
  assertRequest();
  const previous = selection.target.previousActiveWorkspaceId;
  if ((runtime.kind === 'active' && previous !== runtime.workspaceId) ||
      (runtime.kind === 'selector' && previous !== null)) {
    throw new Error('WORKSPACE_DELETE_RUNTIME_MISMATCH');
  }
  if (request.backupChoice === 'createBackup' &&
      (runtime.kind !== 'active' || previous !== request.workspaceId)) {
    throw new Error('WORKSPACE_DELETE_BACKUP_OWNER_UNAVAILABLE');
  }

  const assertContinuity = () => {
    assertRequest(); selection.assertValid();
    if (phase === 'closing') throw new Error('WORKSPACE_DELETE_SHUTDOWN_PENDING');
    if (phase === 'live') {
      if (preparationStarted && runtime.kind === 'active') {
        if (capturedChannel === undefined) throw new Error('WORKSPACE_DELETE_FENCE_UNPROVEN');
        assertUpdateJournalAuthority(capturedChannel);
      }
    } else if (phase === 'stopped') {
      if (runtime.kind === 'active') {
        if (runtime.lifecycle.readState() !== 'stopped') throw new Error('WORKSPACE_DELETE_SHUTDOWN_UNPROVEN');
      } else runtime.lifecycle.assertStoppedCurrent();
      assertUpdateJournalAuthority(input.assertMainReservationCurrent.bind(input));
    }
  };
  const assertCurrent = async () => {
    try {
      assertContinuity();
      await selection.assertCurrent();
      assertContinuity();
      if (phase === 'live' && preparationStarted && runtime.kind === 'active') {
        await runtime.broker.assertDeleteMaintenance(operationId);
      } else if (phase === 'stopped') {
        await runtime.lifecycle.assertNoActiveWorkspaceRuntime();
        assertContinuity();
        await input.assertMainReservation();
      }
      assertContinuity();
    } catch (error) { phase = 'invalid'; throw error; }
  };
  const stop = async () => {
    if (runtime.kind === 'active') await runtime.lifecycle.stopForDelete(runtime.workspaceId, operationId);
    else await runtime.lifecycle.stopAndProveHandlesClosed(null);
  };
  const assertInspection = (binding: InspectedDeletionBackupBinding) => {
    if (inspectedContent === undefined) throw new Error('WORKSPACE_DELETE_INSPECTION_UNFINISHED');
    for (const [actual, expected] of [[binding.source, inspectedContent.sourceIdentity],
      [binding.exported, inspectedContent.exported.identity]] as const) {
      if (actual.operationId !== expected.operationId || actual.generationId !== expected.generationId ||
          actual.runtimeSession !== expected.runtimeSession) throw new Error('WORKSPACE_DELETE_INSPECTION_MISMATCH');
    }
  };
  let proof: ReturnType<typeof beginDeletionBackupProof> | undefined;
  try {
    if (request.backupChoice === 'explicitDataLoss') {
      const accepted = await input.confirmDataLoss(selection.target);
      await assertCurrent();
      assertContinuity();
      if (!accepted) return 'cancelled';
    }
    lifetime.closeAdmissionForOwnStop();
    input.closeServiceAdmission();
    preparationStarted = true;
    if (runtime.kind === 'active') {
      capturedChannel = runtime.broker.captureInspectionAuthority();
      let firstFailure: { error: unknown } | undefined;
      // Closing main I/O admission must not wait for the backend's drain ack.
      // Join both existing owners even if one of them rejects first.
      await Promise.allSettled([
        Promise.resolve().then(() => runtime.lifecycle.quiesceForDelete(runtime.workspaceId, operationId)),
        Promise.resolve().then(() => runtime.broker.beginDeleteMaintenance(operationId)),
      ].map(task => task.catch(error => { firstFailure ??= { error }; throw error; })));
      if (firstFailure !== undefined) throw firstFailure.error;
    } else await runtime.lifecycle.quiesceWrites(null);
    await assertCurrent();
    assertContinuity();

    let cancelled = false;
    let receipt: Awaited<ReturnType<ReturnType<typeof beginDeletionBackupProof>['issue']>> | undefined;
    if (request.backupChoice === 'createBackup' && runtime.kind === 'active') {
      proof = beginDeletionBackupProof({
        operationId, workspaceId: request.workspaceId, profileId: selection.target.profileId,
        registryEntrySha256: selection.target.registryEntrySha256,
        rootIdentity: selection.target.rootIdentity, leaseOwner: operationId,
        runtimeGeneration: input.runtimeGeneration,
      }, {
        assertSnapshotBoundary: assertContinuity, assertContinuity, assertCurrent,
        assertInspectionCleanup: assertInspection,
        assertOwnersExited() {
          assertContinuity();
          if (phase !== 'stopped') throw new Error('WORKSPACE_DELETE_SHUTDOWN_UNPROVEN');
        },
        recheckAuthenticatedExport: runtime.recheckExport.bind(runtime),
      });
      const content = await runtime.createBackup({ operationId, assertValid: assertContinuity, assertCurrent });
      await assertCurrent();
      assertContinuity();
      if (content === null) cancelled = true;
      else { inspectedContent = content; receipt = await proof.issue(content); }
    }
    await assertCurrent();
    assertContinuity();
    const confirmed = !cancelled && await input.confirmDeletion(selection.target);
    await assertCurrent();
    assertContinuity();
    phase = 'closing';
    await stop();
    assertRequest(); selection.assertValid();
    await runtime.lifecycle.assertNoActiveWorkspaceRuntime();
    assertRequest(); selection.assertValid();
    await input.assertMainReservation();
    assertRequest(); selection.assertValid();
    assertUpdateJournalAuthority(input.assertMainReservationCurrent.bind(input));
    phase = 'stopped';
    await assertCurrent();
    assertContinuity();
    if (!confirmed) {
      proof?.invalidate();
      const returnConfirmed = await input.confirmReturn(selection.target);
      await assertCurrent();
      assertContinuity();
      if (!returnConfirmed) return 'cancelled';
      input.setReturnGuard(assertContinuity);
      await runtime.lifecycle.ensurePreviousWorkspaceRunning(previous);
      assertContinuity();
      return 'returnRequested';
    }

    // Consent and backup use the same final selection/exit lifetime. A failed
    // callback burns it; retaining a guard never creates a second handoff.
    publicationSpent = true;
    publishing = true;
    const guard = () => {
      if (!publishing || !publicationSpent || phase !== 'stopped') throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
      assertContinuity();
    };
    const assertSelection = async () => { guard(); await assertCurrent(); guard(); };
    const publish = async (assertBackupAuthority?: () => void, assertBackupSelection?: () => Promise<void>) => {
      const assertPublication = () => { guard(); assertBackupAuthority?.(); guard(); };
      const assertPublicationSelection = async () => {
        assertPublication();
        if (assertBackupSelection !== undefined) await assertBackupSelection();
        else await assertSelection();
        assertPublication();
      };
      await assertPublicationSelection(); assertPublication();
      await input.publish(assertPublication, assertPublicationSelection, selection.target);
      await assertPublicationSelection(); assertPublication();
    };
    if (receipt !== undefined) await receipt.consume(publish);
    else await publish();
    assertContinuity();
    return 'prepared';
  } catch (error) {
    phase = 'invalid'; proof?.invalidate();
    if (preparationStarted) {
      try { await stop(); }
      catch (cleanupFailure) {
        if (cleanupFailure !== error) throw new WorkspaceDeletionPreparationFailure(error, cleanupFailure);
      }
    }
    throw error;
  } finally {
    publishing = false;
    proof?.invalidate();
  }
}
