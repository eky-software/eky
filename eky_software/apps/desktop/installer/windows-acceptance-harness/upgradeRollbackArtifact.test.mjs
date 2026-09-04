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
  buildUpgradeRollbackArtifact,
  buildStagedInstallerSet,
  copyClosedPayloadTree,
  createUpgradeRollbackReleasePair,
  parseUpgradeRollbackArtifactBuildArguments,
} from './buildUpgradeRollbackArtifact.mjs';
import {
  UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  createUpgradeRollbackArtifactDescriptor,
  hashUpgradeRollbackArtifactFile,
  validateUpgradeRollbackArtifactDescriptor,
  verifyUpgradeRollbackArtifact,
} from './upgradeRollbackArtifact.mjs';
import {
  materializeUpgradeRollbackArtifactFixture,
  verifyUpgradeRollbackArtifactSourceFixture,
} from './upgradeRollbackArtifactFixture.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { parseUpgradeRollbackArtifactVerifierArguments } from './verifyUpgradeRollbackArtifact.mjs';

const BUILD_REVISION = 'a'.repeat(40);
const RELEASE_TEMPLATE = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.7',
  architecture: 'x64',
  msiProductVersion: '0.2.7',
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

async function createRole(root, roleName, version, packageBytes) {
  const roleRoot = resolve(root, roleName);
  await mkdir(roleRoot, { recursive: true });
  const installerPath = resolve(roleRoot, `Eky-${version}-x64.msi`);
  const manifestPath = resolve(roleRoot, 'installer.manifest.json');
  await writeFile(installerPath, packageBytes);
  const manifest = await createInstallerManifest({
    buildRevision: BUILD_REVISION,
    installerPath,
    release: releaseFor(version),
  });
  await writeInstallerManifest(manifestPath, manifest);
  return Object.freeze({ manifest, manifestPath });
}

async function createArtifact(testContext) {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-artifact-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const artifactRoot = resolve(root, 'artifact');
  await mkdir(artifactRoot);
  const source = await createRole(artifactRoot, 'source', '0.2.7', 'source');
  const target = await createRole(artifactRoot, 'target', '0.2.8', 'target');
  const windowsRollback = await createRole(
    artifactRoot,
    'windowsRollback',
    '0.2.8',
    'rollback',
  );
  const roles = {};
  for (const [roleName, role] of Object.entries({
    source,
    target,
    windowsRollback,
  })) {
    roles[roleName] = {
      appVersion: role.manifest.appVersion,
      manifestPath: `${roleName}/installer.manifest.json`,
      manifestSha256: (
        await hashUpgradeRollbackArtifactFile(role.manifestPath)
      ).sha256,
      msiProductVersion: role.manifest.msiProductVersion,
      packageSha256: role.manifest.packageSha256,
      packageSize: role.manifest.packageSize,
      productCode: createInstallerProductCode(role.manifest.msiProductVersion),
    };
  }
  const descriptor = createUpgradeRollbackArtifactDescriptor({
    buildRevision: BUILD_REVISION,
    roles,
  });
  const descriptorPath = resolve(
    artifactRoot,
    UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  );
  await writeJsonAtomicExclusive(descriptorPath, descriptor);
  const descriptorSha256 = (
    await hashUpgradeRollbackArtifactFile(descriptorPath)
  ).sha256;
  return Object.freeze({
    artifactRoot,
    descriptor,
    descriptorPath,
    descriptorSha256,
    root,
  });
}

test('upgrade artifact validates one exact source, target, and rollback package', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const result = await verifyUpgradeRollbackArtifact({
    artifactRoot: artifact.artifactRoot,
    expectedBuildRevision: BUILD_REVISION,
    expectedDescriptorSha256: artifact.descriptorSha256,
  });

  assert.deepEqual(
    (await readdir(artifact.artifactRoot)).sort(),
    [
      UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
      'source',
      'target',
      'windowsRollback',
    ].sort(),
  );
  assert.equal(result.roles.source.appVersion, '0.2.7');
  assert.equal(result.roles.target.appVersion, '0.2.8');
  assert.notEqual(
    result.roles.target.packageSha256,
    result.roles.windowsRollback.packageSha256,
  );
});

test('upgrade artifact rejects descriptor, package, and inventory drift', async (testContext) => {
  const descriptorDrift = await createArtifact(testContext);
  await writeFile(descriptorDrift.descriptorPath, '{}\n');
  await assert.rejects(
    verifyUpgradeRollbackArtifact({
      artifactRoot: descriptorDrift.artifactRoot,
      expectedDescriptorSha256: descriptorDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_IDENTITY_MISMATCH/,
  );

  const packageDrift = await createArtifact(testContext);
  await writeFile(
    resolve(packageDrift.artifactRoot, 'target', 'Eky-0.2.8-x64.msi'),
    'changed',
  );
  await assert.rejects(
    verifyUpgradeRollbackArtifact({
      artifactRoot: packageDrift.artifactRoot,
      expectedDescriptorSha256: packageDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PACKAGE_INVALID/,
  );

  const inventoryDrift = await createArtifact(testContext);
  await writeFile(resolve(inventoryDrift.artifactRoot, 'unexpected'), 'x');
  await assert.rejects(
    verifyUpgradeRollbackArtifact({
      artifactRoot: inventoryDrift.artifactRoot,
      expectedDescriptorSha256: inventoryDrift.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVENTORY_INVALID/,
  );
});

test('upgrade artifact rejects hardlinked package bytes', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const packagePath = resolve(
    artifact.artifactRoot,
    'source',
    'Eky-0.2.7-x64.msi',
  );
  const externalPath = resolve(artifact.root, 'external.msi');
  await unlink(packagePath);
  await writeFile(externalPath, 'source');
  await link(externalPath, packagePath);
  await assert.rejects(
    verifyUpgradeRollbackArtifact({
      artifactRoot: artifact.artifactRoot,
      expectedDescriptorSha256: artifact.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID/,
  );
});

test('upgrade artifact rejects a hardlinked descriptor before hashing it', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const descriptorBytes = await readFile(artifact.descriptorPath);
  const externalPath = resolve(artifact.root, 'external-descriptor.json');
  await unlink(artifact.descriptorPath);
  await writeFile(externalPath, descriptorBytes);
  await link(externalPath, artifact.descriptorPath);
  await assert.rejects(
    verifyUpgradeRollbackArtifact({
      artifactRoot: artifact.artifactRoot,
      expectedDescriptorSha256: artifact.descriptorSha256,
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INVALID/,
  );
});

test('upgrade descriptor rejects nonconsecutive and aliased roles', async (testContext) => {
  const artifact = await createArtifact(testContext);
  assert.throws(
    () =>
      validateUpgradeRollbackArtifactDescriptor({
        ...artifact.descriptor,
        roles: {
          ...artifact.descriptor.roles,
          target: {
            ...artifact.descriptor.roles.target,
            appVersion: '0.2.9',
            msiProductVersion: '0.2.9',
          },
        },
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID/,
  );
  assert.throws(
    () =>
      validateUpgradeRollbackArtifactDescriptor({
        ...artifact.descriptor,
        roles: {
          ...artifact.descriptor.roles,
          windowsRollback: {
            ...artifact.descriptor.roles.windowsRollback,
            packageSha256: artifact.descriptor.roles.target.packageSha256,
          },
        },
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_DESCRIPTOR_INVALID/,
  );
});

test('local fixture copies independent bytes and detects source drift', async (testContext) => {
  const artifact = await createArtifact(testContext);
  const fixtureRoot = resolve(artifact.root, 'fixture');
  const fixture = await materializeUpgradeRollbackArtifactFixture(
    artifact.descriptorPath,
    fixtureRoot,
  );
  assert.equal(fixture.descriptorSha256, artifact.descriptorSha256);
  await verifyUpgradeRollbackArtifactSourceFixture(fixture);
  await writeFile(
    resolve(artifact.artifactRoot, 'source', 'Eky-0.2.7-x64.msi'),
    'changed',
  );
  await assert.rejects(
    verifyUpgradeRollbackArtifactSourceFixture(fixture),
    /WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED/,
  );
});

test('artifact producer consumes one staged installer set and removes staging', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-producer-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const stageRoot = resolve(root, 'stage');
  await mkdir(stageRoot);
  const source = await createRole(stageRoot, 'source', '0.2.7', 'source');
  const target = await createRole(stageRoot, 'target', '0.2.8', 'target');
  const windowsRollback = await createRole(
    stageRoot,
    'windowsRollback',
    '0.2.8',
    'rollback',
  );
  let buildCount = 0;
  const artifactRoot = resolve(root, 'artifact');
  const result = await buildUpgradeRollbackArtifact({
    artifactRoot,
    async createStagedInstallerSet() {
      buildCount += 1;
      return {
        buildRevision: BUILD_REVISION,
        roles: { source, target, windowsRollback },
        stageRoot,
      };
    },
  });

  assert.equal(buildCount, 1);
  assert.equal(result.resultCode, 'upgradeRollbackArtifactBuilt');
  await assert.rejects(readdir(stageRoot), { code: 'ENOENT' });
  await verifyUpgradeRollbackArtifact({
    artifactRoot,
    expectedBuildRevision: BUILD_REVISION,
    expectedDescriptorSha256: result.descriptorSha256,
  });
});

test('rollback payload copy creates its owned parent and independent bytes', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-payload-copy-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const sourceRoot = resolve(root, 'source');
  const sourceNested = resolve(sourceRoot, 'nested');
  const targetRoot = resolve(root, 'missing-parent', 'payload');
  await mkdir(sourceNested, { recursive: true });
  await writeFile(resolve(sourceRoot, 'root.txt'), 'root');
  await writeFile(resolve(sourceNested, 'nested.txt'), 'nested');

  await copyClosedPayloadTree(sourceRoot, targetRoot);

  assert.equal(await readFile(resolve(targetRoot, 'root.txt'), 'utf8'), 'root');
  assert.equal(
    await readFile(resolve(targetRoot, 'nested', 'nested.txt'), 'utf8'),
    'nested',
  );
  await writeFile(resolve(sourceRoot, 'root.txt'), 'changed');
  assert.equal(await readFile(resolve(targetRoot, 'root.txt'), 'utf8'), 'root');
});

test('artifact producer removes its default staging after a package failure', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-stage-failure-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const stageRoot = resolve(root, 'stage');
  await assert.rejects(
    buildStagedInstallerSet({
      stageRoot,
      readGitState: async () => BUILD_REVISION,
      packageApplication: async () => {
        throw new Error('PACKAGE_FAILED');
      },
    }),
    /PACKAGE_FAILED/,
  );
  await assert.rejects(readdir(stageRoot), { code: 'ENOENT' });
});

test('stage cleanup failure removes a completed artifact and fails closed', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-cleanup-failure-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const stageRoot = resolve(root, 'stage');
  await mkdir(stageRoot);
  const source = await createRole(stageRoot, 'source', '0.2.7', 'source');
  const target = await createRole(stageRoot, 'target', '0.2.8', 'target');
  const windowsRollback = await createRole(
    stageRoot,
    'windowsRollback',
    '0.2.8',
    'rollback',
  );
  const artifactRoot = resolve(root, 'artifact');
  await assert.rejects(
    buildUpgradeRollbackArtifact({
      artifactRoot,
      async createStagedInstallerSet() {
        return {
          buildRevision: BUILD_REVISION,
          roles: { source, target, windowsRollback },
          stageRoot,
        };
      },
      async removeTree(path, options) {
        if (resolve(path) === stageRoot) {
          throw new Error('synthetic cleanup failure');
        }
        await rm(path, options);
      },
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_STAGE_CLEANUP_FAILED/,
  );
  await assert.rejects(readdir(artifactRoot), { code: 'ENOENT' });
});

test('stage cleanup failure does not replace the primary artifact error', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-primary-error-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const stageRoot = resolve(root, 'stage');
  await mkdir(stageRoot);
  const target = await createRole(stageRoot, 'target', '0.2.8', 'target');
  const windowsRollback = await createRole(
    stageRoot,
    'windowsRollback',
    '0.2.8',
    'rollback',
  );
  await assert.rejects(
    buildUpgradeRollbackArtifact({
      artifactRoot: resolve(root, 'artifact'),
      async createStagedInstallerSet() {
        return {
          buildRevision: BUILD_REVISION,
          roles: {
            source: { manifestPath: resolve(stageRoot, 'missing.json') },
            target,
            windowsRollback,
          },
          stageRoot,
        };
      },
      async removeTree(path, options) {
        if (resolve(path) === stageRoot) {
          throw new Error('synthetic cleanup failure');
        }
        await rm(path, options);
      },
    }),
    /WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_INVALID/,
  );
});

test('artifact producer rejects overlapping staging and artifact roots', async (testContext) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-v2-upgrade-overlap-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const stageRoot = resolve(root, 'stage');
  await mkdir(stageRoot);
  await assert.rejects(
    buildUpgradeRollbackArtifact({
      artifactRoot: resolve(stageRoot, 'artifact'),
      async createStagedInstallerSet() {
        return {
          buildRevision: BUILD_REVISION,
          roles: {},
          stageRoot,
        };
      },
    }),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_STAGE_OVERLAP_INVALID/,
  );
  await assert.rejects(readdir(stageRoot), { code: 'ENOENT' });
});

test('release derivation and CLI arguments are closed', () => {
  const pair = createUpgradeRollbackReleasePair(RELEASE_TEMPLATE);
  assert.equal(pair.source.appVersion, '0.2.7');
  assert.equal(pair.target.appVersion, '0.2.8');
  assert.deepEqual(
    parseUpgradeRollbackArtifactBuildArguments([
      '--artifact-root',
      'C:\\temp\\artifact',
      '--summary-path',
      'C:\\temp\\summary.json',
    ]),
    {
      artifactRoot: 'C:\\temp\\artifact',
      summaryPath: 'C:\\temp\\summary.json',
    },
  );
  assert.deepEqual(
    parseUpgradeRollbackArtifactVerifierArguments([
      '--artifact-root',
      'C:\\temp\\artifact',
      '--expected-descriptor-sha256',
      'b'.repeat(64),
      '--expected-build-revision',
      BUILD_REVISION,
    ]),
    {
      artifactRoot: 'C:\\temp\\artifact',
      expectedDescriptorSha256: 'b'.repeat(64),
      expectedBuildRevision: BUILD_REVISION,
    },
  );
  assert.throws(
    () =>
      parseUpgradeRollbackArtifactBuildArguments([
        '--artifact-root',
        'artifact',
        '--summary-path',
        'C:\\temp\\summary.json',
      ]),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_ARGUMENTS_INVALID/,
  );
});
