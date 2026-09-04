import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';

const DESCRIPTOR_FILENAME = 'installer.manifest.json';
const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;

async function hashFile(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
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
      throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
  }
}

async function requireClosedArtifactRoot(artifactRoot) {
  try {
    const rootMetadata = await lstat(artifactRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
    }
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
  }
}

export function parseWindowsAcceptanceArtifactVerifierArguments(arguments_) {
  if (
    arguments_.length !== 6 ||
    arguments_[0] !== '--artifact-root' ||
    typeof arguments_[1] !== 'string' ||
    arguments_[1].includes('\0') ||
    !isAbsolute(arguments_[1]) ||
    resolve(arguments_[1]) !== arguments_[1] ||
    arguments_[2] !== '--expected-descriptor-sha256' ||
    typeof arguments_[3] !== 'string' ||
    !SHA_256_PATTERN.test(arguments_[3]) ||
    arguments_[4] !== '--expected-build-revision' ||
    typeof arguments_[5] !== 'string' ||
    !BUILD_REVISION_PATTERN.test(arguments_[5])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_ARGUMENTS_INVALID');
  }
  return Object.freeze({
    artifactRoot: resolve(arguments_[1]),
    expectedDescriptorSha256: arguments_[3],
    expectedBuildRevision: arguments_[5],
  });
}

export async function verifyWindowsAcceptanceArtifact({
  artifactRoot: artifactRootInput,
  expectedDescriptorSha256,
  expectedBuildRevision,
}) {
  if (
    !SHA_256_PATTERN.test(expectedDescriptorSha256) ||
    !BUILD_REVISION_PATTERN.test(expectedBuildRevision)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_INVALID');
  }
  const artifactRoot = resolve(artifactRootInput);
  await requireClosedArtifactRoot(artifactRoot);
  const descriptorPath = resolve(artifactRoot, DESCRIPTOR_FILENAME);
  await requireStandaloneRegularFile(descriptorPath);
  const descriptorBefore = await hashFile(descriptorPath);
  if (descriptorBefore.sha256 !== expectedDescriptorSha256) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_MISMATCH');
  }

  let manifest;
  try {
    manifest = await readInstallerManifest(descriptorPath);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
  }
  if (manifest.buildRevision !== expectedBuildRevision) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH');
  }
  const installerPath = resolve(artifactRoot, manifest.packageFilename);
  if (dirname(installerPath) !== artifactRoot) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
  }
  const expectedNames = [DESCRIPTOR_FILENAME, manifest.packageFilename].sort();
  let entries;
  try {
    entries = (await readdir(artifactRoot, { withFileTypes: true }))
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVALID');
  }
  if (
    entries.length !== expectedNames.length ||
    entries.some((entry, index) => entry !== expectedNames[index])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_INVENTORY_INVALID');
  }
  await requireStandaloneRegularFile(installerPath);
  try {
    await verifyInstallerManifestPackage({ installerPath, manifest });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_PACKAGE_INVALID');
  }

  await requireStandaloneRegularFile(descriptorPath);
  await requireStandaloneRegularFile(installerPath);
  const descriptorAfter = await hashFile(descriptorPath);
  if (
    descriptorAfter.sha256 !== descriptorBefore.sha256 ||
    descriptorAfter.size !== descriptorBefore.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_MISMATCH');
  }
  try {
    await verifyInstallerManifestPackage({ installerPath, manifest });
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_PACKAGE_INVALID');
  }

  return Object.freeze({
    schemaVersion: 1,
    status: 'completed',
    resultCode: 'windowsAcceptanceArtifactVerified',
    appVersion: manifest.appVersion,
    buildRevision: manifest.buildRevision,
    descriptorSha256: descriptorAfter.sha256,
    packageSha256: manifest.packageSha256,
    manifestPath: descriptorPath,
  });
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^WINDOWS_ACCEPTANCE_[A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_ARTIFACT_UNEXPECTED_FAILURE';
}

async function main() {
  try {
    const result = await verifyWindowsAcceptanceArtifact(
      parseWindowsAcceptanceArtifactVerifierArguments(process.argv.slice(2)),
    );
    console.log(
      JSON.stringify({
        schemaVersion: result.schemaVersion,
        status: result.status,
        resultCode: result.resultCode,
        appVersion: result.appVersion,
        buildRevision: result.buildRevision,
        descriptorSha256: result.descriptorSha256,
        packageSha256: result.packageSha256,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        schemaVersion: 1,
        status: 'failed',
        errorCode: safeErrorCode(error),
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
