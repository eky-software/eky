import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  createInstallerProductCode,
  INSTALLER_UPGRADE_CODE,
} from '../installerIdentity.mjs';
import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import {
  compareMsiProductVersions,
  parseMsiProductVersion,
  parseNumericAppVersion,
} from '../installerVersion.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const UPGRADE_ROLLBACK_ARTIFACT_KIND =
  'windowsAcceptanceUpgradeRollback';
export const UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME =
  'upgrade-rollback-artifact.json';
export const UPGRADE_ROLLBACK_ROLE_NAMES = Object.freeze([
  'source',
  'target',
  'windowsRollback',
]);

const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const PRODUCT_CODE_PATTERN =
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const DESCRIPTOR_KEYS = [
  'artifactKind',
  'buildRevision',
  'roles',
  'schemaVersion',
  'upgradeCode',
];
const ROLE_KEYS = [
  'appVersion',
  'manifestPath',
  'manifestSha256',
  'msiProductVersion',
  'packageSha256',
  'packageSize',
  'productCode',
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

function nextPatchVersion(version) {
  const parts = [...parseMsiProductVersion(version)];
  if (parts[2] >= 65_535) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_VERSION_INVALID');
  }
  parts[2] += 1;
  return parts.join('.');
}

function validateRole(roleName, value) {
  if (
    !hasExactKeys(value, ROLE_KEYS) ||
    value.manifestPath !== `${roleName}/installer.manifest.json` ||
    typeof value.appVersion !== 'string' ||
    typeof value.msiProductVersion !== 'string' ||
    value.appVersion !== value.msiProductVersion ||
    typeof value.manifestSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.manifestSha256) ||
    typeof value.packageSha256 !== 'string' ||
    !SHA_256_PATTERN.test(value.packageSha256) ||
    !Number.isSafeInteger(value.packageSize) ||
    value.packageSize < 1 ||
    typeof value.productCode !== 'string' ||
    !PRODUCT_CODE_PATTERN.test(value.productCode)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }
  try {
    parseNumericAppVersion(value.appVersion);
    parseMsiProductVersion(value.msiProductVersion);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }
  if (value.productCode !== createInstallerProductCode(value.msiProductVersion)) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({ ...value });
}

export function validateUpgradeRollbackArtifactDescriptor(value) {
  if (
    !hasExactKeys(value, DESCRIPTOR_KEYS) ||
    value.schemaVersion !== 1 ||
    value.artifactKind !== UPGRADE_ROLLBACK_ARTIFACT_KIND ||
    typeof value.buildRevision !== 'string' ||
    !BUILD_REVISION_PATTERN.test(value.buildRevision) ||
    value.upgradeCode !== INSTALLER_UPGRADE_CODE ||
    !hasExactKeys(value.roles, [...UPGRADE_ROLLBACK_ROLE_NAMES].sort())
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }

  const source = validateRole('source', value.roles.source);
  const target = validateRole('target', value.roles.target);
  const windowsRollback = validateRole(
    'windowsRollback',
    value.roles.windowsRollback,
  );
  if (
    nextPatchVersion(source.msiProductVersion) !== target.msiProductVersion ||
    compareMsiProductVersions(source.msiProductVersion, target.msiProductVersion) >=
      0 ||
    source.productCode === target.productCode ||
    windowsRollback.appVersion !== target.appVersion ||
    windowsRollback.msiProductVersion !== target.msiProductVersion ||
    windowsRollback.productCode !== target.productCode ||
    windowsRollback.packageSha256 === target.packageSha256
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }

  return Object.freeze({
    ...value,
    roles: Object.freeze({ source, target, windowsRollback }),
  });
}

export function createUpgradeRollbackArtifactDescriptor({
  buildRevision,
  roles,
}) {
  return validateUpgradeRollbackArtifactDescriptor({
    schemaVersion: 1,
    artifactKind: UPGRADE_ROLLBACK_ARTIFACT_KIND,
    buildRevision,
    upgradeCode: INSTALLER_UPGRADE_CODE,
    roles,
  });
}

export async function hashUpgradeRollbackArtifactFile(path) {
  const before = await requireStandaloneRegularFile(path);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  const after = await requireStandaloneRegularFile(path);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    BigInt(size) !== before.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH');
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

async function requireStandaloneRegularFile(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1n ||
      metadata.nlink !== 1n
    ) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
    }
    return metadata;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
}

async function requireClosedDirectory(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
}

async function readDescriptor(path) {
  await requireStandaloneRegularFile(path);
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength < 2 || bytes.byteLength > 64 * 1024) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
    }
    return validateUpgradeRollbackArtifactDescriptor(
      parseStrictJsonObjectBytes(bytes, {
        errorCode: 'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID',
      }),
    );
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID');
  }
}

async function requireExactInventory(path, expectedNames) {
  let names;
  try {
    names = (await readdir(path, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
  const expected = [...expectedNames].sort();
  if (
    names.length !== expected.length ||
    names.some((name, index) => name !== expected[index])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVENTORY_INVALID');
  }
}

async function verifyRoleArtifact(artifactRoot, descriptor, roleName) {
  const role = descriptor.roles[roleName];
  const roleRoot = resolve(artifactRoot, roleName);
  await requireClosedDirectory(roleRoot);
  const manifestPath = resolve(artifactRoot, role.manifestPath);
  if (dirname(manifestPath) !== roleRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
  await requireStandaloneRegularFile(manifestPath);
  const manifestIdentity = await hashUpgradeRollbackArtifactFile(manifestPath);
  if (manifestIdentity.sha256 !== role.manifestSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH');
  }

  let manifest;
  try {
    manifest = await readInstallerManifest(manifestPath);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
  if (
    manifest.buildRevision !== descriptor.buildRevision ||
    manifest.appVersion !== role.appVersion ||
    manifest.msiProductVersion !== role.msiProductVersion ||
    manifest.packageSha256 !== role.packageSha256 ||
    manifest.packageSize !== role.packageSize
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH');
  }
  const installerPath = resolve(roleRoot, manifest.packageFilename);
  if (dirname(installerPath) !== roleRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID');
  }
  await requireExactInventory(roleRoot, [
    'installer.manifest.json',
    manifest.packageFilename,
  ]);
  await requireStandaloneRegularFile(installerPath);
  try {
    await verifyInstallerManifestPackage({ installerPath, manifest });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PACKAGE_INVALID');
  }
  await requireStandaloneRegularFile(manifestPath);
  await requireStandaloneRegularFile(installerPath);
  return Object.freeze({
    ...role,
    installerPath,
    manifest,
    manifestPath,
  });
}

export async function verifyUpgradeRollbackArtifact({
  artifactRoot: artifactRootInput,
  expectedBuildRevision,
  expectedDescriptorSha256,
}) {
  if (
    typeof expectedDescriptorSha256 !== 'string' ||
    !SHA_256_PATTERN.test(expectedDescriptorSha256) ||
    (expectedBuildRevision !== undefined &&
      (typeof expectedBuildRevision !== 'string' ||
        !BUILD_REVISION_PATTERN.test(expectedBuildRevision)))
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_INVALID');
  }
  const artifactRoot = resolve(artifactRootInput);
  await requireClosedDirectory(artifactRoot);
  await requireExactInventory(artifactRoot, [
    UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
    ...UPGRADE_ROLLBACK_ROLE_NAMES,
  ]);
  const descriptorPath = resolve(
    artifactRoot,
    UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  );
  const descriptorBefore = await hashUpgradeRollbackArtifactFile(descriptorPath);
  if (descriptorBefore.sha256 !== expectedDescriptorSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH');
  }
  const descriptor = await readDescriptor(descriptorPath);
  if (
    expectedBuildRevision !== undefined &&
    descriptor.buildRevision !== expectedBuildRevision
  ) {
    throw new Error(
      'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_IDENTITY_MISMATCH',
    );
  }

  const roles = {};
  for (const roleName of UPGRADE_ROLLBACK_ROLE_NAMES) {
    roles[roleName] = await verifyRoleArtifact(
      artifactRoot,
      descriptor,
      roleName,
    );
  }
  await requireStandaloneRegularFile(descriptorPath);
  const descriptorAfter = await hashUpgradeRollbackArtifactFile(descriptorPath);
  if (
    descriptorAfter.sha256 !== descriptorBefore.sha256 ||
    descriptorAfter.size !== descriptorBefore.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH');
  }

  return Object.freeze({
    artifactRoot,
    buildRevision: descriptor.buildRevision,
    descriptor,
    descriptorPath,
    descriptorSha256: descriptorAfter.sha256,
    roles: Object.freeze(roles),
    schemaVersion: 1,
    status: 'completed',
    resultCode: 'upgradeRollbackArtifactVerified',
  });
}
