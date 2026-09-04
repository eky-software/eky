import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import {
  parseHistoricalWindowsInstallerFixtureProvenance,
} from '../scripts/historicalWindowsInstallerFixtureProvenance.mjs';
import {
  LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  validateLegacyUpgradeArtifactDescriptor,
} from './legacyUpgradeArtifactDescriptor.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
export {
  LEGACY_UPGRADE_ARTIFACT_KIND,
  LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  createLegacyUpgradeArtifactDescriptor,
  validateLegacyUpgradeArtifactDescriptor,
} from './legacyUpgradeArtifactDescriptor.mjs';

async function requireStandaloneRegularFile(path) {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1n ||
      metadata.nlink !== 1n
    ) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
    }
    return metadata;
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
}

export async function hashLegacyUpgradeArtifactFile(path) {
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
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  return Object.freeze({ sha256: hash.digest('hex'), size });
}

async function requireClosedDirectory(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
}

async function requireExactInventory(path, expectedNames) {
  let names;
  try {
    names = (await readdir(path, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
  const expected = [...expectedNames].sort();
  if (
    names.length !== expected.length ||
    names.some((name, index) => name !== expected[index])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVENTORY_INVALID');
  }
}

async function readDescriptor(path) {
  await requireStandaloneRegularFile(path);
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength < 2 || bytes.byteLength > 64 * 1024) {
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
    }
    return validateLegacyUpgradeArtifactDescriptor(
      parseStrictJsonObjectBytes(bytes, {
        errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID',
      }),
    );
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID');
  }
}

async function verifyInstallerRole(artifactRoot, roleName, role) {
  const roleRoot = resolve(artifactRoot, roleName);
  await requireClosedDirectory(roleRoot);
  const manifestPath = resolve(artifactRoot, role.manifestPath);
  if (dirname(manifestPath) !== roleRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
  const manifestIdentity = await hashLegacyUpgradeArtifactFile(manifestPath);
  if (manifestIdentity.sha256 !== role.manifestSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  let manifest;
  try {
    manifest = await readInstallerManifest(manifestPath);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
  if (
    manifest.buildRevision !== role.buildRevision ||
    manifest.appVersion !== role.appVersion ||
    manifest.msiProductVersion !== role.msiProductVersion ||
    manifest.packageSha256 !== role.packageSha256 ||
    manifest.packageSize !== role.packageSize
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  const installerPath = resolve(roleRoot, manifest.packageFilename);
  if (dirname(installerPath) !== roleRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
  await requireStandaloneRegularFile(installerPath);
  try {
    await verifyInstallerManifestPackage({ installerPath, manifest });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_PACKAGE_INVALID');
  }
  return Object.freeze({ ...role, installerPath, manifest, manifestPath });
}

async function verifySourceProvenance(artifactRoot, source) {
  const provenancePath = resolve(artifactRoot, source.provenancePath);
  if (dirname(provenancePath) !== resolve(artifactRoot, 'source')) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID');
  }
  const identity = await hashLegacyUpgradeArtifactFile(provenancePath);
  if (identity.sha256 !== source.provenanceSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  try {
    const provenance = parseHistoricalWindowsInstallerFixtureProvenance(
      parseStrictJsonObjectBytes(await readFile(provenancePath), {
        errorCode: 'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_PROVENANCE_INVALID',
      }),
    );
    return Object.freeze({ provenance, provenancePath });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_PROVENANCE_INVALID');
  }
}

export async function verifyLegacyUpgradeArtifact({
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
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_INVALID');
  }
  const artifactRoot = resolve(artifactRootInput);
  await requireClosedDirectory(artifactRoot);
  await requireExactInventory(artifactRoot, [
    LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
    'source',
    'target',
  ]);
  const descriptorPath = resolve(
    artifactRoot,
    LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  );
  const descriptorBefore = await hashLegacyUpgradeArtifactFile(descriptorPath);
  if (descriptorBefore.sha256 !== expectedDescriptorSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  const descriptor = await readDescriptor(descriptorPath);
  if (
    expectedBuildRevision !== undefined &&
    descriptor.buildRevision !== expectedBuildRevision
  ) {
    throw new Error(
      'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_IDENTITY_MISMATCH',
    );
  }

  const source = await verifyInstallerRole(
    artifactRoot,
    'source',
    descriptor.source,
  );
  const target = await verifyInstallerRole(
    artifactRoot,
    'target',
    descriptor.target,
  );
  await requireExactInventory(resolve(artifactRoot, 'source'), [
    'installer.manifest.json',
    source.manifest.packageFilename,
    'historical-fixture-provenance.json',
  ]);
  await requireExactInventory(resolve(artifactRoot, 'target'), [
    'installer.manifest.json',
    target.manifest.packageFilename,
  ]);
  const provenance = await verifySourceProvenance(artifactRoot, source);

  const descriptorAfter = await hashLegacyUpgradeArtifactFile(descriptorPath);
  if (
    descriptorAfter.sha256 !== descriptorBefore.sha256 ||
    descriptorAfter.size !== descriptorBefore.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH');
  }
  return Object.freeze({
    artifactRoot,
    buildRevision: descriptor.buildRevision,
    descriptor,
    descriptorPath,
    descriptorSha256: descriptorAfter.sha256,
    schemaVersion: 1,
    source: Object.freeze({ ...source, ...provenance }),
    status: 'completed',
    resultCode: 'legacyUpgradeArtifactVerified',
    target,
  });
}
