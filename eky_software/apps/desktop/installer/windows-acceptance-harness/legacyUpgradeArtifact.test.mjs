import assert from 'node:assert/strict';
import { link } from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import {
  createInstallerManifest,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES,
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  createHistoricalWindowsInstallerFixtureProvenance,
} from '../scripts/historicalWindowsInstallerFixtureProvenance.mjs';
import {
  buildLegacyUpgradeArtifact,
  parseLegacyUpgradeArtifactBuildArguments,
} from './buildLegacyUpgradeArtifact.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import {
  LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  createLegacyUpgradeArtifactDescriptor,
  hashLegacyUpgradeArtifactFile,
  validateLegacyUpgradeArtifactDescriptor,
  verifyLegacyUpgradeArtifact,
} from './legacyUpgradeArtifact.mjs';
import { parseLegacyUpgradeArtifactVerifierArguments } from './verifyLegacyUpgradeArtifact.mjs';

const TARGET_BUILD_REVISION = 'a'.repeat(40);
const SOURCE_ARCHIVE_SHA256 = 'b'.repeat(64);
const RELEASE_TEMPLATE = Object.freeze({
  appIdentity: 'Eky',
  architecture: 'x64',
  platform: 'win32',
  releaseChannel: 'pilot',
});

function releaseFor(version) {
  return Object.freeze({
    ...RELEASE_TEMPLATE,
    appVersion: version,
    msiProductVersion: version,
  });
}

async function createInstallerRole(
  artifactRoot,
  roleName,
  version,
  buildRevision,
  packageBytes,
) {
  const roleRoot = resolve(artifactRoot, roleName);
  await mkdir(roleRoot, { recursive: true });
  const installerPath = resolve(roleRoot, `Eky-${version}-x64.msi`);
  const manifestPath = resolve(roleRoot, 'installer.manifest.json');
  await writeFile(installerPath, packageBytes);
  const manifest = await createInstallerManifest({
    buildRevision,
    installerPath,
    release: releaseFor(version),
  });
  await writeInstallerManifest(manifestPath, manifest);
  return Object.freeze({ manifest, manifestPath, roleRoot });
}

async function createSourceRole(artifactRoot) {
  const sourceFixture = await createInstallerRole(
    artifactRoot,
    'source',
    '0.2.6',
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    'historical source',
  );
  const provenancePath = resolve(
    sourceFixture.roleRoot,
    'historical-fixture-provenance.json',
  );
  await writeFile(
    provenancePath,
    `${JSON.stringify(
      createHistoricalWindowsInstallerFixtureProvenance({
        createdAt: '2026-09-04T00:00:00.000Z',
        sourceArchiveManifestSha256: SOURCE_ARCHIVE_SHA256,
      }),
      null,
      2,
    )}\n`,
    'utf8',
  );
  return Object.freeze({
    appVersion: sourceFixture.manifest.appVersion,
    artifactClass:
      HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.historicalSourceRebuild,
    buildRevision: sourceFixture.manifest.buildRevision,
    manifestPath: 'source/installer.manifest.json',
    manifestSha256: (
      await hashLegacyUpgradeArtifactFile(sourceFixture.manifestPath)
    ).sha256,
    matchesApprovedArtifact: false,
    msiProductVersion: sourceFixture.manifest.msiProductVersion,
    packageSha256: sourceFixture.manifest.packageSha256,
    packageSize: sourceFixture.manifest.packageSize,
    productCode: createInstallerProductCode('0.2.6'),
    provenancePath: 'source/historical-fixture-provenance.json',
    provenanceSha256: (
      await hashLegacyUpgradeArtifactFile(provenancePath)
    ).sha256,
    runtimeBuildRevision:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
  });
}

async function createTargetRole(artifactRoot) {
  const targetFixture = await createInstallerRole(
    artifactRoot,
    'target',
    '0.2.7',
    TARGET_BUILD_REVISION,
    'current target',
  );
  return Object.freeze({
    appVersion: targetFixture.manifest.appVersion,
    buildRevision: targetFixture.manifest.buildRevision,
    manifestPath: 'target/installer.manifest.json',
    manifestSha256: (
      await hashLegacyUpgradeArtifactFile(targetFixture.manifestPath)
    ).sha256,
    msiProductVersion: targetFixture.manifest.msiProductVersion,
    packageSha256: targetFixture.manifest.packageSha256,
    packageSize: targetFixture.manifest.packageSize,
    payloadInventory: Object.freeze({
      fileCount: 2_400,
      identity: 'c'.repeat(64),
      stage: 'packagedApp',
      totalByteSize: 220_000_000,
    }),
    productCode: createInstallerProductCode('0.2.7'),
  });
}

async function createRoles(artifactRoot) {
  return Object.freeze({
    source: await createSourceRole(artifactRoot),
    target: await createTargetRole(artifactRoot),
  });
}

async function createArtifact(testContext) {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-artifact-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const artifactRoot = resolve(root, 'artifact');
  await mkdir(artifactRoot);
  const roles = await createRoles(artifactRoot);
  const descriptor = createLegacyUpgradeArtifactDescriptor({
    buildRevision: TARGET_BUILD_REVISION,
    ...roles,
  });
  const descriptorPath = resolve(
    artifactRoot,
    LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
  );
  await writeJsonAtomicExclusive(descriptorPath, descriptor);
  const descriptorSha256 = (
    await hashLegacyUpgradeArtifactFile(descriptorPath)
  ).sha256;
  return Object.freeze({
    artifactRoot,
    descriptor,
    descriptorPath,
    descriptorSha256,
    root,
  });
}

test('legacy artifact binds one historical source and one current target', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const verified = await verifyLegacyUpgradeArtifact({
    artifactRoot: artifact.artifactRoot,
    expectedBuildRevision: TARGET_BUILD_REVISION,
    expectedDescriptorSha256: artifact.descriptorSha256,
  });

  assert.deepEqual((await readdir(artifact.artifactRoot)).sort(), [
    LEGACY_UPGRADE_DESCRIPTOR_FILENAME,
    'source',
    'target',
  ]);
  assert.equal(verified.source.appVersion, '0.2.6');
  assert.equal(verified.target.appVersion, '0.2.7');
  assert.equal(
    verified.source.provenance.expectedCommit,
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
  );
  assert.equal(verified.target.payloadInventory.identity, 'c'.repeat(64));
});

test('legacy descriptor rejects drifted identity and unknown fields', async (testContext) => {
  const artifact = await createArtifact(testContext);
  assert.throws(
    () =>
      validateLegacyUpgradeArtifactDescriptor({
        ...artifact.descriptor,
        target: { ...artifact.descriptor.target, appVersion: '0.2.8' },
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/,
  );
  assert.throws(
    () =>
      validateLegacyUpgradeArtifactDescriptor({
        ...artifact.descriptor,
        source: { ...artifact.descriptor.source, extra: true },
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/,
  );
  assert.throws(
    () =>
      validateLegacyUpgradeArtifactDescriptor({
        ...artifact.descriptor,
        source: {
          ...artifact.descriptor.source,
          matchesApprovedArtifact: true,
        },
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/,
  );
  assert.throws(
    () =>
      validateLegacyUpgradeArtifactDescriptor({
        ...artifact.descriptor,
        target: {
          ...artifact.descriptor.target,
          payloadInventory: {
            ...artifact.descriptor.target.payloadInventory,
            extra: true,
          },
        },
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/,
  );
});

test('legacy artifact rejects package, provenance, and inventory drift', async (testContext) => {
  const packageDrift = await createArtifact(testContext);
  await writeFile(
    resolve(packageDrift.artifactRoot, 'target', 'Eky-0.2.7-x64.msi'),
    'changed',
  );
  await assert.rejects(
    verifyLegacyUpgradeArtifact({
      artifactRoot: packageDrift.artifactRoot,
      expectedDescriptorSha256: packageDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_PACKAGE_INVALID/,
  );

  const provenanceDrift = await createArtifact(testContext);
  await writeFile(
    resolve(
      provenanceDrift.artifactRoot,
      'source',
      'historical-fixture-provenance.json',
    ),
    '{}\n',
  );
  await assert.rejects(
    verifyLegacyUpgradeArtifact({
      artifactRoot: provenanceDrift.artifactRoot,
      expectedDescriptorSha256: provenanceDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH/,
  );

  const inventoryDrift = await createArtifact(testContext);
  await writeFile(resolve(inventoryDrift.artifactRoot, 'unexpected'), 'x');
  await assert.rejects(
    verifyLegacyUpgradeArtifact({
      artifactRoot: inventoryDrift.artifactRoot,
      expectedDescriptorSha256: inventoryDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVENTORY_INVALID/,
  );
});

test('legacy artifact rejects hardlinked package bytes', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const packagePath = resolve(
    artifact.artifactRoot,
    'source',
    'Eky-0.2.6-x64.msi',
  );
  const externalPath = resolve(artifact.root, 'external.msi');
  const bytes = await readFile(packagePath);
  await unlink(packagePath);
  await writeFile(externalPath, bytes);
  await link(externalPath, packagePath);
  await assert.rejects(
    verifyLegacyUpgradeArtifact({
      artifactRoot: artifact.artifactRoot,
      expectedDescriptorSha256: artifact.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_INVALID/,
  );
});

test('legacy producer consumes exactly one source and target build', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-producer-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const artifactRoot = resolve(root, 'artifact');
  let sourceBuildCount = 0;
  let targetBuildCount = 0;
  const result = await buildLegacyUpgradeArtifact({
    artifactRoot,
    async materializeSourceRole({ artifactRoot: outputRoot }) {
      sourceBuildCount += 1;
      return createSourceRole(outputRoot);
    },
    async materializeTargetRole({ artifactRoot: outputRoot }) {
      targetBuildCount += 1;
      const existing = await readdir(outputRoot);
      assert.deepEqual(existing, ['source']);
      return createTargetRole(outputRoot);
    },
    async readGitState() {
      return TARGET_BUILD_REVISION;
    },
  });

  assert.equal(sourceBuildCount, 1);
  assert.equal(targetBuildCount, 1);
  assert.equal(result.resultCode, 'legacyUpgradeArtifactBuilt');
  await verifyLegacyUpgradeArtifact({
    artifactRoot,
    expectedBuildRevision: TARGET_BUILD_REVISION,
    expectedDescriptorSha256: result.descriptorSha256,
  });
});

test('legacy artifact producer and verifier arguments are closed', () => {
  const artifactRoot = resolve(tmpdir(), 'legacy-artifact');
  const summaryPath = resolve(tmpdir(), 'legacy-summary.json');
  assert.deepEqual(
    parseLegacyUpgradeArtifactBuildArguments([
      '--artifact-root',
      artifactRoot,
      '--summary-path',
      summaryPath,
    ]),
    { artifactRoot, summaryPath },
  );
  assert.deepEqual(
    parseLegacyUpgradeArtifactVerifierArguments([
      '--artifact-root',
      artifactRoot,
      '--expected-descriptor-sha256',
      'd'.repeat(64),
      '--expected-build-revision',
      TARGET_BUILD_REVISION,
    ]),
    {
      artifactRoot,
      expectedDescriptorSha256: 'd'.repeat(64),
      expectedBuildRevision: TARGET_BUILD_REVISION,
    },
  );
  assert.throws(
    () =>
      parseLegacyUpgradeArtifactBuildArguments([
        '--artifact-root',
        'relative',
        '--summary-path',
        summaryPath,
      ]),
    /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_ARGUMENTS_INVALID/,
  );
});
