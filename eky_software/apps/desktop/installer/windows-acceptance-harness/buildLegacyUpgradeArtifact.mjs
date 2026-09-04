import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { createWindowsInstallerRelease } from '../scripts/releaseWindowsInstaller.mjs';
import { withHistoricalSourceWindowsInstallerFixture } from '../scripts/historicalWindowsInstallerFixtureBuilder.mjs';
import { packageDefaultWindowsApplication } from '../../scripts/packageWindowsApplication.mjs';
import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { detachWindowsInstallerBuildOutput } from './detachWindowsInstallerBuildOutput.mjs';
import {
  materializeImmutableInstallerFixture,
  verifyLocalImmutableSourceFixture,
} from './localImmutableInstallerFixture.mjs';
import {
  LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  createLegacyUpgradeArtifactDescriptor,
  hashLegacyUpgradeArtifactFile,
  verifyLegacyUpgradeArtifact,
} from './legacyUpgradeArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(DIRECTORY, '..', '..');
const REPOSITORY_ROOT = resolve(DESKTOP_ROOT, '..', '..');
const CANONICAL_PACKAGE_PATH = resolve(DESKTOP_ROOT, 'package.json');
const CANONICAL_RELEASE_PATH = resolve(
  DESKTOP_ROOT,
  'installer',
  'installer-release.json',
);

function isPathInside(parent, candidate) {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

async function requireCanonicalInputsUnchanged(packageSource, releaseSource) {
  if (
    (await readFile(CANONICAL_PACKAGE_PATH, 'utf8')) !== packageSource ||
    (await readFile(CANONICAL_RELEASE_PATH, 'utf8')) !== releaseSource
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_CANONICAL_CHANGED');
  }
}

export function parseLegacyUpgradeArtifactBuildArguments(arguments_) {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== '--artifact-root' ||
    arguments_[2] !== '--summary-path'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  const artifactRoot = parseAbsoluteWindowsAcceptancePath(
    arguments_[1],
    'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  const summaryPath = parseAbsoluteWindowsAcceptancePath(
    arguments_[3],
    'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  if (isPathInside(artifactRoot, summaryPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  return Object.freeze({ artifactRoot, summaryPath });
}

async function copyStandaloneFile(sourcePath, targetPath) {
  const sourceBefore = await hashLegacyUpgradeArtifactFile(sourcePath);
  const sourceMetadata = await lstat(sourcePath, { bigint: true });
  await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  const targetMetadata = await lstat(targetPath, { bigint: true });
  if (
    !targetMetadata.isFile() ||
    targetMetadata.isSymbolicLink() ||
    targetMetadata.nlink !== 1n ||
    (targetMetadata.dev === sourceMetadata.dev &&
      targetMetadata.ino === sourceMetadata.ino)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_COPY_INVALID');
  }
  const targetIdentity = await hashLegacyUpgradeArtifactFile(targetPath);
  const sourceAfter = await hashLegacyUpgradeArtifactFile(sourcePath);
  if (
    targetIdentity.sha256 !== sourceBefore.sha256 ||
    targetIdentity.size !== sourceBefore.size ||
    sourceAfter.sha256 !== sourceBefore.sha256 ||
    sourceAfter.size !== sourceBefore.size
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_COPY_INVALID');
  }
  return targetIdentity;
}

export async function materializeHistoricalLegacyRole({ artifactRoot }) {
  return withHistoricalSourceWindowsInstallerFixture(async (historical) => {
    await detachWindowsInstallerBuildOutput(historical.manifestPath);
    const fixture = await materializeImmutableInstallerFixture(
      historical.manifestPath,
      resolve(artifactRoot, 'source'),
    );
    const provenancePath = resolve(
      fixture.fixtureRoot,
      'historical-fixture-provenance.json',
    );
    const provenanceIdentity = await copyStandaloneFile(
      historical.provenancePath,
      provenancePath,
    );
    await verifyLocalImmutableSourceFixture(fixture);
    return Object.freeze({
      appVersion: fixture.manifest.appVersion,
      artifactClass: historical.artifactClass,
      buildRevision: fixture.manifest.buildRevision,
      manifestPath: 'source/installer.manifest.json',
      manifestSha256: fixture.artifactDescriptorSha256,
      matchesApprovedArtifact: historical.matchesApprovedArtifact,
      msiProductVersion: fixture.manifest.msiProductVersion,
      packageSha256: fixture.manifest.packageSha256,
      packageSize: fixture.manifest.packageSize,
      productCode: historical.productCode,
      provenancePath: 'source/historical-fixture-provenance.json',
      provenanceSha256: provenanceIdentity.sha256,
      runtimeBuildRevision: historical.runtimeBuildRevision,
    });
  });
}

function requireTargetPackagedIdentity(packaged, buildRevision) {
  if (
    packaged?.appVersion !== '0.2.7' ||
    packaged?.buildInfo?.buildDirty !== false ||
    typeof packaged?.buildInfo?.buildRevision !== 'string' ||
    !/^[0-9a-f]{7,40}$/.test(packaged.buildInfo.buildRevision) ||
    !buildRevision.startsWith(packaged.buildInfo.buildRevision) ||
    typeof packaged?.packagedPath !== 'string'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID');
  }
}

function requireTargetInstallerIdentity(packaged, release, buildRevision) {
  if (
    packaged.appVersion !== release?.release?.appVersion ||
    release?.release?.msiProductVersion !== packaged.appVersion ||
    release?.manifest?.buildRevision !== buildRevision
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID');
  }
}

export async function materializeCurrentLegacyTargetRole({
  artifactRoot,
  buildRevision,
  createInstallerRelease = createWindowsInstallerRelease,
  packageApplication = packageDefaultWindowsApplication,
}) {
  const packaged = await packageApplication({
    pilotBuild: true,
    reportPackagedPath: false,
  });
  requireTargetPackagedIdentity(packaged, buildRevision);
  const payloadInventory = await inspectPackageArtifactInventory({
    root: packaged.packagedPath,
    stage: 'packagedApp',
  });
  const release = await createInstallerRelease({ buildRevision });
  requireTargetInstallerIdentity(packaged, release, buildRevision);
  const payloadInventoryAfterBuild = await inspectPackageArtifactInventory({
    root: packaged.packagedPath,
    stage: 'packagedApp',
  });
  if (
    JSON.stringify(payloadInventoryAfterBuild) !==
    JSON.stringify(payloadInventory)
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_TARGET_PAYLOAD_CHANGED');
  }
  await detachWindowsInstallerBuildOutput(release.manifestPath);
  const fixture = await materializeImmutableInstallerFixture(
    release.manifestPath,
    resolve(artifactRoot, 'target'),
  );
  await verifyLocalImmutableSourceFixture(fixture);
  return Object.freeze({
    appVersion: fixture.manifest.appVersion,
    buildRevision: fixture.manifest.buildRevision,
    manifestPath: 'target/installer.manifest.json',
    manifestSha256: fixture.artifactDescriptorSha256,
    msiProductVersion: fixture.manifest.msiProductVersion,
    packageSha256: fixture.manifest.packageSha256,
    packageSize: fixture.manifest.packageSize,
    payloadInventory,
    productCode: release.productCode,
  });
}

export async function buildLegacyUpgradeArtifact({
  artifactRoot: artifactRootInput,
  materializeSourceRole = materializeHistoricalLegacyRole,
  materializeTargetRole = materializeCurrentLegacyTargetRole,
  readGitState = readInstallerReleaseGitState,
}) {
  const artifactRoot = resolve(artifactRootInput);
  let artifactCreated = false;
  const packageSource = await readFile(CANONICAL_PACKAGE_PATH, 'utf8');
  const releaseSource = await readFile(CANONICAL_RELEASE_PATH, 'utf8');
  try {
    const buildRevision = await readGitState({
      repositoryRoot: REPOSITORY_ROOT,
    });
    if (!/^[0-9a-f]{40}$/.test(buildRevision)) {
      throw new Error(
        'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_IDENTITY_MISMATCH',
      );
    }
    await mkdir(artifactRoot, { recursive: false });
    artifactCreated = true;
    const source = await materializeSourceRole({ artifactRoot });
    const target = await materializeTargetRole({ artifactRoot, buildRevision });
    const descriptor = createLegacyUpgradeArtifactDescriptor({
      buildRevision,
      source,
      target,
    });
    const descriptorPath = resolve(
      artifactRoot,
      LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
    );
    await writeJsonAtomicExclusive(descriptorPath, descriptor);
    const descriptorIdentity = await hashLegacyUpgradeArtifactFile(
      descriptorPath,
    );
    const verified = await verifyLegacyUpgradeArtifact({
      artifactRoot,
      expectedBuildRevision: buildRevision,
      expectedDescriptorSha256: descriptorIdentity.sha256,
    });
    await requireCanonicalInputsUnchanged(packageSource, releaseSource);
    return Object.freeze({
      schemaVersion: 1,
      status: 'completed',
      resultCode: 'legacyUpgradeArtifactBuilt',
      buildRevision: verified.buildRevision,
      descriptorSha256: verified.descriptorSha256,
      sourceArtifactClass: verified.source.artifactClass,
      sourcePackageSha256: verified.source.packageSha256,
      targetPackageSha256: verified.target.packageSha256,
      targetPayloadIdentity: verified.target.payloadInventory.identity,
    });
  } catch (error) {
    if (artifactCreated) {
      await rm(artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    await requireCanonicalInputsUnchanged(packageSource, releaseSource);
    throw error;
  }
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^WINDOWS_ACCEPTANCE_LEGACY_[A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_FAILED';
}

async function main() {
  let arguments_;
  let artifactBuilt = false;
  try {
    arguments_ = parseLegacyUpgradeArtifactBuildArguments(
      process.argv.slice(2),
    );
    const summary = await buildLegacyUpgradeArtifact(arguments_);
    artifactBuilt = true;
    await writeJsonAtomicExclusive(arguments_.summaryPath, summary);
    console.log(JSON.stringify(summary));
  } catch (error) {
    if (artifactBuilt && arguments_ !== undefined) {
      await rm(arguments_.artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
