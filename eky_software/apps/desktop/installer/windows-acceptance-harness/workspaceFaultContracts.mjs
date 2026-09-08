import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  WORKSPACE_SUCCESS_PROFILE_ERRORS, hasWorkspaceSuccessExactKeys as exactKeys, readWorkspaceSuccessObject,
} from './workspaceSuccessContracts.mjs';

export const WORKSPACE_FAULT_SCENARIO = 'packagedWorkspaceFaultRollback';
export const WORKSPACE_FAULT_EXIT_CODES = Object.freeze({ completed: 0, failed: 1, invalidRequest: 64 });
const BEFORE_FAULT = [
  'preflight', 'artifactBeforeInstall', 'sourceInstall', 'sourcePostcondition',
  'profilePreparation', 'sourceHandoff',
];
const AFTER_FAULT = ['installedPostcondition', 'profileCheckpoint', 'artifactAfterFault'];
function plan(phases, installedRole, verificationOperation) {
  return Object.freeze({ phases: Object.freeze([...BEFORE_FAULT, ...phases, ...AFTER_FAULT]),
    installedRole, verificationOperation });
}

// These are the five existing private application fault paths, not arbitrary
// commands supplied by a caller. Their terminal business proof runs separately.
export const WORKSPACE_FAULT_PLANS = Object.freeze({
  preUpdateRecoveryPointFailure: plan([], 'source', 'verifyPreUpdateFailure'),
  activeWorkspaceFirstStartFailure: plan([
    'targetInstall', 'targetFirstStartFailure', 'businessRollback',
    'sourceRollbackInstall', 'rollbackFirstStart',
  ], 'source', 'verifyActiveRollback'),
  acceptanceInterruption: plan([
    'targetInstall', 'targetAcceptanceInterruption', 'targetAcceptanceRecovery', 'targetAcceptanceRestart',
  ], 'target', 'verifyAcceptanceRecovery'),
  passiveWorkspaceMigrationFailure: plan([
    'targetInstall', 'targetFirstStart', 'switchToB', 'passiveWorkspaceMigrationFailure', 'passiveWorkspaceRecovery',
  ], 'target', 'verifyPassiveRecovery'),
  binaryRollbackFailure: plan([
    'targetInstall', 'targetFirstStartFailure', 'binaryRollbackFailure', 'failedSafeVerification',
  ], 'target', 'verifyBinaryFailedSafe'),
});
export const WORKSPACE_FAULT_ERRORS = Object.freeze([
  'requestInvalid', 'unexpectedFailure', 'preconditionFailed', 'artifactInvalid',
  'sourceInstallFailed', 'sourceStateInvalid', 'profilePreparationFailed',
  'sourceHandoffFailed', 'targetInstallFailed', 'targetStateInvalid',
  'faultProofFailed', 'proofResultInvalid', 'productInspectionFailed',
  'sourceRollbackInstallFailed', 'profileEvidenceInvalid',
  'ownedProcessStartFailed', 'ownedProcessExitInvalid', 'electronRuntimeUnavailable',
  'profileResultInvalid', 'profileResultUnreadable', 'proofResultUnreadable',
  ...Object.values(WORKSPACE_SUCCESS_PROFILE_ERRORS),
  'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
  'W6B2_FAULT_PROOF_HANDOFF_FAILED', 'W6B2_FAULT_PROOF_JOURNAL_STATE_INVALID',
  'W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED', 'W6B2_FAULT_PROOF_SHUTDOWN_FAILED',
  'W6B2_FAULT_PROOF_UNEXPECTED', 'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
]);

export function workspaceFaultPlan(scenario) {
  if (typeof scenario !== 'string' || !Object.hasOwn(WORKSPACE_FAULT_PLANS, scenario)) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_REQUEST_INVALID');
  }
  return WORKSPACE_FAULT_PLANS[scenario];
}

export function workspaceFaultErrorCode(error, fallback = 'unexpectedFailure') {
  return WORKSPACE_FAULT_ERRORS.includes(error?.message) ? error.message
    : WORKSPACE_FAULT_ERRORS.includes(fallback) ? fallback : 'unexpectedFailure';
}

export function createWorkspaceFaultRequest(input) {
  return validateWorkspaceFaultRequest({
    schemaVersion: 1, scenario: WORKSPACE_FAULT_SCENARIO, faultScenario: input.faultScenario,
    runNonce: input.runNonce ?? randomBytes(32).toString('hex'),
    artifactDescriptorSha256: input.artifactDescriptorSha256,
    buildRevision: input.buildRevision, fixtureRoot: resolve(input.fixtureRoot),
  });
}

export function validateWorkspaceFaultRequest(value) {
  if (!exactKeys(value, [
    'schemaVersion', 'scenario', 'faultScenario', 'runNonce', 'artifactDescriptorSha256', 'buildRevision', 'fixtureRoot',
  ]) || value.schemaVersion !== 1 || value.scenario !== WORKSPACE_FAULT_SCENARIO ||
    !['runNonce', 'artifactDescriptorSha256'].every((key) =>
      typeof value[key] === 'string' && /^[0-9a-f]{64}$/.test(value[key])) ||
    typeof value.buildRevision !== 'string' || !/^[0-9a-f]{40}$/.test(value.buildRevision) ||
    typeof value.fixtureRoot !== 'string' || value.fixtureRoot.includes('\0') ||
    !isAbsolute(value.fixtureRoot) || resolve(value.fixtureRoot) !== value.fixtureRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_REQUEST_INVALID');
  }
  workspaceFaultPlan(value.faultScenario);
  return Object.freeze({ ...value });
}

export function validateWorkspaceFaultResult(value, expected) {
  const request = validateWorkspaceFaultRequest(expected);
  const { phases } = workspaceFaultPlan(request.faultScenario);
  const invalid = () => { throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_RESULT_INVALID'); };
  if (!exactKeys(value, [
    'schemaVersion', 'scenario', 'faultScenario', 'runNonce', 'artifactDescriptorSha256',
    'status', 'resultCode', 'errorCode', 'completedPhases', 'failedPhase',
  ]) || value.schemaVersion !== 1 || value.scenario !== WORKSPACE_FAULT_SCENARIO ||
    value.faultScenario !== request.faultScenario || value.runNonce !== request.runNonce ||
    value.artifactDescriptorSha256 !== request.artifactDescriptorSha256 ||
    !Array.isArray(value.completedPhases) || value.completedPhases.length > phases.length ||
    Array.from(value.completedPhases).some((phase, index) => phase !== phases[index])) invalid();
  if (value.status === 'completed') {
    if (value.resultCode !== 'workspaceFaultCompleted' || value.errorCode !== null ||
      value.failedPhase !== null || value.completedPhases.length !== phases.length) invalid();
  } else if (value.status !== 'failed' || value.resultCode !== 'workspaceFaultFailed' ||
    !WORKSPACE_FAULT_ERRORS.includes(value.errorCode) || value.failedPhase === null ||
    value.failedPhase !== phases[value.completedPhases.length]) invalid();
  return Object.freeze({ ...value, completedPhases: Object.freeze([...value.completedPhases]) });
}

export function workspaceFaultWorkerResult(request, value) {
  const result = validateWorkspaceFaultResult(value, request);
  return Object.freeze({ schemaVersion: 1, scenario: request.scenario, runNonce: request.runNonce,
    artifactDescriptorSha256: request.artifactDescriptorSha256, status: result.status,
    resultCode: result.resultCode, errorCode: result.errorCode });
}

export async function readWorkspaceFaultRequest(path) {
  return validateWorkspaceFaultRequest(await readWorkspaceSuccessObject(path,
    'WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_REQUEST_INVALID'));
}

export async function readWorkspaceFaultResult(path, expected) {
  return validateWorkspaceFaultResult(await readWorkspaceSuccessObject(path,
    'WINDOWS_ACCEPTANCE_WORKSPACE_FAULT_RESULT_INVALID'), expected);
}

export function workspaceFaultResultPath(requestPath) {
  return resolve(dirname(requestPath), 'workspace-fault-result.json');
}
