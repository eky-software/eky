import { randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const UPGRADE_ROLLBACK_SCENARIO = 'upgradeRollback';

const SAFE_CODE_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const REQUEST_KEYS = [
  'artifactDescriptorSha256',
  'fixtureRoot',
  'runNonce',
  'scenario',
  'schemaVersion',
];
const RESULT_KEYS = [
  'artifactBytesValidated',
  'artifactDescriptorSha256',
  'binaryRollbackExitCode',
  'binaryRollbackRestoredSource',
  'cleanupResultCode',
  'downgradeExitCode',
  'downgradeRejected',
  'errorCode',
  'finalStateValidated',
  'finalUninstallExitCode',
  'majorUpgradeValidated',
  'resultCode',
  'runNonce',
  'scenario',
  'schemaVersion',
  'sourceInstallExitCode',
  'sourceInstalledStateValidated',
  'status',
  'upgradeExitCode',
  'windowsInstallerRollbackExitCode',
  'windowsInstallerRollbackRestoredSource',
];

function isRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

function validExitCode(value) {
  return (
    value === null ||
    (Number.isInteger(value) &&
      value >= -2_147_483_648 &&
      value <= 2_147_483_647)
  );
}

export function createUpgradeRollbackWorkerRequest({
  artifactDescriptorSha256,
  fixtureRoot,
  runNonce = randomBytes(32).toString('hex'),
}) {
  return validateUpgradeRollbackWorkerRequest({
    schemaVersion: 1,
    runNonce,
    scenario: UPGRADE_ROLLBACK_SCENARIO,
    artifactDescriptorSha256,
    fixtureRoot,
  });
}

export function validateUpgradeRollbackWorkerRequest(value) {
  if (
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.schemaVersion !== 1 ||
    value.scenario !== UPGRADE_ROLLBACK_SCENARIO ||
    typeof value.runNonce !== 'string' ||
    !SHA_256_PATTERN.test(value.runNonce) ||
    typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.artifactDescriptorSha256) ||
    typeof value.fixtureRoot !== 'string' ||
    value.fixtureRoot.includes('\0') ||
    !isAbsolute(value.fixtureRoot) ||
    resolve(value.fixtureRoot) !== value.fixtureRoot
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_REQUEST_INVALID');
  }
  return Object.freeze({ ...value });
}

export function validateUpgradeRollbackResult(value, expected) {
  if (
    !hasExactKeys(value, RESULT_KEYS) ||
    value.schemaVersion !== 1 ||
    value.runNonce !== expected.runNonce ||
    value.scenario !== UPGRADE_ROLLBACK_SCENARIO ||
    value.artifactDescriptorSha256 !== expected.artifactDescriptorSha256 ||
    typeof value.resultCode !== 'string' ||
    !SAFE_CODE_PATTERN.test(value.resultCode) ||
    (value.errorCode !== null &&
      (typeof value.errorCode !== 'string' ||
        !SAFE_CODE_PATTERN.test(value.errorCode))) ||
    !['notRequired', 'cleanupCompleted', 'cleanupFailed'].includes(
      value.cleanupResultCode,
    ) ||
    !validExitCode(value.sourceInstallExitCode) ||
    !validExitCode(value.upgradeExitCode) ||
    !validExitCode(value.downgradeExitCode) ||
    !validExitCode(value.binaryRollbackExitCode) ||
    !validExitCode(value.windowsInstallerRollbackExitCode) ||
    !validExitCode(value.finalUninstallExitCode) ||
    typeof value.sourceInstalledStateValidated !== 'boolean' ||
    typeof value.majorUpgradeValidated !== 'boolean' ||
    typeof value.downgradeRejected !== 'boolean' ||
    typeof value.binaryRollbackRestoredSource !== 'boolean' ||
    typeof value.windowsInstallerRollbackRestoredSource !== 'boolean' ||
    typeof value.finalStateValidated !== 'boolean' ||
    typeof value.artifactBytesValidated !== 'boolean'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID');
  }

  if (
    value.status === 'completed' &&
    value.resultCode === 'upgradeRollbackCompleted' &&
    value.errorCode === null &&
    value.cleanupResultCode === 'notRequired' &&
    value.sourceInstallExitCode === 0 &&
    value.upgradeExitCode === 0 &&
    value.downgradeExitCode !== 0 &&
    ![1641, 3010].includes(value.downgradeExitCode) &&
    value.binaryRollbackExitCode === 0 &&
    value.windowsInstallerRollbackExitCode !== 0 &&
    ![1641, 3010].includes(value.windowsInstallerRollbackExitCode) &&
    value.finalUninstallExitCode === 0 &&
    value.sourceInstalledStateValidated &&
    value.majorUpgradeValidated &&
    value.downgradeRejected &&
    value.binaryRollbackRestoredSource &&
    value.windowsInstallerRollbackRestoredSource &&
    value.finalStateValidated &&
    value.artifactBytesValidated
  ) {
    return Object.freeze({ ...value });
  }
  if (
    value.status !== 'failed' ||
    value.resultCode !== 'upgradeRollbackFailed' ||
    value.errorCode === null
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_RESULT_INVALID');
  }
  return Object.freeze({ ...value });
}

async function readStrictObject(path, errorCode) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1n ||
      metadata.size < 2n ||
      metadata.size > 64n * 1024n
    ) {
      throw new Error(errorCode);
    }
    return parseStrictJsonObjectBytes(await readFile(path), { errorCode });
  } catch {
    throw new Error(errorCode);
  }
}

export async function readUpgradeRollbackWorkerRequest(path) {
  return validateUpgradeRollbackWorkerRequest(
    await readStrictObject(path, 'WINDOWS_ACCEPTANCE_UPGRADE_REQUEST_INVALID'),
  );
}

export async function readUpgradeRollbackResult(path, expected) {
  try {
    return validateUpgradeRollbackResult(
      await readStrictObject(
        path,
        'WINDOWS_ACCEPTANCE_UPGRADE_RESULT_MISSING_OR_INVALID',
      ),
      expected,
    );
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_RESULT_MISSING_OR_INVALID');
  }
}

export function createUpgradeRollbackWorkerTerminalResult(request, result) {
  return Object.freeze({
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: result.status,
    resultCode:
      result.status === 'completed'
        ? 'upgradeRollbackCompleted'
        : 'upgradeRollbackFailed',
    errorCode: result.errorCode,
  });
}

export function upgradeRollbackResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'upgrade-rollback-result.json');
}

export function upgradeRollbackWorkerResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'worker-result.json');
}

export { writeJsonAtomicExclusive };
