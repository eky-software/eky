import { readFile } from 'node:fs/promises';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const SCENARIO_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const EXACT_RESULT_KEYS = [
  'artifactDescriptorSha256',
  'childExitCode',
  'cleanupResultCode',
  'cleanupWin32ErrorCode',
  'durationMs',
  'processResultCode',
  'processTreeAbsent',
  'processWin32ErrorCode',
  'runNonce',
  'scenario',
  'schemaVersion',
  'status',
  'workerResultCode',
];
const PROCESS_FAILURE_CODES = new Set([
  'deadlineExceeded',
  'jobAssignFailed',
  'jobConfigureFailed',
  'jobCreateFailed',
  'jobHandlePolicyFailed',
  'jobQueryFailed',
  'jobWaitFailed',
  'platformUnsupported',
  'processCompleted',
  'processExitFailed',
  'processExitReadFailed',
  'processResumeFailed',
  'processStartFailed',
  'processStateInvalid',
  'processWaitFailed',
  'unexpectedFailure',
]);
const WORKER_RESULT_CODES = new Set([
  'notChecked',
  'workerReportedFailure',
  'workerResultBindingInvalid',
  'workerResultInvalid',
  'workerResultMissing',
  'workerResultValidated',
]);
const CLEANUP_CODES = new Set([
  'cleanupFailed',
  'cleanupUnverified',
  'notRequired',
  'processTreeAbsent',
]);

function isOptionalWin32ErrorCode(value) {
  return (
    value === null ||
    (Number.isInteger(value) && value >= 0 && value <= 2_147_483_647)
  );
}

function fail(code) {
  throw new Error(code);
}

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireExactKeys(value) {
  const keys = Object.keys(value).sort();
  if (
    keys.length !== EXACT_RESULT_KEYS.length ||
    keys.some((key, index) => key !== EXACT_RESULT_KEYS[index])
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID');
  }
}

export function validateWindowsAcceptanceSupervisorResult(value, expected) {
  if (!isPlainObject(value) || !isPlainObject(expected)) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID');
  }
  requireExactKeys(value);

  if (
    value.schemaVersion !== 1 ||
    typeof value.runNonce !== 'string' ||
    !SHA_256_PATTERN.test(value.runNonce) ||
    typeof value.scenario !== 'string' ||
    !SCENARIO_PATTERN.test(value.scenario) ||
    typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.artifactDescriptorSha256) ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 14_400_000 ||
    (value.childExitCode !== null &&
      (!Number.isInteger(value.childExitCode) ||
        value.childExitCode < -2_147_483_648 ||
        value.childExitCode > 2_147_483_647)) ||
    !isOptionalWin32ErrorCode(value.processWin32ErrorCode) ||
    !isOptionalWin32ErrorCode(value.cleanupWin32ErrorCode) ||
    typeof value.processTreeAbsent !== 'boolean'
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID');
  }

  if (
    value.runNonce !== expected.runNonce ||
    value.scenario !== expected.scenario ||
    value.artifactDescriptorSha256 !== expected.artifactDescriptorSha256
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_BINDING_INVALID');
  }

  if (value.status === 'completed') {
    if (
      value.processResultCode !== 'processCompleted' ||
      value.workerResultCode !== 'workerResultValidated' ||
      value.cleanupResultCode !== 'notRequired' ||
      value.processTreeAbsent !== true ||
      value.childExitCode !== 0 ||
      value.processWin32ErrorCode !== null ||
      value.cleanupWin32ErrorCode !== null ||
      expected.supervisorExitCode !== 0
    ) {
      fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
    }
    return Object.freeze({ ...value });
  }

  if (
    value.status !== 'failed' ||
    !PROCESS_FAILURE_CODES.has(value.processResultCode) ||
    !WORKER_RESULT_CODES.has(value.workerResultCode) ||
    !CLEANUP_CODES.has(value.cleanupResultCode) ||
    expected.supervisorExitCode !== 1
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
  }

  if (
    value.processTreeAbsent !==
      (value.cleanupResultCode === 'notRequired' ||
        value.cleanupResultCode === 'processTreeAbsent')
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
  }
  if (
    value.cleanupResultCode !== 'cleanupFailed' &&
    value.cleanupWin32ErrorCode !== null
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
  }

  if (
    value.processResultCode === 'processExitFailed' &&
    (value.childExitCode === null || value.childExitCode === 0)
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
  }
  if (
    (value.processResultCode === 'processCompleted' &&
      (value.childExitCode !== 0 ||
        value.workerResultCode === 'notChecked' ||
        value.workerResultCode === 'workerResultValidated')) ||
    (value.processResultCode !== 'processCompleted' &&
      value.workerResultCode !== 'notChecked')
  ) {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
  }

  return Object.freeze({ ...value });
}

export async function readWindowsAcceptanceSupervisorResult(
  resultPath,
  expected,
) {
  let serialized;
  try {
    serialized = await readFile(resultPath, 'utf8');
  } catch {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING');
  }

  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    fail('WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID');
  }
  return validateWindowsAcceptanceSupervisorResult(value, expected);
}
