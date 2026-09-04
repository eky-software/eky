import { randomBytes } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const LEGACY_UPGRADE_SCENARIO = 'historicalLegacyUpgrade';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_CODE_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
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
  'errorCode',
  'legacyBusinessFixtureValidated',
  'majorUpgradeValidated',
  'resultCode',
  'runNonce',
  'scenario',
  'schemaVersion',
  'sourceInstallExitCode',
  'sourcePackagedSmokeValidated',
  'sourceStateValidated',
  'status',
  'targetFirstStartupValidated',
  'targetSecondStartupValidated',
  'upgradeExitCode',
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
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expectedKeys.length &&
    actual.every((key, index) => key === expectedKeys[index])
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

export function createLegacyUpgradeWorkerRequest({
  artifactDescriptorSha256,
  fixtureRoot,
  runNonce = randomBytes(32).toString('hex'),
}) {
  return validateLegacyUpgradeWorkerRequest({
    schemaVersion: 1,
    runNonce,
    scenario: LEGACY_UPGRADE_SCENARIO,
    artifactDescriptorSha256,
    fixtureRoot: resolve(fixtureRoot),
  });
}

export function validateLegacyUpgradeWorkerRequest(value) {
  if (
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.schemaVersion !== 1 ||
    value.scenario !== LEGACY_UPGRADE_SCENARIO ||
    typeof value.runNonce !== 'string' ||
    !SHA_256_PATTERN.test(value.runNonce) ||
    typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.artifactDescriptorSha256) ||
    typeof value.fixtureRoot !== 'string' ||
    value.fixtureRoot.includes('\0') ||
    !isAbsolute(value.fixtureRoot) ||
    resolve(value.fixtureRoot) !== value.fixtureRoot
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_REQUEST_INVALID');
  }
  return Object.freeze({ ...value });
}

export function validateLegacyUpgradeResult(value, expected) {
  if (
    !hasExactKeys(value, RESULT_KEYS) ||
    value.schemaVersion !== 1 ||
    value.runNonce !== expected.runNonce ||
    value.scenario !== LEGACY_UPGRADE_SCENARIO ||
    value.artifactDescriptorSha256 !== expected.artifactDescriptorSha256 ||
    typeof value.resultCode !== 'string' ||
    !SAFE_CODE_PATTERN.test(value.resultCode) ||
    (value.errorCode !== null &&
      (typeof value.errorCode !== 'string' ||
        !SAFE_CODE_PATTERN.test(value.errorCode))) ||
    !validExitCode(value.sourceInstallExitCode) ||
    !validExitCode(value.upgradeExitCode) ||
    typeof value.sourceStateValidated !== 'boolean' ||
    typeof value.sourcePackagedSmokeValidated !== 'boolean' ||
    typeof value.legacyBusinessFixtureValidated !== 'boolean' ||
    typeof value.majorUpgradeValidated !== 'boolean' ||
    typeof value.targetFirstStartupValidated !== 'boolean' ||
    typeof value.targetSecondStartupValidated !== 'boolean' ||
    typeof value.artifactBytesValidated !== 'boolean'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_RESULT_INVALID');
  }

  if (
    value.status === 'completed' &&
    value.resultCode === 'historicalLegacyUpgradeCompleted' &&
    value.errorCode === null &&
    value.sourceInstallExitCode === 0 &&
    value.upgradeExitCode === 0 &&
    value.sourceStateValidated &&
    value.sourcePackagedSmokeValidated &&
    value.legacyBusinessFixtureValidated &&
    value.majorUpgradeValidated &&
    value.targetFirstStartupValidated &&
    value.targetSecondStartupValidated &&
    value.artifactBytesValidated
  ) {
    return Object.freeze({ ...value });
  }
  if (
    value.status !== 'failed' ||
    value.resultCode !== 'historicalLegacyUpgradeFailed' ||
    value.errorCode === null
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_RESULT_INVALID');
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

export async function readLegacyUpgradeWorkerRequest(path) {
  return validateLegacyUpgradeWorkerRequest(
    await readStrictObject(path, 'WINDOWS_ACCEPTANCE_LEGACY_REQUEST_INVALID'),
  );
}

export async function readLegacyUpgradeResult(path, expected) {
  try {
    return validateLegacyUpgradeResult(
      await readStrictObject(
        path,
        'WINDOWS_ACCEPTANCE_LEGACY_RESULT_MISSING_OR_INVALID',
      ),
      expected,
    );
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_RESULT_MISSING_OR_INVALID');
  }
}

export function createLegacyUpgradeWorkerTerminalResult(request, result) {
  return Object.freeze({
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: result.status,
    resultCode:
      result.status === 'completed'
        ? 'historicalLegacyUpgradeCompleted'
        : 'historicalLegacyUpgradeFailed',
    errorCode: result.errorCode,
  });
}

export function legacyUpgradeResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'historical-legacy-upgrade-result.json');
}

export function legacyUpgradeWorkerResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'worker-result.json');
}

export { writeJsonAtomicExclusive };
