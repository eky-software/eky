import {
  LocalUpdateHandoffError,
  type LocalUpdateHandoffCoordinator,
} from '../update/localUpdateHandoffCoordinator.js';
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

const recoveryPointProtectionFailureCodes = new Set([
  'RECOVERY_POINT_KEY_INVALID',
  'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
  'SECRET_STORAGE_UNAVAILABLE',
]);
const recoveryPointSnapshotFailureCodes = new Map<
  string,
  W6b2PackagedProofErrorCode
>([
  [
    'PROFILE_SNAPSHOT_ARTIFACTS_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED',
  ],
  [
    'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED',
  ],
  [
    'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID',
  ],
  [
    'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE',
  ],
  [
    'PROFILE_SNAPSHOT_DATABASE_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED',
  ],
  [
    'PROFILE_SNAPSHOT_STAGING_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED',
  ],
  [
    'PROFILE_SNAPSHOT_VALIDATION_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED',
  ],
]);
const recoveryPointStorageFailureCodes = new Set([
  'RECOVERY_POINT_ALREADY_EXISTS',
  'RECOVERY_POINT_ENCRYPTION_FAILED',
  'RECOVERY_POINT_ENCRYPTION_INVALID',
  'RECOVERY_POINT_FILE_INVALID',
  'RECOVERY_POINT_INDEX_INVALID',
  'RECOVERY_POINT_INDEX_UNAVAILABLE',
  'RECOVERY_POINT_INPUT_INVALID',
  'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
  'RECOVERY_POINT_KEY_ENVELOPE_UNAVAILABLE',
  'RECOVERY_POINT_PAYLOAD_INVALID',
  'RECOVERY_POINT_ROTATION_INVALID',
  'RECOVERY_POINT_ROTATION_JOURNAL_INVALID',
  'RECOVERY_POINT_ROTATION_JOURNAL_UNAVAILABLE',
  'RECOVERY_POINT_SELF_INSPECTION_FAILED',
  'RECOVERY_POINT_STORE_UNAVAILABLE',
  'RECOVERY_POINT_WRITE_FAILED',
]);

interface W6b2PackagedProofControllerOptions {
  readonly cache: Pick<LocalUpdatePackageCache, 'stageSelectedPackage'>;
  readonly configuration: Readonly<W6b2PackagedProofConfiguration>;
  readonly handoff: Pick<
    LocalUpdateHandoffCoordinator,
    'handoffPreparedUpdate' | 'prepareConfirmedUpdate'
  >;
  isQuitRequested(): boolean;
  isRelaunchRequested(): boolean;
  readRecoveryPointFailureCode(): string | undefined;
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
  } catch {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_SOURCE_STAGE_FAILED',
    );
  }
  try {
    await options.cache.stageSelectedPackage({
      manifestPath: options.configuration.targetManifestPath,
      role: 'candidate',
    });
  } catch {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_CANDIDATE_STAGE_FAILED',
    );
  }
  try {
    await options.handoff.prepareConfirmedUpdate();
  } catch (error) {
    throw new W6b2PackagedProofControllerError(
      classifyPreparationFailure(error, options.readRecoveryPointFailureCode),
    );
  }
  try {
    await options.handoff.handoffPreparedUpdate();
  } catch {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_INSTALLER_HANDOFF_FAILED',
    );
  }
  if (!options.isQuitRequested()) {
    throw new W6b2PackagedProofControllerError(
      'W6B2_PROOF_QUIT_REQUEST_MISSING',
    );
  }
  return success(options.configuration.phase, 'completed');
}

function classifyPreparationFailure(
  error: unknown,
  readRecoveryPointFailureCode: () => string | undefined,
): W6b2PackagedProofErrorCode {
  if (!(error instanceof LocalUpdateHandoffError)) {
    return 'W6B2_PROOF_PREPARATION_FAILED';
  }
  switch (error.code) {
    case 'UPDATE_PREPARATION_MAINTENANCE_FAILED':
      return 'W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED';
    case 'UPDATE_PREPARATION_JOURNAL_FAILED':
      return 'W6B2_PROOF_PREPARATION_JOURNAL_FAILED';
    case 'UPDATE_PREPARATION_PACKAGE_FAILED':
      return 'W6B2_PROOF_PREPARATION_PACKAGE_FAILED';
    case 'UPDATE_PREPARATION_PROFILE_FAILED':
      return 'W6B2_PROOF_PREPARATION_PROFILE_FAILED';
    case 'UPDATE_PREPARATION_RECOVERY_POINT_FAILED':
      return classifyRecoveryPointFailure(readRecoveryPointFailureCode);
    case 'UPDATE_HANDOFF_FAILED':
      return 'W6B2_PROOF_PREPARATION_FAILED';
  }
}

function classifyRecoveryPointFailure(
  readRecoveryPointFailureCode: () => string | undefined,
): W6b2PackagedProofErrorCode {
  let code: string | undefined;
  try {
    code = readRecoveryPointFailureCode();
  } catch {
    return 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_FAILED';
  }
  if (code === 'RECOVERY_POINT_BUSY') {
    return 'W6B2_PROOF_PREPARATION_CONCURRENCY_FAILED';
  }
  if (code === 'RECOVERY_POINT_SOURCE_UNHEALTHY') {
    return 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SOURCE_FAILED';
  }
  if (code !== undefined && recoveryPointProtectionFailureCodes.has(code)) {
    return 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_PROTECTION_FAILED';
  }
  const snapshotFailureCode =
    code === undefined
      ? undefined
      : recoveryPointSnapshotFailureCodes.get(code);
  if (snapshotFailureCode !== undefined) {
    return snapshotFailureCode;
  }
  if (code !== undefined && recoveryPointStorageFailureCodes.has(code)) {
    return 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED';
  }
  return 'W6B2_PROOF_PREPARATION_RECOVERY_POINT_FAILED';
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
