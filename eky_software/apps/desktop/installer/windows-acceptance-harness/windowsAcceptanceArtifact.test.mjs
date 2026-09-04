import assert from 'node:assert/strict';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
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

const RELEASE = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '9.8.7',
  architecture: 'x64',
  msiProductVersion: '9.8.7',
  platform: 'win32',
  releaseChannel: 'pilot',
});
const BUILD_REVISION = 'a'.repeat(40);

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
  const manifestPath = resolve(sourceRoot, 'source.manifest.json');
  await writeFile(installerPath, 'synthetic-msi-bytes');
  const manifest = await createInstallerManifest({
    buildRevision: BUILD_REVISION,
    installerPath,
    release: RELEASE,
  });
  await writeInstallerManifest(manifestPath, manifest);
  return Object.freeze({ installerPath, manifestPath });
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
  return Object.freeze({ artifactRoot, fixture, root, source });
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
    'Eky-9.8.7-x64.msi',
    'source.manifest.json',
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

  const result = await buildWindowsAcceptanceArtifact({
    artifactRoot,
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
      return { manifestPath: source.manifestPath };
    },
  });

  assert.equal(gitStateReadCount, 1);
  assert.equal(applicationBuildCount, 1);
  assert.equal(releaseBuildCount, 1);
  assert.equal(result.resultCode, 'windowsAcceptanceArtifactBuilt');
  assert.equal(result.appVersion, '9.8.7');
});

test('producer rejects a descriptor from a different build revision', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-build-drift-test-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const source = await createSourceFixture(root);
  const artifactRoot = resolve(root, 'artifact');

  await assert.rejects(
    buildWindowsAcceptanceArtifact({
      artifactRoot,
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
