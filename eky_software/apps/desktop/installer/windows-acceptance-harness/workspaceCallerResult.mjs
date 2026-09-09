import { basename, dirname, resolve } from 'node:path';

import { WORKSPACE_SUCCESS_ERRORS, WORKSPACE_SUCCESS_PHASES } from './workspaceSuccessContracts.mjs';
import { WORKSPACE_FAULT_ERRORS, WORKSPACE_FAULT_PLANS } from './workspaceFaultContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export const WORKSPACE_CALLER_RESULT_FILENAME = 'result.json';
export const WORKSPACE_CALLER_RESULT_PREFIX = 'eky-workspace-caller-';
export const WORKSPACE_CALLER_RESULT_MAX_BYTES = 8192;
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const ERRORS = new Set([...WORKSPACE_SUCCESS_ERRORS, ...WORKSPACE_FAULT_ERRORS,
  'supervisorBinaryInvalid', 'supervisorStartFailed', 'supervisorExitInvalid', 'supervisorResultUnavailable',
  'supervisorDeadlineExceeded', 'supervisorFailed', 'scenarioResultInvalid',
  'productStateVerificationFailed', 'productStateVerificationTimedOut', 'productStateVerificationProcessRemains',
  'semanticCleanupFailed', 'semanticCleanupTimedOut', 'semanticCleanupProcessRemains',
  'productRemovalUnverified', 'installerFootprintUnverified', 'artifactChanged', 'normalProfileChanged',
  'fixtureCleanupFailed', 'phaseWriterExitUnverified', 'commandCancelled', 'productProcessUnverified',
]);
const CODES = {
  supervisorProcessResultCode: ['notAvailable', 'deadlineExceeded', 'jobAssignFailed', 'jobConfigureFailed',
    'jobCreateFailed', 'jobHandlePolicyFailed', 'jobQueryFailed', 'jobWaitFailed', 'platformUnsupported',
    'processCompleted', 'processExitFailed', 'processExitReadFailed', 'processResumeFailed', 'processStartFailed',
    'processStateInvalid', 'processWaitFailed', 'unexpectedFailure'],
  supervisorWorkerResultCode: ['notAvailable', 'notChecked', 'workerReportedFailure', 'workerResultBindingInvalid',
    'workerResultInvalid', 'workerResultMissing', 'workerResultValidated'],
  supervisorCleanupResultCode: ['notAvailable', 'cleanupFailed', 'cleanupUnverified', 'notRequired', 'processTreeAbsent'],
  scenarioResultCode: ['notChecked', 'missingOrInvalid', 'workspaceSuccessCompleted', 'workspaceSuccessFailed',
    'workspaceFaultCompleted', 'workspaceFaultFailed'],
  semanticProofResultCode: ['notChecked', 'workspaceSemanticProofValidated', 'workspaceSemanticProofFailed',
    'workspaceFaultSemanticProofValidated', 'workspaceFaultSemanticProofFailed'],
  sessionProofResultCode: ['notChecked', 'workspaceFaultSessionsValidated', 'workspaceFaultSessionsFailed'],
  semanticCleanupResultCode: ['notRequired', 'blockedByOwnedProcessTree', 'blockedByProductInspection',
    'blockedByPrecondition', 'semanticCleanupCompleted', 'semanticCleanupFailed', 'semanticCleanupTimedOut',
    'semanticCleanupProcessRemains', 'productStateVerificationFailed', 'productStateVerificationTimedOut',
    'productStateVerificationProcessRemains'],
  removalPostconditionResultCode: ['notChecked', 'installerFootprintAbsent', 'installerFootprintUnverified'],
  fixtureCleanupResultCode: ['retainedUnverified', 'fixtureRemoved', 'fixtureCleanupFailed'],
  phaseWriterResultCode: ['writerAbsent', 'writerExitUnverified', 'notStarted'],
  phaseDiagnosticResultCode: ['notSent', 'channelFailed', 'messagesDropped', 'deliveryUnverified'],
};
const PRODUCT_CODES = ['notChecked', 'multipleProductsPresent', 'sourceProductPresent', 'targetProductPresent',
  'installerRegistryPresent', 'exactProductsAbsent', 'productStateVerificationFailed',
  'productStateVerificationTimedOut', 'productStateVerificationProcessRemains'];
CODES.initialProductStateResultCode = PRODUCT_CODES;
CODES.postconditionResultCode = PRODUCT_CODES;
const HASH_KEYS = ['artifactDescriptorSha256', 'sourcePackageSha256', 'targetPackageSha256'];
const OUTCOME_KEYS = new Set(['schemaVersion', 'scenario', 'faultScenario', 'status', 'errorCode', 'safetyErrorCode',
  'processTreeAbsent', 'productProcessAbsent', 'fixtureRemoved', 'businessDataPreserved', 'profileFileCountBefore', 'profileFileCountAfter',
  'buildRevision', 'failedPhase', ...HASH_KEYS, ...Object.keys(CODES)]);
const PHASES = new Set([...WORKSPACE_SUCCESS_PHASES, ...Object.values(WORKSPACE_FAULT_PLANS).flatMap((plan) => plan.phases)]);

function invalid() { throw new Error('callerResultInvalid'); }
function plain(value) {
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' &&
      Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

export function workspaceCallerResultIdentity(resultPath, input) {
  const path = parseAbsoluteWindowsAcceptancePath(resultPath, 'callerResultInvalid');
  if (basename(path) !== WORKSPACE_CALLER_RESULT_FILENAME ||
    !new RegExp(`^${WORKSPACE_CALLER_RESULT_PREFIX}[0-9a-f]{32}$`).test(basename(dirname(path)))) invalid();
  return validateWorkspaceCallerBinding({ schemaVersion: 1,
    invocationId: basename(dirname(path)).slice(WORKSPACE_CALLER_RESULT_PREFIX.length),
    scenario: input.faultScenario ? 'packagedWorkspaceFaultRollback' : 'packagedWorkspaceSuccess',
    faultScenario: input.faultScenario ?? null, buildRevision: input.expectedBuildRevision,
    artifactDescriptorSha256: input.expectedDescriptorSha256,
  });
}

export function validateWorkspaceCallerBinding(value) {
  if (!exact(value, ['schemaVersion', 'invocationId', 'scenario', 'faultScenario', 'buildRevision', 'artifactDescriptorSha256']) ||
    value.schemaVersion !== 1 || typeof value.invocationId !== 'string' || !/^[0-9a-f]{32}$/.test(value.invocationId) ||
    typeof value.buildRevision !== 'string' || !REVISION.test(value.buildRevision) ||
    typeof value.artifactDescriptorSha256 !== 'string' || !SHA.test(value.artifactDescriptorSha256) ||
    (value.faultScenario === null ? value.scenario !== 'packagedWorkspaceSuccess'
      : value.scenario !== 'packagedWorkspaceFaultRollback' || typeof value.faultScenario !== 'string' ||
        !Object.hasOwn(WORKSPACE_FAULT_PLANS, value.faultScenario))) invalid();
  return Object.freeze({ ...value });
}

export function validateWorkspaceCallerResult(value, expected) {
  validateWorkspaceCallerBinding(expected);
  if (!exact(value, ['binding', 'outcome'])) invalid();
  const binding = validateWorkspaceCallerBinding(value.binding);
  if (Object.keys(expected).some((key) => binding[key] !== expected[key])) invalid();
  const outcome = value.outcome;
  if (!plain(outcome) ||
    Object.keys(outcome).some((key) => !OUTCOME_KEYS.has(key)) || outcome.schemaVersion !== 1 ||
    outcome.scenario !== expected.scenario || (outcome.faultScenario ?? null) !== expected.faultScenario ||
    !['completed', 'failed'].includes(outcome.status) ||
    (outcome.errorCode !== null && !ERRORS.has(outcome.errorCode))) invalid();
  for (const [key, data] of Object.entries(outcome)) {
    if (CODES[key] && !CODES[key].includes(data)) invalid();
    if (HASH_KEYS.includes(key) && (typeof data !== 'string' || !SHA.test(data))) invalid();
    if (key === 'buildRevision' && data !== expected.buildRevision) invalid();
    if (key === 'artifactDescriptorSha256' && data !== expected.artifactDescriptorSha256) invalid();
    if (['processTreeAbsent', 'productProcessAbsent', 'fixtureRemoved', 'businessDataPreserved'].includes(key) && typeof data !== 'boolean') invalid();
    if (['profileFileCountBefore', 'profileFileCountAfter'].includes(key) && data !== null && (!Number.isSafeInteger(data) || data < 0)) invalid();
    if (key === 'failedPhase' && data !== null && !PHASES.has(data)) invalid();
    if (key === 'safetyErrorCode' && data !== null && !ERRORS.has(data)) invalid();
  }
  if (outcome.fixtureRemoved === true && outcome.productProcessAbsent !== true) invalid();
  if (outcome.status === 'failed' ? outcome.errorCode === null :
    outcome.errorCode !== null || outcome.safetyErrorCode !== null || outcome.failedPhase !== null ||
    outcome.processTreeAbsent !== true || outcome.productProcessAbsent !== true || outcome.fixtureRemoved !== true || outcome.businessDataPreserved !== true ||
    outcome.phaseWriterResultCode !== 'writerAbsent' || outcome.fixtureCleanupResultCode !== 'fixtureRemoved' ||
    outcome.supervisorProcessResultCode !== 'processCompleted' || outcome.supervisorWorkerResultCode !== 'workerResultValidated' ||
    !['notRequired', 'processTreeAbsent'].includes(outcome.supervisorCleanupResultCode) ||
    outcome.postconditionResultCode !== 'exactProductsAbsent' || outcome.removalPostconditionResultCode !== 'installerFootprintAbsent' ||
    !['semanticCleanupCompleted', 'notRequired'].includes(outcome.semanticCleanupResultCode) ||
    outcome.semanticProofResultCode !== (expected.faultScenario ? 'workspaceFaultSemanticProofValidated' : 'workspaceSemanticProofValidated') ||
    (expected.faultScenario !== null && outcome.sessionProofResultCode !== 'workspaceFaultSessionsValidated') ||
    outcome.scenarioResultCode !== (expected.faultScenario ? 'workspaceFaultCompleted' : 'workspaceSuccessCompleted') ||
    outcome.buildRevision !== expected.buildRevision || HASH_KEYS.some((key) => !SHA.test(outcome[key])) ||
    !Number.isSafeInteger(outcome.profileFileCountBefore) || outcome.profileFileCountBefore !== outcome.profileFileCountAfter) invalid();
  return Object.freeze({ binding: expected, outcome: Object.freeze({ ...outcome }) });
}

export function parseWorkspaceCallerResult(bytes, expected) {
  return validateWorkspaceCallerResult(parseStrictJsonObjectBytes(bytes, {
    maximumBytes: WORKSPACE_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid',
  }), expected);
}

export function parseWorkspaceCallerCliArguments(args, parseScenario) {
  if (args.length < 4 || args.at(-2) !== '--result-path') invalid();
  const scenarioArgs = args.slice(0, -2);
  const input = parseScenario(scenarioArgs);
  const resultPath = parseAbsoluteWindowsAcceptancePath(args.at(-1), 'callerResultInvalid');
  return { scenarioArgs, resultPath: resolve(resultPath), binding: workspaceCallerResultIdentity(resultPath, input) };
}
