import { randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const WORKSPACE_SUCCESS_SCENARIO = 'packagedWorkspaceSuccess';
export const WORKSPACE_SUCCESS_EXIT_CODES = Object.freeze({ completed: 0, failed: 1, invalidRequest: 64 });
export const WORKSPACE_SUCCESS_PHASES = Object.freeze([
  'preflight', 'artifactBeforeInstall', 'sourceInstall', 'sourcePostcondition',
  'profilePreparation', 'sourceHandoff', 'targetInstall', 'targetFirstStart',
  'switchToB', 'migrateB', 'verifyBFirstStart', 'verifyBRestart',
  'switchToA', 'rejectC', 'artifactAfterStartup',
]);
export const WORKSPACE_SUCCESS_ERRORS = Object.freeze([
  'requestInvalid', 'unexpectedFailure', 'preconditionFailed', 'artifactInvalid',
  'sourceInstallFailed', 'sourceStateInvalid', 'profilePreparationFailed',
  'sourceHandoffFailed', 'targetInstallFailed', 'targetStateInvalid',
  'targetFirstStartFailed', 'switchToBFailed', 'migrationBFailed',
  'firstStartBFailed', 'restartBFailed', 'switchToAFailed', 'rejectionCFailed',
  'proofResultInvalid', 'profileResultInvalid', 'profileEvidenceInvalid', 'sessionProofInvalid', 'electronRuntimeUnavailable',
  'ownedProcessStartFailed', 'ownedProcessExitInvalid', 'productInspectionFailed',
]);
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;

export function hasWorkspaceSuccessExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function workspaceSuccessErrorCode(error, fallback = 'unexpectedFailure') {
  return WORKSPACE_SUCCESS_ERRORS.includes(error?.message) ? error.message : fallback;
}

export function createWorkspaceSuccessRequest(input) {
  return validateWorkspaceSuccessRequest({
    schemaVersion: 1, scenario: WORKSPACE_SUCCESS_SCENARIO,
    runNonce: input.runNonce ?? randomBytes(32).toString('hex'),
    artifactDescriptorSha256: input.artifactDescriptorSha256,
    buildRevision: input.buildRevision, fixtureRoot: resolve(input.fixtureRoot),
  });
}

export function validateWorkspaceSuccessRequest(value) {
  if (
    !hasWorkspaceSuccessExactKeys(value, [
      'schemaVersion', 'scenario', 'runNonce', 'artifactDescriptorSha256', 'buildRevision', 'fixtureRoot',
    ]) || value.schemaVersion !== 1 || value.scenario !== WORKSPACE_SUCCESS_SCENARIO ||
    typeof value.runNonce !== 'string' || !SHA.test(value.runNonce) ||
    typeof value.artifactDescriptorSha256 !== 'string' || !SHA.test(value.artifactDescriptorSha256) ||
    typeof value.buildRevision !== 'string' || !REVISION.test(value.buildRevision) ||
    typeof value.fixtureRoot !== 'string' || value.fixtureRoot.includes('\0') ||
    !isAbsolute(value.fixtureRoot) || resolve(value.fixtureRoot) !== value.fixtureRoot
  ) throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_REQUEST_INVALID');
  return Object.freeze({ ...value });
}

export function validateWorkspaceSuccessResult(value, expected) {
  const invalid = () => { throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_RESULT_INVALID'); };
  if (
    !hasWorkspaceSuccessExactKeys(value, [
      'schemaVersion', 'scenario', 'runNonce', 'artifactDescriptorSha256',
      'status', 'resultCode', 'errorCode', 'completedPhases', 'failedPhase',
    ]) || value.schemaVersion !== 1 || value.scenario !== WORKSPACE_SUCCESS_SCENARIO ||
    value.runNonce !== expected.runNonce || value.artifactDescriptorSha256 !== expected.artifactDescriptorSha256 ||
    !Array.isArray(value.completedPhases) || value.completedPhases.length > WORKSPACE_SUCCESS_PHASES.length ||
    value.completedPhases.some((phase, index) => phase !== WORKSPACE_SUCCESS_PHASES[index])
  ) invalid();
  if (value.status === 'completed') {
    if (value.resultCode !== 'workspaceSuccessCompleted' || value.errorCode !== null ||
      value.failedPhase !== null || value.completedPhases.length !== WORKSPACE_SUCCESS_PHASES.length) invalid();
  } else if (
    value.status !== 'failed' || value.resultCode !== 'workspaceSuccessFailed' ||
    !WORKSPACE_SUCCESS_ERRORS.includes(value.errorCode) ||
    value.failedPhase !== (WORKSPACE_SUCCESS_PHASES[value.completedPhases.length] ?? null) ||
    value.failedPhase === null
  ) invalid();
  return Object.freeze({ ...value, completedPhases: Object.freeze([...value.completedPhases]) });
}

export async function readWorkspaceSuccessObject(path, errorCode, maximumBytes = 128 * 1024) {
  let handle;
  const samePath = (other) => process.platform === 'win32'
    ? other.toLowerCase() === resolve(path).toLowerCase() : other === resolve(path);
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size < 2n || before.size > BigInt(maximumBytes) ||
      !samePath(await realpath(path))) throw new Error(errorCode);
    handle = await open(path, 'r');
    const same = (other) => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
      .every((key) => before[key] === other[key]);
    if (!same(await handle.stat({ bigint: true }))) throw new Error(errorCode);
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (BigInt(length) !== before.size || !same(await handle.stat({ bigint: true })) ||
      !same(await lstat(path, { bigint: true })) || !samePath(await realpath(path))) throw new Error(errorCode);
    return parseStrictJsonObjectBytes(bytes.subarray(0, length), { errorCode });
  } catch { throw new Error(errorCode); }
  finally { await handle?.close().catch(() => { throw new Error(errorCode); }); }
}

export async function readWorkspaceSuccessRequest(path) {
  return validateWorkspaceSuccessRequest(await readWorkspaceSuccessObject(path,
    'WINDOWS_ACCEPTANCE_WORKSPACE_REQUEST_INVALID'));
}

export async function readWorkspaceSuccessResult(path, expected) {
  return validateWorkspaceSuccessResult(await readWorkspaceSuccessObject(path,
    'WINDOWS_ACCEPTANCE_WORKSPACE_RESULT_MISSING_OR_INVALID'), expected);
}

export function workspaceSuccessResultPath(requestPath) {
  return resolve(dirname(requestPath), 'workspace-success-result.json');
}

export function workspaceSuccessWorkerResult(request, result) {
  const validated = validateWorkspaceSuccessResult(result, request);
  return Object.freeze({
    schemaVersion: 1, scenario: request.scenario, runNonce: request.runNonce,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: validated.status, resultCode: validated.resultCode, errorCode: validated.errorCode,
  });
}

export { writeJsonAtomicExclusive };
