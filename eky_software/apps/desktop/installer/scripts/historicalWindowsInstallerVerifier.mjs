import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import { verifyLocalPilotReleaseBundle } from './createLocalPilotReleaseBundle.mjs';
import { inspectWindowsInstallerIdentity } from './historicalWindowsInstallerBuilder.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  classifyHistoricalWindowsInstallerArtifact,
  createHistoricalWindowsInstallerFixtureProvenance,
  parseHistoricalWindowsInstallerFixtureProvenance,
} from './historicalWindowsInstallerFixtureProvenance.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY,
  isHistoricalFixtureRecord,
  sameHistoricalFixtureJson,
  validateHistoricalPackagedApplicationIdentity,
  validateHistoricalWindowsInstallerIdentity,
} from './historicalWindowsInstallerFixturePolicy.mjs';
import {
  assertHistoricalFixtureContainedPath,
  assertHistoricalFixtureRegularFile,
  readHistoricalFixtureJson,
} from './historicalWindowsInstallerToolchain.mjs';

export async function verifyExactLocalHistoricalWindowsInstallerFixture({
  inspectInstallerIdentity = inspectWindowsInstallerIdentity,
  localBundleRoot =
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.exactLocalBundleRoot,
} = {}) {
  const {
    exactLocalBundleRoot,
    exactLocalChecksumFilename,
    exactLocalInstallerFilename,
  } = HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY;
  if (localBundleRoot !== exactLocalBundleRoot) {
    throw new Error('HISTORICAL_FIXTURE_LOCAL_BUNDLE_PATH_INVALID');
  }
  const verified = await verifyLocalPilotReleaseBundle({
    buildRevision: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    bundleDirectory: localBundleRoot,
    release: HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
  });
  const checksum = await readFile(
    join(localBundleRoot, exactLocalChecksumFilename),
    'utf8',
  );
  if (
    checksum !==
    `${HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256}  ${exactLocalInstallerFilename}\n`
  ) {
    throw new Error('HISTORICAL_FIXTURE_LOCAL_CHECKSUM_MISMATCH');
  }
  const classification = classifyHistoricalWindowsInstallerArtifact({
    packageSha256: verified.manifest.packageSha256,
    source: 'local-release',
  });
  const identity = await inspectInstallerIdentity(verified.installerPath);
  validateHistoricalWindowsInstallerIdentity(identity);
  return Object.freeze({
    ...classification,
    appVersion: verified.manifest.appVersion,
    buildRevision: verified.manifest.buildRevision,
    installerPath: verified.installerPath,
    manifestPath: verified.manifestPath,
    packageSha256: verified.manifest.packageSha256,
    packageSize: verified.manifest.packageSize,
    productCode: identity.productCode,
    runtimeBuildRevision:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
    upgradeCode: identity.upgradeCode,
  });
}

export async function verifyHistoricalPackagedApplication(workspaceRoot) {
  const outputRoot = join(workspaceRoot, 'apps/desktop/out');
  await assertHistoricalPackagedApplicationPathBudget(
    join(outputRoot, 'Eky-win32-x64'),
  );
  const stageRoot = join(workspaceRoot, 'apps/desktop/.stage/application/dist');
  const buildInfo = await readHistoricalFixtureJson(
    join(stageRoot, 'build-info.json'),
  );
  const releaseInfo = await readHistoricalFixtureJson(
    join(stageRoot, 'release-info.json'),
  );
  await assertHistoricalFixtureRegularFile(
    join(outputRoot, 'Eky-win32-x64/Eky.exe'),
    'HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID',
  );
  const packageModePresent =
    (await lstat(join(stageRoot, 'package-mode.json')).catch(() => null)) !==
    null;
  const pilotManifestPresent =
    (await lstat(
      join(outputRoot, 'Eky-win32-x64.pilot-manifest.json'),
    ).catch(() => null)) !== null;
  return validateHistoricalPackagedApplicationIdentity({
    buildInfo,
    packageModePresent,
    pilotManifestPresent,
    releaseInfo,
  });
}

export async function verifyHistoricalInstallerRelease(built) {
  if (
    !isHistoricalFixtureRecord(built) ||
    !isHistoricalFixtureRecord(built.manifest) ||
    !sameHistoricalFixtureJson(
      built.release,
      HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    ) ||
    typeof built.installerPath !== 'string' ||
    typeof built.manifestPath !== 'string'
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_RELEASE_INVALID');
  }
  const manifest = await readInstallerManifest(built.manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    expectedRelease: HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    installerPath: built.installerPath,
    manifest,
  });
  if (
    manifest.packageSha256 !== built.manifest.packageSha256 ||
    manifest.packageSize !== built.manifest.packageSize
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_RELEASE_INVALID');
  }
}

export async function createVerifiedHistoricalSourceFixture({
  built,
  identity,
  materialized,
  packagedApplicationIdentity,
  sourceMetadata,
}) {
  const runtimeBuildRevision =
    packagedApplicationIdentity?.buildInfo?.buildRevision;
  if (
    runtimeBuildRevision !==
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision
  ) {
    throw new Error('HISTORICAL_FIXTURE_PACKAGE_IDENTITY_MISMATCH');
  }
  const provenancePath = join(
    materialized.operationRoot,
    'historical-fixture-provenance.json',
  );
  const provenance = createHistoricalWindowsInstallerFixtureProvenance({
    sourceArchiveManifestSha256:
      materialized.provenance.sourceArchiveManifestSha256,
  });
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  const persistedProvenance =
    parseHistoricalWindowsInstallerFixtureProvenance(
      await readHistoricalFixtureJson(provenancePath),
    );
  const classification = classifyHistoricalWindowsInstallerArtifact({
    packageSha256: built.manifest.packageSha256,
    source: 'historical-source-rebuild',
  });
  return Object.freeze({
    ...classification,
    appVersion: built.manifest.appVersion,
    buildRevision: built.manifest.buildRevision,
    installerPath: built.installerPath,
    manifestPath: built.manifestPath,
    packageSha256: built.manifest.packageSha256,
    packageSize: built.manifest.packageSize,
    productCode: identity.productCode,
    provenance: persistedProvenance,
    provenancePath,
    runtimeBuildRevision,
    sourceMetadata,
    upgradeCode: identity.upgradeCode,
  });
}

async function assertHistoricalPackagedApplicationPathBudget(root) {
  const canonicalRoot = await realpath(root).catch(() => null);
  if (canonicalRoot === null) {
    throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
  }
  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
      }
      const canonicalPath = await realpath(entryPath);
      assertHistoricalFixtureContainedPath(canonicalRoot, canonicalPath);
      if (
        canonicalPath.length >
        HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY.maximumLegacyWindowsPathLength
      ) {
        throw new Error('HISTORICAL_FIXTURE_WINDOWS_PATH_BUDGET_EXCEEDED');
      }
      if (metadata.isDirectory()) {
        pending.push(canonicalPath);
      } else if (!metadata.isFile()) {
        throw new Error('HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID');
      }
    }
  }
}
