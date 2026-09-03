import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const CLEAN_INSTALL_UNINSTALL_SCENARIO = 'cleanInstallUninstall';

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
  'artifactDescriptorSha256',
  'cleanupResultCode',
  'errorCode',
  'installExitCode',
  'installedStateValidated',
  'resultCode',
  'runNonce',
  'scenario',
  'schemaVersion',
  'status',
  'uninstallExitCode',
  'uninstalledStateValidated',
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
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  );
}

export function createCleanInstallUninstallWorkerRequest({
  artifactDescriptorSha256,
  fixtureRoot,
  runNonce = randomBytes(32).toString('hex'),
}) {
  return validateCleanInstallUninstallWorkerRequest({
    schemaVersion: 1,
    runNonce,
    scenario: CLEAN_INSTALL_UNINSTALL_SCENARIO,
    artifactDescriptorSha256,
    fixtureRoot: resolve(fixtureRoot),
  });
}

export function validateCleanInstallUninstallWorkerRequest(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.schemaVersion !== 1 ||
    value.scenario !== CLEAN_INSTALL_UNINSTALL_SCENARIO ||
    typeof value.runNonce !== 'string' ||
    !SHA_256_PATTERN.test(value.runNonce) ||
    typeof value.artifactDescriptorSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.artifactDescriptorSha256) ||
    typeof value.fixtureRoot !== 'string' ||
    value.fixtureRoot.includes('\0') ||
    !isAbsolute(value.fixtureRoot) ||
    resolve(value.fixtureRoot) !== value.fixtureRoot
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_REQUEST_INVALID');
  }
  return Object.freeze({ ...value });
}

export async function readCleanInstallUninstallWorkerRequest(path) {
  const value = await readStrictJsonObject(
    path,
    'WINDOWS_ACCEPTANCE_CLEAN_REQUEST_INVALID',
  );
  return validateCleanInstallUninstallWorkerRequest(value);
}

export function validateCleanInstallUninstallResult(value, expected) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RESULT_KEYS) ||
    value.schemaVersion !== 1 ||
    value.runNonce !== expected.runNonce ||
    value.scenario !== CLEAN_INSTALL_UNINSTALL_SCENARIO ||
    value.artifactDescriptorSha256 !== expected.artifactDescriptorSha256 ||
    typeof value.resultCode !== 'string' ||
    !SAFE_CODE_PATTERN.test(value.resultCode) ||
    (value.errorCode !== null &&
      (typeof value.errorCode !== 'string' ||
        !SAFE_CODE_PATTERN.test(value.errorCode))) ||
    !['notRequired', 'cleanupCompleted', 'cleanupFailed'].includes(
      value.cleanupResultCode,
    ) ||
    (value.installExitCode !== null &&
      (!Number.isInteger(value.installExitCode) ||
        value.installExitCode < -2_147_483_648 ||
        value.installExitCode > 2_147_483_647)) ||
    (value.uninstallExitCode !== null &&
      (!Number.isInteger(value.uninstallExitCode) ||
        value.uninstallExitCode < -2_147_483_648 ||
        value.uninstallExitCode > 2_147_483_647)) ||
    typeof value.installedStateValidated !== 'boolean' ||
    typeof value.uninstalledStateValidated !== 'boolean'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_RESULT_INVALID');
  }

  if (
    value.status === 'completed' &&
    value.resultCode === 'cleanInstallUninstallCompleted' &&
    value.errorCode === null &&
    value.cleanupResultCode === 'notRequired' &&
    value.installExitCode === 0 &&
    value.uninstallExitCode === 0 &&
    value.installedStateValidated &&
    value.uninstalledStateValidated
  ) {
    return Object.freeze({ ...value });
  }
  if (
    value.status !== 'failed' ||
    value.errorCode === null ||
    value.resultCode !== 'cleanInstallUninstallFailed'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_RESULT_INVALID');
  }
  return Object.freeze({ ...value });
}

export async function readCleanInstallUninstallResult(path, expected) {
  const value = await readStrictJsonObject(
    path,
    'WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID',
  );
  try {
    return validateCleanInstallUninstallResult(value, expected);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_CLEAN_RESULT_MISSING_OR_INVALID');
  }
}

export async function writeJsonAtomicExclusive(path, value) {
  const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await access(path, constants.F_OK).then(
      () => {
        throw new Error('WINDOWS_ACCEPTANCE_RESULT_PATH_OCCUPIED');
      },
      () => undefined,
    );
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readStrictJsonObject(path, errorCode) {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 2 ||
      metadata.size > 64 * 1024
    ) {
      throw new Error(errorCode);
    }
    return parseStrictJsonObjectBytes(await readFile(path), { errorCode });
  } catch {
    throw new Error(errorCode);
  }
}

export function createWorkerTerminalResult(request, result) {
  return Object.freeze({
    schemaVersion: 1,
    runNonce: request.runNonce,
    scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    status: result.status,
    resultCode:
      result.status === 'completed'
        ? 'cleanInstallUninstallCompleted'
        : 'cleanInstallUninstallFailed',
    errorCode: result.errorCode,
  });
}

export function cleanResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'clean-install-uninstall-result.json');
}

export function workerResultPathForRequest(requestPath) {
  return resolve(dirname(requestPath), 'worker-result.json');
}
