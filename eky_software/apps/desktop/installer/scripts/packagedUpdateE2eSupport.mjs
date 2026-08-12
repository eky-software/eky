import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const appVersionPattern = /^0\.0\.0-update-fixture\.[123]$/;
const msiVersionPattern = /^0\.0\.[123]$/;
const productCodePattern = /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/i;
const revisionPattern = /^[0-9a-f]{7,40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const maximumFixtureBytes = 128 * 1024;
const maximumResultBytes = 16 * 1024;

const fixtureFields = new Set([
  'buildRevision',
  'fixtureFormatVersion',
  'packages',
]);
const packageFields = new Set([
  'appVersion',
  'applicationPath',
  'manifestPath',
  'msiPath',
  'msiProductVersion',
  'packageSha256',
  'packageSize',
  'productCode',
]);
const packageRoles = Object.freeze(['current', 'next', 'failure']);

export async function readPackagedUpdateE2eFixture(fixturePath) {
  const fixture = await readBoundedJson(fixturePath, maximumFixtureBytes);
  const fixtureRoot = dirname(resolve(fixturePath));
  if (
    !isRecord(fixture) ||
    !hasExactFields(fixture, fixtureFields) ||
    fixture.fixtureFormatVersion !== 1 ||
    typeof fixture.buildRevision !== 'string' ||
    !revisionPattern.test(fixture.buildRevision) ||
    !isRecord(fixture.packages) ||
    !hasExactFields(fixture.packages, new Set(packageRoles))
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_FIXTURE_INVALID');
  }

  const packages = Object.fromEntries(
    packageRoles.map((role, index) => [
      role,
      parseFixturePackage(fixture.packages[role], fixtureRoot, index + 1),
    ]),
  );
  const identities = new Set(
    packageRoles.flatMap((role) => [
      packages[role].appVersion,
      packages[role].msiProductVersion,
      packages[role].productCode.toLowerCase(),
    ]),
  );
  if (identities.size !== packageRoles.length * 3) {
    throw new Error('PACKAGED_UPDATE_E2E_FIXTURE_INVALID');
  }

  return Object.freeze({
    buildRevision: fixture.buildRevision,
    fixtureFormatVersion: 1,
    packages: Object.freeze(packages),
  });
}

export function parsePackagedUpdateSmokeResult(value, expectedPhase) {
  if (
    !isRecord(value) ||
    typeof expectedPhase !== 'string' ||
    value.phase !== expectedPhase
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_INVALID');
  }
  if (
    (value.status === 'handoffReady' ||
      value.status === 'previousSetupReady' ||
      value.status === 'restoreReady') &&
    hasExactFields(value, new Set(['appVersion', 'phase', 'status'])) &&
    typeof value.appVersion === 'string' &&
    appVersionPattern.test(value.appVersion)
  ) {
    return Object.freeze({ ...value });
  }
  if (
    value.status === 'failed' &&
    hasExactFields(value, new Set(['code', 'phase', 'status'])) &&
    typeof value.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)
  ) {
    return Object.freeze({ ...value });
  }
  if (
    value.status === 'ok' &&
    hasExactFields(
      value,
      new Set([
        'acceptedVersion',
        'appVersion',
        'artifactCount',
        'journalState',
        'migrationChainIdentity',
        'pdfSha256',
        'phase',
        'secretConfigured',
        'status',
      ]),
    ) &&
    typeof value.acceptedVersion === 'string' &&
    appVersionPattern.test(value.acceptedVersion) &&
    typeof value.appVersion === 'string' &&
    appVersionPattern.test(value.appVersion) &&
    Number.isSafeInteger(value.artifactCount) &&
    value.artifactCount >= 1 &&
    (value.journalState === null || typeof value.journalState === 'string') &&
    typeof value.migrationChainIdentity === 'string' &&
    sha256Pattern.test(value.migrationChainIdentity) &&
    typeof value.pdfSha256 === 'string' &&
    sha256Pattern.test(value.pdfSha256) &&
    value.secretConfigured === true
  ) {
    return Object.freeze({ ...value });
  }
  throw new Error('PACKAGED_UPDATE_E2E_RESULT_INVALID');
}

export async function readPackagedUpdateSmokeResult(
  resultPath,
  expectedPhase,
) {
  return parsePackagedUpdateSmokeResult(
    await readBoundedJson(resultPath, maximumResultBytes),
    expectedPhase,
  );
}

export function createPackagedUpdateScenarioPlan() {
  return Object.freeze([
    Object.freeze({
      name: 'coordinatedSuccess',
      phases: Object.freeze(['seed', 'prepareSuccess', 'verifySuccess']),
    }),
    Object.freeze({
      name: 'coordinatedCancel',
      phases: Object.freeze(['seed', 'prepareCancel', 'verifyCancel']),
    }),
    Object.freeze({
      name: 'coordinatedRollback',
      phases: Object.freeze(['seed', 'prepareFailure', 'verifyRollback']),
    }),
    Object.freeze({
      name: 'directSetupSuccess',
      phases: Object.freeze(['seed', 'verifyDirectSuccess']),
    }),
    Object.freeze({
      name: 'directSetupFailure',
      phases: Object.freeze(['seed', 'verifyDirectFailure']),
    }),
    Object.freeze({
      name: 'backupForwardRestore',
      phases: Object.freeze([
        'seed',
        'createBackup',
        'verifyDirectSuccess',
        'restoreBackup',
        'verifyBackup',
      ]),
    }),
  ]);
}

function parseFixturePackage(value, fixtureRoot, index) {
  const expectedAppVersion = `0.0.0-update-fixture.${index}`;
  const expectedMsiVersion = `0.0.${index}`;
  if (
    !isRecord(value) ||
    !hasExactFields(value, packageFields) ||
    value.appVersion !== expectedAppVersion ||
    !appVersionPattern.test(value.appVersion) ||
    value.msiProductVersion !== expectedMsiVersion ||
    !msiVersionPattern.test(value.msiProductVersion) ||
    typeof value.applicationPath !== 'string' ||
    typeof value.manifestPath !== 'string' ||
    typeof value.msiPath !== 'string' ||
    !isContainedAbsolutePath(value.applicationPath, fixtureRoot) ||
    !isContainedAbsolutePath(value.manifestPath, fixtureRoot) ||
    !isContainedAbsolutePath(value.msiPath, fixtureRoot) ||
    typeof value.packageSha256 !== 'string' ||
    !sha256Pattern.test(value.packageSha256) ||
    !Number.isSafeInteger(value.packageSize) ||
    value.packageSize < 1 ||
    typeof value.productCode !== 'string' ||
    !productCodePattern.test(value.productCode)
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_FIXTURE_INVALID');
  }
  return Object.freeze({ ...value });
}

function isContainedAbsolutePath(path, root) {
  if (!isAbsolute(path)) {
    return false;
  }
  const normalizedPath = resolve(path);
  const normalizedRoot = resolve(root);
  const relation = relative(normalizedRoot, normalizedPath);
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation);
}

async function readBoundedJson(path, maximumBytes) {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes
    ) {
      throw new Error('invalid');
    }
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('PACKAGED_UPDATE_E2E_FILE_INVALID');
  }
}

function hasExactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
