import { basename, dirname, resolve } from 'node:path';
import { UPGRADE_COMMAND_ERROR_CODES } from './upgradeRollbackFailureBoundary.mjs';
import { validateUpgradeRollbackResult } from './upgradeRollbackContracts.mjs';
import { validateRunningUpgradeObservation } from './runningUpgradeObservation.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export const UPGRADE_CALLER_RESULT_MAX_BYTES = 16384;
const SCENARIO = 'upgradeRollback', PREFIX = 'eky-upgrade-caller-', SHA = /^[0-9a-f]{64}$/;
const invalid = () => { throw new Error('callerResultInvalid'); };
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string' &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const FLAGS = ['processTreeAbsent', 'productProcessAbsent', 'fixtureRemoved', 'businessDataPreserved'];
const STATES = ['notChecked', 'exactProductsAbsent', 'exactProductsAbsentAfterCleanup', 'installerRegistryPresent',
  'sourceProductPresent', 'targetProductPresent', 'multipleProductsPresent', 'productStateVerificationFailed',
  'productStateVerificationTimedOut', 'productStateVerificationProcessRemains'];
const CODES = {
  fixtureCleanupResultCode: ['retainedUnverified', 'fixtureRemoved', 'fixtureCleanupFailed'],
  supervisorProcessResultCode: ['deadlineExceeded', 'jobAssignFailed', 'jobConfigureFailed', 'jobCreateFailed',
    'jobHandlePolicyFailed', 'jobQueryFailed', 'jobWaitFailed', 'platformUnsupported', 'processCompleted',
    'processExitFailed', 'processExitReadFailed', 'processResumeFailed', 'processStartFailed',
    'processStateInvalid', 'processWaitFailed', 'unexpectedFailure'],
  supervisorWorkerResultCode: ['notChecked', 'workerReportedFailure', 'workerResultBindingInvalid',
    'workerResultInvalid', 'workerResultMissing', 'workerResultValidated'],
  supervisorCleanupResultCode: ['cleanupFailed', 'cleanupUnverified', 'notRequired', 'processTreeAbsent'],
  applicationCleanupResultCode: ['notChecked', 'notRequired', 'completed', 'cleanupUnverified'],
  scenarioResultCode: ['notAvailable', 'missingOrInvalid', 'upgradeRollbackCompleted', 'upgradeRollbackFailed'],
  initialProductStateResultCode: STATES, postconditionResultCode: STATES,
  semanticCleanupResultCode: ['notRequired', 'blockedByPrecondition', 'blockedByOwnedProcessTree', 'semanticCleanupCompleted',
    'semanticCleanupFailed', 'semanticCleanupTimedOut', 'semanticCleanupProcessRemains', 'productStateVerificationFailed'],
};
const KEYS = ['schemaVersion', 'scenario', 'status', 'resultCode', 'errorCode', 'safetyErrorCode', 'scenarioProof',
  'sourceVersion', 'targetVersion', 'sourcePackageSha256', 'targetPackageSha256', 'windowsRollbackPackageSha256',
  'profileFileCountBefore', 'profileFileCountAfter', 'upgradeExitCode', 'runningUpgradeInitialExitCode', 'runningUpgradeObservation',
  ...FLAGS, ...Object.keys(CODES)];

export function validateUpgradeCallerBinding(value) {
  if (!exact(value, ['schemaVersion', 'invocationId', 'scenario', 'buildRevision', 'artifactDescriptorSha256']) ||
    value.schemaVersion !== 1 || value.scenario !== SCENARIO || typeof value.invocationId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.invocationId) || typeof value.buildRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(value.buildRevision) || typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA.test(value.artifactDescriptorSha256)) invalid();
  return Object.freeze({ ...value });
}
export function upgradeCallerResultIdentity(path, expected) {
  path = parseAbsoluteWindowsAcceptancePath(path, 'callerResultInvalid');
  if (basename(path) !== 'result.json' || !new RegExp(`^${PREFIX}[0-9a-f]{32}$`).test(basename(dirname(path)))) invalid();
  return validateUpgradeCallerBinding({ schemaVersion: 1, scenario: SCENARIO,
    invocationId: basename(dirname(path)).slice(PREFIX.length), buildRevision: expected.buildRevision,
    artifactDescriptorSha256: expected.artifactDescriptorSha256 });
}
export function parseUpgradeCallerArguments(args) {
  if (args.length !== 8 || args[0] !== '--artifact-descriptor' || args[2] !== '--expected-descriptor-sha256' ||
    args[4] !== '--expected-build-revision' || args[6] !== '--result-path') invalid();
  const descriptorPath = parseAbsoluteWindowsAcceptancePath(args[1], 'callerResultInvalid');
  if (basename(descriptorPath) !== 'upgrade-rollback-artifact.json') invalid();
  const resultPath = resolve(parseAbsoluteWindowsAcceptancePath(args[7], 'callerResultInvalid'));
  return { descriptorPath, resultPath, binding: upgradeCallerResultIdentity(resultPath, {
    artifactDescriptorSha256: args[3], buildRevision: args[5] }) };
}
export function validateUpgradeCallerResult(value, expected) {
  validateUpgradeCallerBinding(expected);
  if (!exact(value, ['binding', 'outcome'])) invalid();
  const binding = validateUpgradeCallerBinding(value.binding);
  if (Object.keys(expected).some((key) => binding[key] !== expected[key])) invalid();
  const o = value.outcome;
  if (!plain(o) || Object.keys(o).some((key) => !KEYS.includes(key)) ||
    o.schemaVersion !== 1 || o.scenario !== SCENARIO || !['completed', 'failed'].includes(o.status)) invalid();
  for (const [key, data] of Object.entries(o)) {
    if (CODES[key] && !CODES[key].includes(data)) invalid();
    if (FLAGS.includes(key) && typeof data !== 'boolean') invalid();
    if (['errorCode', 'safetyErrorCode'].includes(key) && data !== null && !UPGRADE_COMMAND_ERROR_CODES.includes(data)) invalid();
    if (key.endsWith('PackageSha256') && (typeof data !== 'string' || !SHA.test(data))) invalid();
    if (['sourceVersion', 'targetVersion'].includes(key) && (typeof data !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(data))) invalid();
    if (['profileFileCountBefore', 'profileFileCountAfter'].includes(key) && (!Number.isSafeInteger(data) || data < 0)) invalid();
    if (['upgradeExitCode', 'runningUpgradeInitialExitCode'].includes(key) && data !== null &&
      (!Number.isInteger(data) || data < -2147483648 || data > 2147483647)) invalid();
    if (key === 'runningUpgradeObservation') validateRunningUpgradeObservation(data);
    if (key === 'resultCode' && data !== 'upgradeRollbackCompleted') invalid();
    if (key === 'scenarioProof') {
      if (!plain(data) || !SHA.test(data.runNonce)) invalid();
      validateUpgradeRollbackResult(data, { runNonce: data.runNonce, artifactDescriptorSha256: binding.artifactDescriptorSha256 });
    }
  }
  if (o.fixtureRemoved === true && (o.processTreeAbsent !== true || o.productProcessAbsent !== true ||
    o.fixtureCleanupResultCode !== 'fixtureRemoved' || o.safetyErrorCode != null || o.applicationCleanupResultCode === 'cleanupUnverified' ||
    !['exactProductsAbsent', 'exactProductsAbsentAfterCleanup'].includes(o.postconditionResultCode) ||
    !['notRequired', 'semanticCleanupCompleted'].includes(o.semanticCleanupResultCode))) invalid();
  if (o.status === 'failed') {
    if (!UPGRADE_COMMAND_ERROR_CODES.includes(o.errorCode)) invalid();
  } else if (o.resultCode !== 'upgradeRollbackCompleted' || o.errorCode != null || o.safetyErrorCode != null ||
    FLAGS.some((key) => o[key] !== true) || o.upgradeExitCode !== 0 || ![0, 1603].includes(o.runningUpgradeInitialExitCode) ||
    o.supervisorProcessResultCode !== 'processCompleted' || o.supervisorWorkerResultCode !== 'workerResultValidated' ||
    !['notRequired', 'processTreeAbsent'].includes(o.supervisorCleanupResultCode) || o.applicationCleanupResultCode !== 'completed' ||
    o.scenarioResultCode !== 'upgradeRollbackCompleted' || o.scenarioProof?.status !== 'completed' ||
    o.initialProductStateResultCode !== 'exactProductsAbsent' || o.postconditionResultCode !== 'exactProductsAbsent' ||
    o.semanticCleanupResultCode !== 'notRequired' ||
    o.runningUpgradeInitialExitCode !== o.scenarioProof.runningUpgradeInitialExitCode ||
    JSON.stringify(o.runningUpgradeObservation) !== JSON.stringify(o.scenarioProof.runningUpgradeObservation) ||
    !o.sourceVersion || !o.targetVersion || ['source', 'target', 'windowsRollback'].some((role) => !SHA.test(o[`${role}PackageSha256`])) ||
    !Number.isSafeInteger(o.profileFileCountBefore) || o.profileFileCountBefore !== o.profileFileCountAfter) invalid();
  return Object.freeze({ binding: expected, outcome: Object.freeze({ ...o }) });
}
export function parseUpgradeCallerResult(bytes, expected) {
  return validateUpgradeCallerResult(parseStrictJsonObjectBytes(bytes, {
    maximumBytes: UPGRADE_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid' }), expected);
}
