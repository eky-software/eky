import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  createInstallerManifest,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import { createLocalPilotReleaseBundle } from '../scripts/createLocalPilotReleaseBundle.mjs';
import {
  buildWindowsAcceptanceArtifact,
  parseWindowsAcceptanceArtifactBuildArguments,
} from './buildWindowsAcceptanceArtifact.mjs';
import { detachWindowsInstallerBuildOutput } from './detachWindowsInstallerBuildOutput.mjs';
import {
  materializeImmutableInstallerFixture,
} from './localImmutableInstallerFixture.mjs';
import {
  parseWindowsAcceptanceArtifactVerifierArguments,
  verifyWindowsAcceptanceArtifact,
} from './verifyWindowsAcceptanceArtifact.mjs';
import { CLEAN_ARTIFACT_DESCRIPTOR_FILENAME, validateWindowsAcceptanceArtifactDescriptor } from './windowsAcceptanceArtifactDescriptor.mjs';

const RELEASE = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '9.8.7',
  architecture: 'x64',
  msiProductVersion: '9.8.7',
  platform: 'win32',
  releaseChannel: 'pilot',
});
const BUILD_REVISION = 'a'.repeat(40);
const PAYLOAD = Object.freeze({ stage: 'packagedApp', fileCount: 1, totalByteSize: 1, identity: 'c'.repeat(64) });

function createPackagedApplication(
  buildRevision = BUILD_REVISION,
  appVersion = RELEASE.appVersion,
) {
  return Object.freeze({
    appVersion,
    buildInfo: Object.freeze({ buildRevision }),
  });
}

async function createSourceFixture(root) {
  const sourceRoot = resolve(root, 'source');
  await mkdir(sourceRoot, { recursive: false });
  const installerPath = resolve(sourceRoot, 'Eky-9.8.7-x64.msi');
  const manifestPath = resolve(sourceRoot, 'Eky-9.8.7-x64.manifest.json');
  await writeFile(installerPath, 'synthetic-msi-bytes');
  const manifest = await createInstallerManifest({
    buildRevision: BUILD_REVISION,
    installerPath,
    release: RELEASE,
  });
  await writeInstallerManifest(manifestPath, manifest);
  return Object.freeze({ installerPath, manifestPath, release: RELEASE });
}

async function createArtifactFixture(testContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-artifact-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const artifactRoot = resolve(root, 'artifact');
  const fixture = await materializeImmutableInstallerFixture(
    source.manifestPath,
    artifactRoot,
  );
  const descriptor = JSON.stringify({ schemaVersion: 1, buildRevision: BUILD_REVISION,
    manifestSha256: fixture.artifactDescriptorSha256, payload: PAYLOAD });
  await writeFile(resolve(artifactRoot, CLEAN_ARTIFACT_DESCRIPTOR_FILENAME), descriptor);
  return Object.freeze({ artifactRoot, fixture: { ...fixture,
    artifactDescriptorSha256: createHash('sha256').update(descriptor).digest('hex') }, root, source });
}

test('producer materializes one SHA-locked installer descriptor and package', async (testContext) => {
  const { artifactRoot, fixture } = await createArtifactFixture(testContext);
  const verified = await verifyWindowsAcceptanceArtifact({
    artifactRoot,
    expectedDescriptorSha256: fixture.artifactDescriptorSha256,
    expectedBuildRevision: BUILD_REVISION,
  });

  assert.deepEqual((await readdir(artifactRoot)).sort(), [
    'Eky-9.8.7-x64.msi',
    'clean-install-artifact.json',
    'installer.manifest.json',
  ]);
  assert.equal(verified.appVersion, '9.8.7');
  assert.equal(
    verified.descriptorSha256,
    fixture.artifactDescriptorSha256,
  );
  assert.equal(verified.packageSha256, fixture.packageSha256);
  await assert.rejects(
    verifyWindowsAcceptanceArtifact({
      artifactRoot,
      expectedDescriptorSha256: fixture.artifactDescriptorSha256,
      expectedBuildRevision: 'b'.repeat(40),
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH/,
  );
});

test('consumer rejects descriptor drift, package drift, and extra inventory', async (testContext) => {
  const first = await createArtifactFixture(testContext);
  await writeFile(
    resolve(first.artifactRoot, 'installer.manifest.json'),
    '{}\n',
  );
  await assert.rejects(
    verifyWindowsAcceptanceArtifact({
      artifactRoot: first.artifactRoot,
      expectedDescriptorSha256: first.fixture.artifactDescriptorSha256,
      expectedBuildRevision: BUILD_REVISION,
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_MISMATCH/,
  );

  const second = await createArtifactFixture(testContext);
  await writeFile(
    resolve(second.artifactRoot, 'Eky-9.8.7-x64.msi'),
    'changed-msi-bytes',
  );
  await assert.rejects(
    verifyWindowsAcceptanceArtifact({
      artifactRoot: second.artifactRoot,
      expectedDescriptorSha256: second.fixture.artifactDescriptorSha256,
      expectedBuildRevision: BUILD_REVISION,
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_PACKAGE_INVALID/,
  );

  const third = await createArtifactFixture(testContext);
  await writeFile(resolve(third.artifactRoot, 'unexpected.txt'), 'unexpected');
  await assert.rejects(
    verifyWindowsAcceptanceArtifact({
      artifactRoot: third.artifactRoot,
      expectedDescriptorSha256: third.fixture.artifactDescriptorSha256,
      expectedBuildRevision: BUILD_REVISION,
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_INVENTORY_INVALID/,
  );
});

test('consumer rejects a hardlinked package even when bytes match', async (testContext) => {
  const { artifactRoot, fixture, root } =
    await createArtifactFixture(testContext);
  const packagePath = resolve(artifactRoot, 'Eky-9.8.7-x64.msi');
  const externalPath = resolve(root, 'external-msi');
  await unlink(packagePath);
  await writeFile(externalPath, 'synthetic-msi-bytes');
  await link(externalPath, packagePath);

  await assert.rejects(
    verifyWindowsAcceptanceArtifact({
      artifactRoot,
      expectedDescriptorSha256: fixture.artifactDescriptorSha256,
      expectedBuildRevision: BUILD_REVISION,
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_INVALID/,
  );
});

test('clean payload evidence is strict and bound to the immutable descriptor', async (t) => {
  const { artifactRoot, fixture } = await createArtifactFixture(t);
  const value = { schemaVersion: 1, buildRevision: BUILD_REVISION,
    manifestSha256: 'a'.repeat(64), payload: PAYLOAD };
  assert.deepEqual(validateWindowsAcceptanceArtifactDescriptor(value), value);
  for (const invalid of [{ ...value, extra: true }, { ...value, payload: { ...PAYLOAD, identity: '../escape' } },
    { ...value, payload: { ...PAYLOAD, fileCount: 0 } }, { ...value, payload: { ...PAYLOAD, stage: 'backendStage' } }]) {
    assert.throws(() => validateWindowsAcceptanceArtifactDescriptor(invalid), /WINDOWS_ACCEPTANCE_ARTIFACT_INVALID/);
  }
  await writeFile(resolve(artifactRoot, CLEAN_ARTIFACT_DESCRIPTOR_FILENAME), JSON.stringify(value));
  await assert.rejects(verifyWindowsAcceptanceArtifact({ artifactRoot,
    expectedDescriptorSha256: fixture.artifactDescriptorSha256, expectedBuildRevision: BUILD_REVISION }),
  /WINDOWS_ACCEPTANCE_ARTIFACT_IDENTITY_MISMATCH/);
});

test('producer rejects payload changes during MSI creation without publishing an artifact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-payload-drift-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await createSourceFixture(root);
  let inspections = 0;
  const artifactRoot = resolve(root, 'artifact');
  await assert.rejects(buildWindowsAcceptanceArtifact({ artifactRoot,
    readReleaseGitState: async () => BUILD_REVISION,
    packageApplication: async () => createPackagedApplication(),
    createInstallerRelease: async () => ({ manifestPath: source.manifestPath }),
    inspectPayload: async () => ++inspections === 1 ? PAYLOAD : { ...PAYLOAD, identity: 'd'.repeat(64) },
  }), /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH/);
  assert.equal(inspections, 2);
  await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
});

test('producer detaches a hardlinked trusted build output before transfer', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-detach-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const intermediatePath = resolve(root, 'intermediate-msi');
  await link(source.installerPath, intermediatePath);
  assert.equal((await lstat(source.installerPath)).nlink, 2);

  const result = await detachWindowsInstallerBuildOutput(source.manifestPath);

  assert.equal(result.detached, true);
  assert.equal((await lstat(source.installerPath)).nlink, 1);
  assert.equal((await lstat(intermediatePath)).nlink, 1);
  assert.deepEqual((await readdir(resolve(root, 'source'))).sort(), [
    'Eky-9.8.7-x64.manifest.json',
    'Eky-9.8.7-x64.msi',
  ]);
});

test('build orchestration invokes each package producer exactly once', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-build-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const artifactRoot = resolve(root, 'artifact');
  let gitStateReadCount = 0;
  let applicationBuildCount = 0;
  let releaseBuildCount = 0;
  let bundleCount = 0;

  const result = await buildWindowsAcceptanceArtifact({
    artifactRoot,
    inspectPayload: async () => PAYLOAD,
    async readReleaseGitState() {
      gitStateReadCount += 1;
      return BUILD_REVISION;
    },
    async packageApplication(options) {
      applicationBuildCount += 1;
      assert.deepEqual(options, {
        pilotBuild: true,
        reportPackagedPath: false,
      });
      return createPackagedApplication();
    },
    async createInstallerRelease({ buildRevision }) {
      releaseBuildCount += 1;
      assert.equal(buildRevision, BUILD_REVISION);
      return source;
    },
    async createPilotBundle(options) {
      bundleCount += 1;
      assert.equal(options.buildRevision, BUILD_REVISION);
      assert.equal(options.installerPath, source.installerPath);
      assert.equal(options.manifestPath, source.manifestPath);
      assert.equal(options.outputRoot, resolve(artifactRoot, 'pilot-bundle-verification'));
      const bundle = await createLocalPilotReleaseBundle(options);
      assert.deepEqual(await readFile(bundle.installerPath), await readFile(source.installerPath));
      assert.deepEqual(await readFile(bundle.manifestPath), await readFile(source.manifestPath));
      return bundle;
    },
  });

  assert.equal(gitStateReadCount, 1);
  assert.equal(applicationBuildCount, 1);
  assert.equal(releaseBuildCount, 1);
  assert.equal(bundleCount, 1);
  assert.equal(result.pilotBundleResultCode, 'pilotBundleVerified');
  assert.equal(result.resultCode, 'windowsAcceptanceArtifactBuilt');
  assert.equal(result.appVersion, '9.8.7');
  assert.deepEqual((await readdir(artifactRoot)).sort(), [
    'Eky-9.8.7-x64.msi', 'clean-install-artifact.json', 'installer.manifest.json',
  ]);
});

test('producer rejects failed or altered pilot bundle verification without releasing an artifact', async (t) => {
  for (const fault of ['builderFailure', 'checksumDrift', 'differentValidPackage']) {
    await t.test(fault, async (subtest) => {
      const root = await mkdtemp(join(tmpdir(), 'eky-v2-bundle-contract-'));
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const source = await createSourceFixture(root);
      const artifactRoot = resolve(root, 'artifact');
      const failure = new Error('SYNTHETIC_BUNDLE_FAILURE');
      await assert.rejects(buildWindowsAcceptanceArtifact({
        artifactRoot,
        inspectPayload: async () => PAYLOAD,
        readReleaseGitState: async () => BUILD_REVISION,
        packageApplication: async () => createPackagedApplication(),
        createInstallerRelease: async () => source,
        async createPilotBundle(options) {
          if (fault === 'builderFailure') throw failure;
          const bundle = await createLocalPilotReleaseBundle(options);
          if (fault === 'checksumDrift') {
            await writeFile(bundle.checksumPath, 'invalid-checksum');
          } else {
            await writeFile(bundle.installerPath, 'different-valid-msi');
            const manifest = await createInstallerManifest({
              buildRevision: BUILD_REVISION, installerPath: bundle.installerPath, release: RELEASE,
            });
            await unlink(bundle.manifestPath);
            await writeInstallerManifest(bundle.manifestPath, manifest);
            await writeFile(bundle.checksumPath, `${manifest.packageSha256}  ${manifest.packageFilename}\n`);
          }
          return bundle;
        },
      }), fault === 'builderFailure' ? (error) => error === failure :
        fault === 'checksumDrift' ? /INSTALLER_PILOT_BUNDLE_CHECKSUM_INVALID/ :
          /WINDOWS_ACCEPTANCE_ARTIFACT_PILOT_BUNDLE_MISMATCH/);
      await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
      assert.equal(await readFile(source.installerPath, 'utf8'), 'synthetic-msi-bytes');
    });
  }
});

test('producer rejects a descriptor from a different build revision', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-build-drift-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const artifactRoot = resolve(root, 'artifact');

  await assert.rejects(
    buildWindowsAcceptanceArtifact({
      artifactRoot,
      inspectPayload: async () => PAYLOAD,
      async readReleaseGitState() {
        return 'b'.repeat(40);
      },
      async packageApplication() {
        return createPackagedApplication('b'.repeat(12));
      },
      async createInstallerRelease() {
        return { manifestPath: source.manifestPath };
      },
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH/,
  );
  await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
});

test('producer never removes a pre-existing artifact root', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-build-existing-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const artifactRoot = resolve(root, 'artifact');
  await mkdir(artifactRoot, { recursive: false });
  await writeFile(resolve(artifactRoot, 'owner-marker'), 'pre-existing');

  await assert.rejects(
    buildWindowsAcceptanceArtifact({
      artifactRoot,
      inspectPayload: async () => PAYLOAD,
      async readReleaseGitState() {
        return BUILD_REVISION;
      },
      async packageApplication() {
        return createPackagedApplication();
      },
      async createInstallerRelease() {
        return { manifestPath: source.manifestPath };
      },
    }),
  );
  assert.deepEqual(await readdir(artifactRoot), ['owner-marker']);
});

test('stale packaged application prevents the MSI producer from running', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-build-stale-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const artifactRoot = resolve(root, 'artifact');
  let releaseBuildCount = 0;

  await assert.rejects(
    buildWindowsAcceptanceArtifact({
      artifactRoot,
      async readReleaseGitState() {
        return BUILD_REVISION;
      },
      async packageApplication() {
        return createPackagedApplication('b'.repeat(12));
      },
      async createInstallerRelease() {
        releaseBuildCount += 1;
        throw new Error('RELEASE_MUST_NOT_RUN');
      },
    }),
    /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH/,
  );
  assert.equal(releaseBuildCount, 0);
  await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
});

test('producer and consumer CLIs require closed absolute arguments', () => {
  const artifactRoot = resolve(tmpdir(), 'artifact');
  const summaryPath = resolve(tmpdir(), 'summary.json');
  const transportedArtifactRoot = artifactRoot.replaceAll(sep, sep.repeat(2));
  const transportedSummaryPath = summaryPath.replaceAll(sep, sep.repeat(2));
  const hash = 'a'.repeat(64);
  assert.deepEqual(
    parseWindowsAcceptanceArtifactBuildArguments([
      '--artifact-root',
      artifactRoot,
      '--summary-path',
      summaryPath,
    ]),
    { artifactRoot, summaryPath },
  );
  assert.deepEqual(
    parseWindowsAcceptanceArtifactVerifierArguments([
      '--artifact-root',
      artifactRoot,
      '--expected-descriptor-sha256',
      hash,
      '--expected-build-revision',
      BUILD_REVISION,
    ]),
    {
      artifactRoot,
      expectedDescriptorSha256: hash,
      expectedBuildRevision: BUILD_REVISION,
    },
  );
  assert.deepEqual(
    parseWindowsAcceptanceArtifactBuildArguments([
      '--artifact-root',
      transportedArtifactRoot,
      '--summary-path',
      transportedSummaryPath,
    ]),
    { artifactRoot, summaryPath },
  );
  assert.deepEqual(
    parseWindowsAcceptanceArtifactVerifierArguments([
      '--artifact-root',
      transportedArtifactRoot,
      '--expected-descriptor-sha256',
      hash,
      '--expected-build-revision',
      BUILD_REVISION,
    ]),
    {
      artifactRoot,
      expectedDescriptorSha256: hash,
      expectedBuildRevision: BUILD_REVISION,
    },
  );
  assert.throws(
    () =>
      parseWindowsAcceptanceArtifactBuildArguments([
        '--artifact-root',
        artifactRoot,
        '--summary-path',
        resolve(artifactRoot, 'summary.json'),
      ]),
    /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseWindowsAcceptanceArtifactVerifierArguments([
        '--artifact-root',
        'relative-artifact',
        '--expected-descriptor-sha256',
        hash,
        '--expected-build-revision',
        BUILD_REVISION,
      ]),
    /WINDOWS_ACCEPTANCE_ARTIFACT_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseWindowsAcceptanceArtifactVerifierArguments([
        '--artifact-root',
        artifactRoot,
        '--expected-descriptor-sha256',
        'invalid',
        '--expected-build-revision',
        BUILD_REVISION,
      ]),
    /WINDOWS_ACCEPTANCE_ARTIFACT_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseWindowsAcceptanceArtifactBuildArguments([
        '--artifact-root',
        `${artifactRoot}${sep}`,
        '--summary-path',
        summaryPath,
      ]),
    /WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseWindowsAcceptanceArtifactVerifierArguments([
        '--artifact-root',
        `${resolve(tmpdir(), 'parent')}${sep}..${sep}artifact`,
        '--expected-descriptor-sha256',
        hash,
        '--expected-build-revision',
        BUILD_REVISION,
      ]),
    /WINDOWS_ACCEPTANCE_ARTIFACT_ARGUMENTS_INVALID/,
  );
});
