import { basename, dirname, resolve } from 'node:path';
import { CLEAN_COMMAND_ERROR_CODES } from './cleanInstallUninstallFailureBoundary.mjs';
import { CLEAN_INSTALL_UNINSTALL_SCENARIO as SCENARIO } from './cleanInstallUninstallContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export const CLEAN_CALLER_RESULT_MAX_BYTES = 8192;
const PREFIX = 'eky-clean-caller-';
const SHA = /^[0-9a-f]{64}$/;
const invalid = () => { throw new Error('callerResultInvalid'); };
const plain = (value) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string' &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const FLAGS = ['processTreeAbsent', 'productProcessAbsent', 'fixtureRemoved', 'businessDataPreserved',
  'installedStateValidated', 'uninstalledStateValidated', 'repairValidated', 'reinstallValidated', 'payloadValidated'];
const CODES = {
  fixtureCleanupResultCode: ['retainedUnverified', 'fixtureRemoved', 'fixtureCleanupFailed'],
  supervisorProcessResultCode: ['deadlineExceeded', 'jobAssignFailed', 'jobConfigureFailed', 'jobCreateFailed',
    'jobHandlePolicyFailed', 'jobQueryFailed', 'jobWaitFailed', 'platformUnsupported', 'processCompleted',
    'processExitFailed', 'processExitReadFailed', 'processResumeFailed', 'processStartFailed',
    'processStateInvalid', 'processWaitFailed', 'unexpectedFailure'],
  supervisorWorkerResultCode: ['notChecked', 'workerReportedFailure', 'workerResultBindingInvalid',
    'workerResultInvalid', 'workerResultMissing', 'workerResultValidated'],
  supervisorCleanupResultCode: ['cleanupFailed', 'cleanupUnverified', 'notRequired', 'processTreeAbsent'],
  scenarioResultCode: ['notAvailable', 'missingOrInvalid', 'cleanInstallUninstallCompleted', 'cleanInstallUninstallFailed'],
  productStateVerificationResultCode: ['notChecked', 'notRequired', 'exactProductPresent', 'exactProductAbsent',
    'exactProductAbsentAfterCleanup', 'productStateVerificationFailed', 'productStateVerificationTimedOut', 'productStateVerificationProcessRemains'],
  semanticCleanupResultCode: ['notRequired', 'cleanupCompleted', 'cleanupFailed', 'blockedByPrecondition',
    'blockedByOwnedProcessTree', 'semanticCleanupCompleted', 'semanticCleanupFailed', 'semanticCleanupTimedOut',
    'semanticCleanupProcessRemains', 'semanticCleanupPostconditionFailed'],
};
const KEYS = ['schemaVersion', 'scenario', 'status', 'resultCode', 'errorCode', 'safetyErrorCode',
  'appVersion', 'packageSha256', 'profileFileCountBefore', 'profileFileCountAfter', 'installExitCode', 'uninstallExitCode',
  ...FLAGS, ...Object.keys(CODES)];

export function validateCleanCallerBinding(value) {
  if (!exact(value, ['schemaVersion', 'invocationId', 'scenario', 'buildRevision', 'artifactDescriptorSha256']) ||
    value.schemaVersion !== 1 || value.scenario !== SCENARIO || typeof value.invocationId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.invocationId) || typeof value.buildRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(value.buildRevision) || typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA.test(value.artifactDescriptorSha256)) invalid();
  return Object.freeze({ ...value });
}
export function cleanCallerResultIdentity(path, expected) {
  path = parseAbsoluteWindowsAcceptancePath(path, 'callerResultInvalid');
  if (basename(path) !== 'result.json' || !new RegExp(`^${PREFIX}[0-9a-f]{32}$`).test(basename(dirname(path)))) invalid();
  return validateCleanCallerBinding({ schemaVersion: 1, scenario: SCENARIO,
    invocationId: basename(dirname(path)).slice(PREFIX.length), buildRevision: expected.buildRevision,
    artifactDescriptorSha256: expected.artifactDescriptorSha256 });
}
export function parseCleanCallerArguments(args) {
  if (args.length !== 8 || args[0] !== '--artifact-descriptor' || args[2] !== '--expected-descriptor-sha256' ||
    args[4] !== '--expected-build-revision' || args[6] !== '--result-path') invalid();
  const descriptorPath = parseAbsoluteWindowsAcceptancePath(args[1], 'callerResultInvalid');
  const resultPath = resolve(parseAbsoluteWindowsAcceptancePath(args[7], 'callerResultInvalid'));
  return { descriptorPath, resultPath, binding: cleanCallerResultIdentity(resultPath, {
    artifactDescriptorSha256: args[3], buildRevision: args[5] }) };
}
export function validateCleanCallerResult(value, expected) {
  validateCleanCallerBinding(expected);
  if (!exact(value, ['binding', 'outcome'])) invalid();
  const binding = validateCleanCallerBinding(value.binding);
  if (Object.keys(expected).some((key) => binding[key] !== expected[key])) invalid();
  const o = value.outcome;
  if (!plain(o) || Object.keys(o).some((key) => !KEYS.includes(key)) ||
    o.schemaVersion !== 1 || o.scenario !== SCENARIO || !['completed', 'failed'].includes(o.status)) invalid();
  for (const [key, data] of Object.entries(o)) {
    if (CODES[key] && !CODES[key].includes(data)) invalid();
    if (FLAGS.includes(key) && typeof data !== 'boolean') invalid();
    if (['errorCode', 'safetyErrorCode'].includes(key) && data !== null && !CLEAN_COMMAND_ERROR_CODES.includes(data)) invalid();
    if (key === 'packageSha256' && (typeof data !== 'string' || !SHA.test(data))) invalid();
    if (key === 'appVersion' && (typeof data !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(data))) invalid();
    if (['profileFileCountBefore', 'profileFileCountAfter'].includes(key) && (!Number.isSafeInteger(data) || data < 0)) invalid();
    if (['installExitCode', 'uninstallExitCode'].includes(key) && data !== null &&
      (!Number.isInteger(data) || data < -2147483648 || data > 2147483647)) invalid();
    if (key === 'resultCode' && data !== 'cleanInstallUninstallCompleted') invalid();
  }
  if (o.fixtureRemoved === true && (o.processTreeAbsent !== true || o.productProcessAbsent !== true ||
    o.fixtureCleanupResultCode !== 'fixtureRemoved' || o.safetyErrorCode != null ||
    !['exactProductAbsent', 'exactProductAbsentAfterCleanup'].includes(o.productStateVerificationResultCode) ||
    !['notRequired', 'semanticCleanupCompleted'].includes(o.semanticCleanupResultCode))) invalid();
  if (o.status === 'failed') {
    if (!CLEAN_COMMAND_ERROR_CODES.includes(o.errorCode)) invalid();
  } else if (o.resultCode !== 'cleanInstallUninstallCompleted' || o.errorCode != null || o.safetyErrorCode != null ||
    FLAGS.some((key) => o[key] !== true) || o.installExitCode !== 0 || o.uninstallExitCode !== 0 ||
    o.supervisorProcessResultCode !== 'processCompleted' || o.supervisorWorkerResultCode !== 'workerResultValidated' ||
    !['notRequired', 'processTreeAbsent'].includes(o.supervisorCleanupResultCode) ||
    o.scenarioResultCode !== 'cleanInstallUninstallCompleted' || !o.appVersion || !SHA.test(o.packageSha256) ||
    !Number.isSafeInteger(o.profileFileCountBefore) || o.profileFileCountBefore !== o.profileFileCountAfter) invalid();
  return Object.freeze({ binding: expected, outcome: Object.freeze({ ...o }) });
}
export function parseCleanCallerResult(bytes, expected) {
  return validateCleanCallerResult(parseStrictJsonObjectBytes(bytes, {
    maximumBytes: CLEAN_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid' }), expected);
}
