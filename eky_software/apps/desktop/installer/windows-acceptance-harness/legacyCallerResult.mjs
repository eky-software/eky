import { basename, dirname, resolve } from 'node:path';
import { LEGACY_COMMAND_ERROR_CODES } from './legacyUpgradeFailureBoundary.mjs';
import { LEGACY_UPGRADE_SCENARIO } from './legacyUpgradeContracts.mjs';
import { LEGACY_SEMANTIC_POSTCONDITION_FAILURE_CODES } from './legacyUpgradePostcondition.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export const LEGACY_CALLER_RESULT_MAX_BYTES = 8192;
const PREFIX = 'eky-legacy-caller-';
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const ERRORS = new Set(LEGACY_COMMAND_ERROR_CODES);
const PRODUCT = ['notChecked', 'sourceProductPresent', 'targetProductPresent', 'multipleProductsPresent',
  'installerRegistryPresent', 'exactProductsAbsent', 'exactProductsAbsentAfterCleanup',
  'productStateVerificationFailed', 'productStateVerificationTimedOut', 'productStateVerificationProcessRemains'];
const CODES = {
  phaseWriterResultCode: ['notStarted', 'writerAbsent', 'writerExitUnverified'],
  phaseDiagnosticResultCode: ['notSent', 'channelFailed', 'messagesDropped', 'deliveryUnverified'],
  supervisorProcessResultCode: ['deadlineExceeded', 'jobAssignFailed', 'jobConfigureFailed', 'jobCreateFailed',
    'jobHandlePolicyFailed', 'jobQueryFailed', 'jobWaitFailed', 'platformUnsupported', 'processCompleted',
    'processExitFailed', 'processExitReadFailed', 'processResumeFailed', 'processStartFailed',
    'processStateInvalid', 'processWaitFailed', 'unexpectedFailure'],
  supervisorWorkerResultCode: ['notChecked', 'workerReportedFailure', 'workerResultBindingInvalid',
    'workerResultInvalid', 'workerResultMissing', 'workerResultValidated'],
  supervisorCleanupResultCode: ['cleanupFailed', 'cleanupUnverified', 'notRequired', 'processTreeAbsent'],
  scenarioResultCode: ['notAvailable', 'missingOrInvalid', 'historicalLegacyUpgradeCompleted', 'historicalLegacyUpgradeFailed'],
  initialProductStateResultCode: PRODUCT, postconditionResultCode: PRODUCT,
  semanticProofResultCode: ['notChecked', 'legacySemanticProofValidated', ...LEGACY_SEMANTIC_POSTCONDITION_FAILURE_CODES],
  semanticCleanupResultCode: ['notRequired', 'blockedByOwnedProcessTree', 'blockedByPrecondition',
    'semanticCleanupCompleted', 'semanticCleanupFailed', 'semanticCleanupTimedOut', 'semanticCleanupProcessRemains', ...PRODUCT],
  fixtureCleanupResultCode: ['retainedUnverified', 'fixtureRemoved', 'fixtureCleanupFailed'],
};
const BOOLEANS = ['processTreeAbsent', 'fixtureRemoved', 'legacyBusinessFixtureValidated',
  'idempotentSecondStartup', 'businessDataPreserved'];
const COUNTS = ['adoptedWorkspaceCount', 'profileFileCountBefore', 'profileFileCountAfter'];
const KEYS = new Set(['schemaVersion', 'scenario', 'status', 'errorCode', 'safetyErrorCode', 'resultCode',
  'sourceClassification', 'sourceVersion', 'targetVersion', 'sourcePackageSha256', 'targetPackageSha256',
  ...BOOLEANS, ...COUNTS, ...Object.keys(CODES)]);

function invalid() { throw new Error('callerResultInvalid'); }
function plain(value) {
  return value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every((key) =>
    typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function validateLegacyCallerBinding(value) {
  if (!exact(value, ['schemaVersion', 'invocationId', 'scenario', 'buildRevision', 'artifactDescriptorSha256']) ||
    value.schemaVersion !== 1 || value.scenario !== LEGACY_UPGRADE_SCENARIO ||
    typeof value.invocationId !== 'string' || !/^[0-9a-f]{32}$/.test(value.invocationId) ||
    typeof value.buildRevision !== 'string' || !REVISION.test(value.buildRevision) ||
    typeof value.artifactDescriptorSha256 !== 'string' || !SHA.test(value.artifactDescriptorSha256)) invalid();
  return Object.freeze({ ...value });
}
export function legacyCallerResultIdentity(path, expected) {
  path = parseAbsoluteWindowsAcceptancePath(path, 'callerResultInvalid');
  if (basename(path) !== 'result.json' || !new RegExp(`^${PREFIX}[0-9a-f]{32}$`).test(basename(dirname(path)))) invalid();
  return validateLegacyCallerBinding({ schemaVersion: 1, scenario: LEGACY_UPGRADE_SCENARIO,
    invocationId: basename(dirname(path)).slice(PREFIX.length), buildRevision: expected.buildRevision,
    artifactDescriptorSha256: expected.artifactDescriptorSha256 });
}
export function validateLegacyCallerResult(value, expected) {
  validateLegacyCallerBinding(expected);
  if (!exact(value, ['binding', 'outcome'])) invalid();
  const binding = validateLegacyCallerBinding(value.binding);
  if (Object.keys(expected).some((key) => binding[key] !== expected[key])) invalid();
  const outcome = value.outcome;
  if (!plain(outcome) || Object.keys(outcome).some((key) => !KEYS.has(key)) || outcome.schemaVersion !== 1 ||
    outcome.scenario !== LEGACY_UPGRADE_SCENARIO || !['completed', 'failed'].includes(outcome.status)) invalid();
  for (const [key, data] of Object.entries(outcome)) {
    if (CODES[key] && !CODES[key].includes(data)) invalid();
    if (BOOLEANS.includes(key) && typeof data !== 'boolean') invalid();
    if (COUNTS.includes(key) && (!Number.isSafeInteger(data) || data < 0)) invalid();
    if (['errorCode', 'safetyErrorCode'].includes(key) && data !== null && !ERRORS.has(data)) invalid();
    if (['sourcePackageSha256', 'targetPackageSha256'].includes(key) && (typeof data !== 'string' || !SHA.test(data))) invalid();
    if (['sourceVersion', 'targetVersion'].includes(key) && (typeof data !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,5}$/.test(data))) invalid();
    if (key === 'sourceClassification' && !['exact-local-release', 'historical-source-rebuild'].includes(data)) invalid();
    if (key === 'resultCode' && data !== 'historicalLegacyUpgradeCompleted') invalid();
  }
  if (outcome.status === 'failed') {
    if (!ERRORS.has(outcome.errorCode)) invalid();
  } else if (outcome.resultCode !== 'historicalLegacyUpgradeCompleted' || outcome.errorCode != null ||
    outcome.safetyErrorCode != null || outcome.phaseWriterResultCode !== 'writerAbsent' || BOOLEANS.some((key) => outcome[key] !== true) ||
    outcome.supervisorProcessResultCode !== 'processCompleted' || outcome.supervisorWorkerResultCode !== 'workerResultValidated' ||
    !['notRequired', 'processTreeAbsent'].includes(outcome.supervisorCleanupResultCode) ||
    outcome.scenarioResultCode !== 'historicalLegacyUpgradeCompleted' || outcome.semanticProofResultCode !== 'legacySemanticProofValidated' ||
    outcome.semanticCleanupResultCode !== 'semanticCleanupCompleted' || outcome.postconditionResultCode !== 'exactProductsAbsent' ||
    outcome.fixtureCleanupResultCode !== 'fixtureRemoved' ||
    outcome.adoptedWorkspaceCount !== 1 || !Number.isSafeInteger(outcome.profileFileCountBefore) ||
    outcome.profileFileCountBefore !== outcome.profileFileCountAfter ||
    !SHA.test(outcome.sourcePackageSha256) || !SHA.test(outcome.targetPackageSha256) ||
    !['exact-local-release', 'historical-source-rebuild'].includes(outcome.sourceClassification) ||
    !outcome.sourceVersion || !outcome.targetVersion) invalid();
  return Object.freeze({ binding: expected, outcome: Object.freeze({ ...outcome }) });
}
export function parseLegacyCallerResult(bytes, expected) {
  return validateLegacyCallerResult(parseStrictJsonObjectBytes(bytes, {
    maximumBytes: LEGACY_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid',
  }), expected);
}
export function parseLegacyCallerArguments(args, parseScenario) {
  if (args.length !== 8 || args[2] !== '--expected-descriptor-sha256' ||
    args[4] !== '--expected-build-revision' || args[6] !== '--result-path') invalid();
  const scenarioArgs = args.slice(0, 2);
  parseScenario(scenarioArgs);
  const resultPath = resolve(parseAbsoluteWindowsAcceptancePath(args[7], 'callerResultInvalid'));
  return { scenarioArgs, resultPath, binding: legacyCallerResultIdentity(resultPath, {
    artifactDescriptorSha256: args[3], buildRevision: args[5],
  }) };
}
