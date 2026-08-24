import type { LocalUpdateHandoffCoordinator } from '../update/localUpdateHandoffCoordinator.js';
import type { LocalUpdatePackageCache } from '../update/localUpdatePackageCache.js';
import {
  WorkspaceManagementError,
  type WorkspaceManagementErrorCode,
} from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceManagementService } from '../workspaces/management/workspaceManagementService.js';
import type {
  WorkspaceManagementEntryV1,
  WorkspaceManagementStatusV1,
} from '../workspaces/management/workspaceManagementTypes.js';
import type { DesktopLifecycleHandle } from './desktopComposition.js';
import type {
  W6b2PackagedProofConfiguration,
  W6b2PackagedProofErrorCode,
  W6b2PackagedProofResult,
} from './w6b2PackagedProof.js';

const workspaceLabels = Object.freeze({
  A: 'First-start workspace 1',
  B: 'First-start workspace 2',
  C: 'First-start workspace 3',
});

interface W6b2PackagedProofControllerOptions {
  readonly cache: Pick<LocalUpdatePackageCache, 'stageSelectedPackage'>;
  readonly configuration: Readonly<W6b2PackagedProofConfiguration>;
  readonly handoff: Pick<
    LocalUpdateHandoffCoordinator,
    'handoffPreparedUpdate' | 'prepareConfirmedUpdate'
  >;
  isQuitRequested(): boolean;
  isRelaunchRequested(): boolean;
  readonly lifecycle: Pick<DesktopLifecycleHandle, 'shutdown'>;
  readonly workspaceManagement: Pick<
    WorkspaceManagementService,
    'getStatus' | 'switchTo'
  >;
}

class W6b2PackagedProofControllerError extends Error {
  constructor(readonly code: W6b2PackagedProofErrorCode) {
    super(code);
    this.name = 'W6b2PackagedProofControllerError';
  }
}

export async function runW6b2PackagedProofController(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): Promise<W6b2PackagedProofResult> {
  try {
    switch (options.configuration.phase) {
      case 'sourceHandoff':
        return await runSourceHandoff(options);
      case 'targetFirstStart':
        return await verifyTargetFirstStart(options);
      case 'switchToB':
        return await switchToWorkspace(options, 'B');
      case 'verifyBRestart':
        return await verifyActiveWorkspace(options, 'B');
      case 'switchToA':
        return await switchToWorkspace(options, 'A');
      case 'rejectC':
        return await rejectRecoveryRequiredWorkspace(options);
    }
  } catch (error) {
    return failure(
      options.configuration.phase,
      error instanceof W6b2PackagedProofControllerError
        ? error.code
        : 'W6B2_PROOF_UNEXPECTED',
    );
  }
}

async function runSourceHandoff(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): Promise<W6b2PackagedProofResult> {
  if (options.configuration.role !== 'source') {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_CONFIGURATION_INVALID',
    );
  }
  try {
    await options.cache.stageSelectedPackage({
      manifestPath: options.configuration.sourceManifestPath,
      role: 'current',
    });
    await options.cache.stageSelectedPackage({
      manifestPath: options.configuration.targetManifestPath,
      role: 'candidate',
    });
    await options.handoff.prepareConfirmedUpdate();
    await options.handoff.handoffPreparedUpdate();
  } catch {
    throw new W6b2PackagedProofControllerError('W6B2_PROOF_HANDOFF_FAILED');
  }
  if (!options.isQuitRequested()) {
    throw new W6b2PackagedProofControllerError('W6B2_PROOF_HANDOFF_FAILED');
  }
  return success(options.configuration.phase, 'completed');
}

async function verifyTargetFirstStart(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): Promise<W6b2PackagedProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  requireWorkspace(status, 'A', true, 'ready');
  requireWorkspace(status, 'B', false, 'ready');
  requireWorkspace(status, 'C', false, 'recoveryRequired');
  await shutdown(options);
  return success(options.configuration.phase, 'completed');
}

async function verifyActiveWorkspace(
  options: Readonly<W6b2PackagedProofControllerOptions>,
  key: 'A' | 'B',
): Promise<W6b2PackagedProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  requireWorkspace(status, key, true, 'ready');
  requireWorkspace(status, 'C', false, 'recoveryRequired');
  await shutdown(options);
  return success(options.configuration.phase, 'completed');
}

async function switchToWorkspace(
  options: Readonly<W6b2PackagedProofControllerOptions>,
  key: 'A' | 'B',
): Promise<W6b2PackagedProofResult> {
  requireTarget(options);
  const status = await readExpectedStatus(options);
  const target = requireWorkspace(status, key, undefined, 'ready');
  if (target.isActive) {
    await shutdown(options);
    return success(options.configuration.phase, 'completed');
  }
  try {
    await options.workspaceManagement.switchTo(target.workspaceId);
  } catch {
    throw new W6b2PackagedProofControllerError('W6B2_PROOF_SWITCH_FAILED');
  }
  if (!options.isRelaunchRequested()) {
    throw new W6b2PackagedProofControllerError('W6B2_PROOF_SWITCH_FAILED');
  }
  return success(options.configuration.phase, 'relaunching');
}

async function rejectRecoveryRequiredWorkspace(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): Promise<W6b2PackagedProofResult> {
  requireTarget(options);
  const before = await readExpectedStatus(options);
  const source = requireWorkspace(before, 'A', true, 'ready');
  const target = requireWorkspace(before, 'C', false, 'recoveryRequired');
  let rejectionCode: WorkspaceManagementErrorCode | undefined;
  try {
    await options.workspaceManagement.switchTo(target.workspaceId);
  } catch (error) {
    if (error instanceof WorkspaceManagementError) {
      rejectionCode = error.code;
    }
  }
  if (rejectionCode !== 'WORKSPACE_MANAGEMENT_SWITCH_FAILED') {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_REJECTION_FAILED',
    );
  }
  const after = await readExpectedStatus(options);
  const activeAfter = requireWorkspace(after, 'A', true, 'ready');
  requireWorkspace(after, 'C', false, 'recoveryRequired');
  if (
    source.workspaceId !== activeAfter.workspaceId ||
    before.activeWorkspaceId !== after.activeWorkspaceId
  ) {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_REJECTION_FAILED',
    );
  }
  await shutdown(options);
  return success(options.configuration.phase, 'completed');
}

async function readExpectedStatus(
  options: Readonly<W6b2PackagedProofControllerOptions>,
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
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
}

function requireWorkspace(
  status: Readonly<WorkspaceManagementStatusV1>,
  key: keyof typeof workspaceLabels,
  active: boolean | undefined,
  availability: WorkspaceManagementEntryV1['availability'],
): Readonly<WorkspaceManagementEntryV1> {
  const entry = status.workspaces.find(
    (candidate) => candidate.workspaceLabel === workspaceLabels[key],
  );
  if (
    entry === undefined ||
    entry.availability !== availability ||
    (active !== undefined && entry.isActive !== active)
  ) {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_WORKSPACE_STATE_INVALID',
    );
  }
  return entry;
}

function requireTarget(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): void {
  if (options.configuration.role !== 'target') {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_CONFIGURATION_INVALID',
    );
  }
}

async function shutdown(
  options: Readonly<W6b2PackagedProofControllerOptions>,
): Promise<void> {
  try {
    await options.lifecycle.shutdown();
  } catch {
    throw new W6b2PackagedProofControllerError('W6B2_PROOF_SHUTDOWN_FAILED');
  }
}

function success(
  phase: W6b2PackagedProofConfiguration['phase'],
  status: 'completed' | 'relaunching',
): W6b2PackagedProofResult {
  return Object.freeze({ formatVersion: 1, phase, status });
}

function failure(
  phase: W6b2PackagedProofConfiguration['phase'],
  errorCode: W6b2PackagedProofErrorCode,
): W6b2PackagedProofResult {
  return Object.freeze({ errorCode, formatVersion: 1, phase, status: 'failed' });
}
