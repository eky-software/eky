import {
  LocalUpdateHandoffError,
  type LocalUpdateHandoffCoordinator,
} from '../update/localUpdateHandoffCoordinator.js';
import type { LocalUpdatePackageCache } from '../update/localUpdatePackageCache.js';
import type { UpdateJournalStore } from '../update/updateJournalStore.js';
import {
  WorkspaceManagementError,
} from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceManagementService } from '../workspaces/management/workspaceManagementService.js';
import type {
  WorkspaceManagementEntryV1,
  WorkspaceManagementStatusV1,
} from '../workspaces/management/workspaceManagementTypes.js';
import type { DesktopLifecycleHandle } from './desktopComposition.js';
import type {
  W6b2PackagedFaultProofConfiguration,
  W6b2PackagedFaultProofErrorCode,
  W6b2PackagedFaultProofResult,
} from './w6b2PackagedProof.js';

const workspaceLabels = Object.freeze({
  A: 'First-start workspace 1',
  B: 'First-start workspace 2',
  C: 'First-start workspace 3',
});

interface W6b2PackagedFaultProofControllerOptions {
  readonly cache: Pick<LocalUpdatePackageCache, 'stageSelectedPackage'>;
  readonly configuration: Readonly<W6b2PackagedFaultProofConfiguration>;
  readonly handoff: Pick<
    LocalUpdateHandoffCoordinator,
    'handoffPreparedUpdate' | 'prepareConfirmedUpdate'
  >;
  isQuitRequested(): boolean;
  isRelaunchRequested(): boolean;
  readonly journalStore: Pick<UpdateJournalStore, 'read'>;
  readonly lifecycle: Pick<DesktopLifecycleHandle, 'shutdown'>;
  readonly workspaceManagement: Pick<
    WorkspaceManagementService,
    'getStatus' | 'switchTo'
  >;
}

class W6b2PackagedFaultProofControllerError extends Error {
  constructor(readonly code: W6b2PackagedFaultProofErrorCode) {
    super(code);
    this.name = 'W6b2PackagedFaultProofControllerError';
  }
}

export async function runW6b2PackagedFaultProofController(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  try {
    switch (options.configuration.phase) {
      case 'sourceHandoff':
        return await runSourceHandoff(options);
      case 'targetFirstStart':
      case 'targetAcceptanceRecovery':
      case 'targetAcceptanceRestart':
        return await verifyAcceptedTarget(options);
      case 'switchToB':
        return await switchToPassiveWorkspace(options);
      case 'passiveWorkspaceRecovery':
        return await verifyPassiveWorkspaceRecovery(options);
      case 'rollbackFirstStart':
        return await verifyRollbackFirstStart(options);
      case 'targetFirstStartFailure':
      case 'businessRollback':
      case 'targetAcceptanceInterruption':
      case 'passiveWorkspaceMigrationFailure':
      case 'binaryRollbackFailure':
      case 'failedSafeVerification':
        throw new W6b2PackagedFaultProofControllerError(
          'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
        );
    }
  } catch (error) {
    return failure(
      options.configuration,
      error instanceof W6b2PackagedFaultProofControllerError
        ? error.code
        : 'W6B2_FAULT_PROOF_UNEXPECTED',
    );
  }
}

async function runSourceHandoff(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  if (options.configuration.role !== 'source') {
    return failure(options.configuration, 'W6B2_FAULT_PROOF_UNEXPECTED');
  }
  await stagePackages(options);

  if (
    options.configuration.faultScenario ===
    'preUpdateRecoveryPointFailure'
  ) {
    await expectRecoveryPointFailure(options);
    await shutdown(options);
    return completed(options.configuration);
  }

  try {
    await options.handoff.prepareConfirmedUpdate();
    await options.handoff.handoffPreparedUpdate();
  } catch {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_HANDOFF_FAILED',
    );
  }
  if (!options.isQuitRequested() || options.isRelaunchRequested()) {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_HANDOFF_FAILED',
    );
  }
  return completed(options.configuration);
}

async function stagePackages(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<void> {
  try {
    await options.cache.stageSelectedPackage({
      manifestPath: options.configuration.sourceManifestPath,
      role: 'current',
    });
    await options.cache.stageSelectedPackage({
      manifestPath: options.configuration.targetManifestPath,
      role: 'candidate',
    });
  } catch {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED',
    );
  }
}

async function expectRecoveryPointFailure(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<void> {
  let expectedFailureObserved = false;
  try {
    await options.handoff.prepareConfirmedUpdate();
  } catch (error) {
    expectedFailureObserved =
      error instanceof LocalUpdateHandoffError &&
      error.code === 'UPDATE_PREPARATION_RECOVERY_POINT_FAILED';
  }
  if (
    !expectedFailureObserved ||
    options.isQuitRequested() ||
    options.isRelaunchRequested()
  ) {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
    );
  }
  await requireJournalState(options, 'failed');
}

async function verifyAcceptedTarget(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  requireWorkspace(status, 'A', true, 'ready');
  requireWorkspace(status, 'B', false, 'ready');
  requireWorkspace(status, 'C', false, 'ready');
  await requireJournalState(options, 'accepted');
  await shutdown(options);
  return completed(options.configuration);
}

async function switchToPassiveWorkspace(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  requireWorkspace(status, 'A', true, 'ready');
  const target = requireWorkspace(status, 'B', false, 'ready');
  try {
    await options.workspaceManagement.switchTo(target.workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceManagementError) {
      throw new W6b2PackagedFaultProofControllerError(
        'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
      );
    }
    throw error;
  }
  if (!options.isRelaunchRequested()) {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
    );
  }
  return relaunching(options.configuration);
}

async function verifyPassiveWorkspaceRecovery(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  requireWorkspace(status, 'A', true, 'ready');
  requireWorkspace(status, 'B', false, 'ready');
  requireWorkspace(status, 'C', false, 'recoveryRequired');
  await requireJournalState(options, 'accepted');
  await shutdown(options);
  return completed(options.configuration);
}

async function verifyRollbackFirstStart(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<W6b2PackagedFaultProofResult> {
  if (options.configuration.role !== 'source') {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
  const status = await readExpectedStatus(options);
  requireWorkspace(status, 'A', true, 'ready');
  requireWorkspace(status, 'B', false, 'ready');
  requireWorkspace(status, 'C', false, 'ready');
  await requireJournalState(options, 'rolledBack');
  await shutdown(options);
  return completed(options.configuration);
}

async function readExpectedStatus(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<Readonly<WorkspaceManagementStatusV1>> {
  try {
    const status = await options.workspaceManagement.getStatus();
    if (
      status.operationState !== 'idle' ||
      status.workspaces.length !== 3 ||
      new Set(status.workspaces.map((entry) => entry.workspaceLabel)).size !== 3
    ) {
      throw new Error('invalid');
    }
    return status;
  } catch {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
}

function requireWorkspace(
  status: Readonly<WorkspaceManagementStatusV1>,
  key: keyof typeof workspaceLabels,
  active: boolean,
  availability: WorkspaceManagementEntryV1['availability'],
): Readonly<WorkspaceManagementEntryV1> {
  const entry = status.workspaces.find(
    (candidate) => candidate.workspaceLabel === workspaceLabels[key],
  );
  if (
    entry === undefined ||
    entry.isActive !== active ||
    entry.availability !== availability
  ) {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
  return entry;
}

async function requireJournalState(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
  expectedState: 'accepted' | 'failed' | 'rolledBack',
): Promise<void> {
  try {
    if ((await options.journalStore.read())?.state !== expectedState) {
      throw new Error('invalid');
    }
  } catch {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID',
    );
  }
}

function requireTarget(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): void {
  if (options.configuration.role !== 'target') {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
}

async function shutdown(
  options: Readonly<W6b2PackagedFaultProofControllerOptions>,
): Promise<void> {
  try {
    await options.lifecycle.shutdown();
  } catch {
    throw new W6b2PackagedFaultProofControllerError(
      'W6B2_FAULT_PROOF_SHUTDOWN_FAILED',
    );
  }
}

function completed(
  configuration: Readonly<W6b2PackagedFaultProofConfiguration>,
): W6b2PackagedFaultProofResult {
  return Object.freeze({
    faultScenario: configuration.faultScenario,
    formatVersion: 2,
    phase: configuration.phase,
    status: 'completed',
  });
}

function relaunching(
  configuration: Readonly<W6b2PackagedFaultProofConfiguration>,
): W6b2PackagedFaultProofResult {
  return Object.freeze({
    faultScenario: configuration.faultScenario,
    formatVersion: 2,
    phase: configuration.phase,
    status: 'relaunching',
  });
}

function failure(
  configuration: Readonly<W6b2PackagedFaultProofConfiguration>,
  errorCode: W6b2PackagedFaultProofErrorCode,
): W6b2PackagedFaultProofResult {
  return Object.freeze({
    errorCode,
    faultScenario: configuration.faultScenario,
    formatVersion: 2,
    phase: configuration.phase,
    status: 'failed',
  });
}
