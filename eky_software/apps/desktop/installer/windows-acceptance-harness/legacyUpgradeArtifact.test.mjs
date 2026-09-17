import assert from 'node:assert/strict';
import { link } from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
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
  materializeCurrentLegacyTargetRole,
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
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';

const TARGET_BUILD_REVISION = 'a'.repeat(40);
const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('legacy producer rejects artifact and summary overlap before any build or deletion', async () => {
  const outside = resolve(tmpdir(), 'synthetic-legacy-artifact');
  const summary = resolve(tmpdir(), 'synthetic-legacy-summary.json');
  for (const unsafePath of [DESKTOP_ROOT, ...['.stage', 'out'].flatMap((name) => [
    resolve(DESKTOP_ROOT, name), resolve(DESKTOP_ROOT, name, 'preserved-evidence'),
  ])]) {
    assert.throws(() => parseLegacyUpgradeArtifactBuildArguments([
      '--artifact-root', unsafePath, '--summary-path', summary,
    ]), /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_CLEANUP_OVERLAP/);
    assert.throws(() => parseLegacyUpgradeArtifactBuildArguments([
      '--artifact-root', outside, '--summary-path', unsafePath,
    ]), /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_CLEANUP_OVERLAP/);
    await assert.rejects(buildLegacyUpgradeArtifact({
      artifactRoot: unsafePath,
      readGitState: () => assert.fail('No build preflight inside cleanup root'),
      materializeSourceRole: () => assert.fail('No source build'),
      materializeTargetRole: () => assert.fail('No target build'),
    }), /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_BUILD_CLEANUP_OVERLAP/);
  }
  for (const name of ['.stage-sibling', 'out-sibling']) {
    const artifactRoot = resolve(DESKTOP_ROOT, name);
    assert.equal(parseLegacyUpgradeArtifactBuildArguments([
      '--artifact-root', artifactRoot, '--summary-path', summary,
    ]).artifactRoot, artifactRoot);
  }
});
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

async function createTargetRole(artifactRoot, version = '0.2.7') {
  const targetFixture = await createInstallerRole(
    artifactRoot,
    'target',
    version,
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
    productCode: createInstallerProductCode(version),
  });
}

async function createRoles(artifactRoot, targetVersion) {
  return Object.freeze({
    source: await createSourceRole(artifactRoot),
    target: await createTargetRole(artifactRoot, targetVersion),
  });
}

async function createArtifact(testContext, canCleanup = () => true, targetVersion) {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-artifact-'));
  testContext.after(() => canCleanup() ? rm(root, { force: true, recursive: true }) : undefined);
  const artifactRoot = resolve(root, 'artifact');
  await mkdir(artifactRoot);
  const roles = await createRoles(artifactRoot, targetVersion);
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

for (const version of ['0.2.7', '0.2.8', '0.3.0']) {
  test(`legacy artifact binds the fixed historical source to target ${version}`, async (testContext) => {
    const artifact = await createArtifact(testContext, () => true, version);
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
    assert.equal(verified.target.appVersion, version);
    assert.equal(
      verified.source.provenance.expectedCommit,
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    );
    assert.equal(verified.target.payloadInventory.identity, 'c'.repeat(64));
  });
}

test('legacy filesystem leaf materializes the same artifact identity and preserves verifier failures', async (t) => {
  const runtime = createLegacyUpgradeFilesystemRuntime();
  const canCleanup = () => runtime.outcome().filesystemProcessAbsent;
  const artifact = await createArtifact(t, canCleanup, '0.2.8');
  const root = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-windows-acceptance-v2-legacy-'));
  t.after(() => canCleanup() ? rm(root, { force: true, recursive: true }) : undefined);
  const fixture = await runtime.materializeFixture(artifact.descriptorPath, resolve(root, 'fixture'));
  assert.equal(fixture.descriptorSha256, artifact.descriptorSha256);
  assert.equal(fixture.buildRevision, TARGET_BUILD_REVISION);
  assert.equal(fixture.source.provenance.expectedCommit, HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit);
  await runtime.verifyArtifact(fixture);
  assert.deepEqual(await runtime.verifySemanticPostcondition({ artifact: fixture, runNonce: 'a'.repeat(64), runtimeRoot: root }),
    { status: 'failed', errorCode: 'legacySourceEvidenceReadFailed' });
  await writeFile(resolve(artifact.artifactRoot, 'target', 'Eky-0.2.8-x64.msi'), 'changed source');
  await assert.rejects(runtime.verifyArtifact(fixture), /LEGACY_LOCAL_FIXTURE_CHANGED/);
  assert.equal(await readFile(fixture.target.installerPath, 'utf8'), 'current target');
  assert.equal(runtime.outcome().filesystemProcessAbsent, true);
  assert.equal(runtime.outcome().filesystemErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED');
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

test('legacy descriptor rejects non-upgrades, false product identities and changed historical provenance', async (t) => {
  const { descriptor } = await createArtifact(t);
  for (const version of ['0.2.6', '0.2.5']) {
    assert.throws(() => validateLegacyUpgradeArtifactDescriptor({
      ...descriptor,
      target: { ...descriptor.target, appVersion: version, msiProductVersion: version,
        productCode: createInstallerProductCode(version) },
    }), /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/);
  }
  for (const change of [
    { target: { ...descriptor.target, buildRevision: 'f'.repeat(40) } },
    { target: { ...descriptor.target, productCode: createInstallerProductCode('0.2.8') } },
    { source: { ...descriptor.source, buildRevision: TARGET_BUILD_REVISION } },
    { source: { ...descriptor.source, appVersion: '0.2.7', msiProductVersion: '0.2.7',
      productCode: createInstallerProductCode('0.2.7') } },
  ]) {
    assert.throws(() => validateLegacyUpgradeArtifactDescriptor({ ...descriptor, ...change }),
      /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_DESCRIPTOR_INVALID/);
  }
});

for (const releaseInput of ['canonical', '0.2.8', '0.3.0']) {
  test(`legacy target materializes the validated release ${releaseInput} without rebuilding or changing bytes`, async (t) => {
    const release = releaseInput === 'canonical'
      ? await readInstallerReleaseConfig(resolve(DESKTOP_ROOT, 'installer', 'installer-release.json'),
        resolve(DESKTOP_ROOT, 'package.json'))
      : releaseFor(releaseInput);
    const version = release.appVersion;
    const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-target-'));
    t.after(() => rm(root, { force: true, recursive: true }));
    const payload = resolve(root, 'payload');
    await mkdir(payload);
    await writeFile(resolve(payload, 'Eky.exe'), 'synthetic payload');
    const built = await createInstallerRole(root, 'built', version, TARGET_BUILD_REVISION, 'synthetic MSI bytes');
    const calls = [];
    const role = await materializeCurrentLegacyTargetRole({
      artifactRoot: root, buildRevision: TARGET_BUILD_REVISION,
      ...(releaseInput === 'canonical' ? {} : { targetRelease: release }),
      async packageApplication(options) {
        assert.deepEqual(options, { pilotBuild: true, reportPackagedPath: false });
        calls.push('package');
        return { appVersion: version, packagedPath: payload,
          buildInfo: { buildDirty: false, buildRevision: TARGET_BUILD_REVISION.slice(0, 12) } };
      },
      async createInstallerRelease(options) {
        assert.deepEqual(options, { buildRevision: TARGET_BUILD_REVISION });
        calls.push('installer');
        return { release: releaseFor(version), manifest: built.manifest,
          manifestPath: built.manifestPath, productCode: createInstallerProductCode(version) };
      },
    });
    assert.deepEqual(calls, ['package', 'installer']);
    assert.equal(role.appVersion, version);
    assert.equal(role.msiProductVersion, version);
    assert.equal(role.buildRevision, TARGET_BUILD_REVISION);
    assert.equal(role.productCode, createInstallerProductCode(version));
    assert.equal(role.payloadInventory.fileCount, 1);
    assert.equal(role.packageSha256, built.manifest.packageSha256);
    assert.equal(await readFile(resolve(root, 'target', built.manifest.packageFilename), 'utf8'), 'synthetic MSI bytes');
  });
}

test('legacy target rejects invalid release configuration before packaging', async () => {
  for (const targetRelease of [
    null, releaseFor('0.2.6'), releaseFor('0.2.5'),
    { ...releaseFor('0.2.8'), msiProductVersion: '0.2.9' },
    { ...releaseFor('0.2.8'), releaseChannel: 'stable' },
    { ...releaseFor('0.2.8'), extra: true },
  ]) {
    await assert.rejects(materializeCurrentLegacyTargetRole({
      artifactRoot: resolve(tmpdir(), 'unused-legacy-target'), buildRevision: TARGET_BUILD_REVISION,
      targetRelease,
      packageApplication: () => assert.fail('Invalid release must not package'),
      createInstallerRelease: () => assert.fail('Invalid release must not build MSI'),
    }), /WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID/);
  }
});

test('legacy target rejects a wrong version or unbound packaged build before MSI construction', async () => {
  const packaged = { appVersion: '0.2.8', packagedPath: resolve(tmpdir(), 'unused-legacy-payload'),
    buildInfo: { buildDirty: false, buildRevision: TARGET_BUILD_REVISION.slice(0, 12) } };
  for (const invalid of [
    { ...packaged, appVersion: '0.2.7' },
    { ...packaged, buildInfo: { ...packaged.buildInfo, buildDirty: true } },
    { ...packaged, buildInfo: { ...packaged.buildInfo, buildRevision: 'f'.repeat(12) } },
  ]) {
    await assert.rejects(materializeCurrentLegacyTargetRole({
      artifactRoot: resolve(tmpdir(), 'unused-legacy-target'), buildRevision: TARGET_BUILD_REVISION,
      targetRelease: releaseFor('0.2.8'), packageApplication: async () => invalid,
      createInstallerRelease: () => assert.fail('Unbound payload must not build MSI'),
    }), /WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID/);
  }
});

test('legacy target rejects mismatched installer, manifest and persisted role identities', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-target-rejection-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const payload = resolve(root, 'payload');
  await mkdir(payload);
  await writeFile(resolve(payload, 'Eky.exe'), 'synthetic payload');
  const built = await createInstallerRole(root, 'built', '0.2.8', TARGET_BUILD_REVISION, 'current MSI');
  const other = await createInstallerRole(root, 'other', '0.2.7', TARGET_BUILD_REVISION, 'wrong MSI');
  const valid = { release: releaseFor('0.2.8'), manifest: built.manifest,
    manifestPath: built.manifestPath, productCode: createInstallerProductCode('0.2.8') };
  const cases = [
    { ...valid, release: releaseFor('0.3.0') },
    { ...valid, manifest: { ...built.manifest, appVersion: '0.2.7' } },
    { ...valid, manifest: { ...built.manifest, msiProductVersion: '0.2.7' } },
    { ...valid, manifest: { ...built.manifest, buildRevision: 'f'.repeat(40) } },
    { ...valid, productCode: createInstallerProductCode('0.2.7') },
    { ...valid, manifestPath: other.manifestPath },
  ];
  for (const [index, invalid] of cases.entries()) {
    const artifactRoot = resolve(root, `case-${index}`);
    await mkdir(artifactRoot);
    await assert.rejects(materializeCurrentLegacyTargetRole({
      artifactRoot, buildRevision: TARGET_BUILD_REVISION, targetRelease: releaseFor('0.2.8'),
      packageApplication: async () => ({ appVersion: '0.2.8', packagedPath: payload,
        buildInfo: { buildDirty: false, buildRevision: TARGET_BUILD_REVISION.slice(0, 12) } }),
      createInstallerRelease: async () => invalid,
    }), /WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID/);
  }
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
  const canonicalRelease = await readInstallerReleaseConfig(
    resolve(DESKTOP_ROOT, 'installer', 'installer-release.json'), resolve(DESKTOP_ROOT, 'package.json'),
  );
  const result = await buildLegacyUpgradeArtifact({
    artifactRoot,
    async materializeSourceRole({ artifactRoot: outputRoot }) {
      sourceBuildCount += 1;
      return createSourceRole(outputRoot);
    },
    async materializeTargetRole({ artifactRoot: outputRoot, targetRelease }) {
      targetBuildCount += 1;
      assert.deepEqual(targetRelease, canonicalRelease);
      const existing = await readdir(outputRoot);
      assert.deepEqual(existing, ['source']);
      return createTargetRole(outputRoot, targetRelease.appVersion);
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

test('legacy producer rejects a consistent target that is not the canonical release', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-legacy-release-binding-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const canonical = await readInstallerReleaseConfig(
    resolve(DESKTOP_ROOT, 'installer', 'installer-release.json'), resolve(DESKTOP_ROOT, 'package.json'),
  );
  for (const version of ['0.2.7', '0.3.0'].filter((value) => value !== canonical.appVersion)) {
    const artifactRoot = resolve(root, version);
    await assert.rejects(buildLegacyUpgradeArtifact({
      artifactRoot,
      readGitState: async () => TARGET_BUILD_REVISION,
      materializeSourceRole: ({ artifactRoot: outputRoot }) => createSourceRole(outputRoot),
      materializeTargetRole: ({ artifactRoot: outputRoot }) => createTargetRole(outputRoot, version),
    }), /WINDOWS_ACCEPTANCE_LEGACY_TARGET_IDENTITY_INVALID/);
    await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
  }
});

test('legacy verification rejects a substituted newer target under the original producer digest', async (t) => {
  const artifact = await createArtifact(t);
  const substituted = await createArtifact(t, () => true, '0.2.8');
  await writeFile(artifact.descriptorPath, `${JSON.stringify(substituted.descriptor)}\n`);
  await assert.rejects(verifyLegacyUpgradeArtifact({
    artifactRoot: artifact.artifactRoot,
    expectedBuildRevision: TARGET_BUILD_REVISION,
    expectedDescriptorSha256: artifact.descriptorSha256,
  }), /WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_IDENTITY_MISMATCH/);
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
