import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import {
  INSTALLER_UPGRADE_CODE,
  createInstallerProductCode,
} from '../installerIdentity.mjs';
import { assertPilotBuildPreconditions } from '../../scripts/pilot-build-gate.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE_INTERNALS,
  assertHistoricalLockedInputsUnchanged,
  captureHistoricalLockedInputHashes,
  validateHistoricalPackagedApplicationIdentity,
  validateHistoricalSourceMetadata,
  validateHistoricalWindowsInstallerSource,
  validateHistoricalWindowsInstallerIdentity,
} from './historicalWindowsInstallerFixtureBuilder.mjs';
import { withMaterializedHistoricalWindowsInstallerSource } from './materializeHistoricalWindowsInstallerSource.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const temporaryDirectories = [];
const approvedCommit = '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('accepts only the exact historical source and toolchain metadata', () => {
  const metadata = createValidSourceMetadata();
  assert.doesNotThrow(() => validateHistoricalSourceMetadata(metadata));

  assert.throws(
    () =>
      validateHistoricalSourceMetadata({
        ...metadata,
        desktopPackage: {
          ...metadata.desktopPackage,
          version: '0.2.7',
        },
      }),
    /HISTORICAL_FIXTURE_SOURCE_METADATA_MISMATCH/,
  );
  assert.throws(
    () =>
      validateHistoricalSourceMetadata({
        ...metadata,
        project: metadata.project.replace('7.0.0', '7.0.1'),
      }),
    /HISTORICAL_FIXTURE_TOOLCHAIN_POLICY_MISMATCH/,
  );
});

test('validates the locked metadata from the exact archived source tree', async () => {
  const metadata = await withMaterializedHistoricalWindowsInstallerSource(
    (materialized) =>
      validateHistoricalWindowsInstallerSource(materialized.workspaceRoot),
  );

  assert.deepEqual(
    {
      betterSqliteVersion: metadata.betterSqliteVersion,
      dotnetVersion: metadata.dotnetVersion,
      electronVersion: metadata.electronVersion,
      pnpmVersion: metadata.pnpmVersion,
      wixVersion: metadata.wixVersion,
    },
    {
      betterSqliteVersion: '13.0.2',
      dotnetVersion: '10.0.302',
      electronVersion: '43.3.0',
      pnpmVersion: '11.1.3',
      wixVersion: '7.0.0',
    },
  );
});

test('rejects changed or missing historical lock inputs', async () => {
  const root = await createLockedInputFixture();
  const captured = await captureHistoricalLockedInputHashes(root);

  await writeFile(join(root, 'pnpm-lock.yaml'), 'changed\n');
  await assert.rejects(
    assertHistoricalLockedInputsUnchanged({
      expected: captured,
      workspaceRoot: root,
    }),
    /HISTORICAL_FIXTURE_LOCKED_INPUT_CHANGED/,
  );

  await unlink(join(root, 'pnpm-lock.yaml'));
  await assert.rejects(
    captureHistoricalLockedInputHashes(root),
    /HISTORICAL_FIXTURE_LOCKED_INPUT_INVALID/,
  );
});

test('rejects historical package build identity drift and production output', () => {
  const valid = {
    buildInfo: {
      appVersion: '0.2.6',
      buildCreatedAt: '2026-08-22T00:00:00.000Z',
      buildDirty: false,
      buildRevision: approvedCommit,
      schemaVersion: 1,
    },
    packageModePresent: false,
    pilotManifestPresent: false,
    releaseInfo: {
      ...HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
      buildRevision: approvedCommit,
      schemaVersion: 1,
      upgradeCode: INSTALLER_UPGRADE_CODE,
    },
  };
  assert.doesNotThrow(() =>
    validateHistoricalPackagedApplicationIdentity(valid),
  );
  for (const candidate of [
    { ...valid, buildInfo: { ...valid.buildInfo, buildDirty: true } },
    {
      ...valid,
      buildInfo: { ...valid.buildInfo, buildCreatedAt: '2026-08-22' },
    },
    {
      ...valid,
      buildInfo: { ...valid.buildInfo, buildRevision: 'a'.repeat(40) },
    },
    {
      ...valid,
      buildInfo: { ...valid.buildInfo, unknown: true },
    },
    { ...valid, packageModePresent: true },
    { ...valid, pilotManifestPresent: true },
    {
      ...valid,
      releaseInfo: { ...valid.releaseInfo, releaseChannel: 'stable' },
    },
  ]) {
    assert.throws(
      () => validateHistoricalPackagedApplicationIdentity(candidate),
      /HISTORICAL_FIXTURE_PACKAGE_IDENTITY_MISMATCH/,
    );
  }
});

test('validates the closed MSI ProductCode and UpgradeCode', () => {
  const valid = {
    architecture: 'x64',
    packageScope: 'perUser',
    productCode: `{${createInstallerProductCode('0.2.6')}}`,
    productVersion: '0.2.6',
    upgradeCode: `{${INSTALLER_UPGRADE_CODE}}`,
  };
  assert.doesNotThrow(() => validateHistoricalWindowsInstallerIdentity(valid));
  for (const candidate of [
    { ...valid, productCode: `{${'A'.repeat(32)}}` },
    { ...valid, upgradeCode: `{${'B'.repeat(32)}}` },
    { ...valid, productVersion: '0.2.7' },
  ]) {
    assert.throws(
      () => validateHistoricalWindowsInstallerIdentity(candidate),
      /HISTORICAL_FIXTURE_INSTALLER_IDENTITY_MISMATCH/,
    );
  }
});

test('keeps the ordinary pilot release gate closed to historical provenance', () => {
  assert.throws(
    () =>
      assertPilotBuildPreconditions({
        buildInfo: {
          appVersion: '0.2.6',
          buildDirty: false,
          buildRevision: approvedCommit,
        },
        currentHead: 'f'.repeat(40),
      }),
    /PILOT_BUILD_PRECONDITION_FAILED/,
  );
});

test('does not route historical rebuilds through pilot or local bundle commands', async () => {
  const builder = await readFile(
    join(scriptDirectory, 'historicalWindowsInstallerFixtureBuilder.mjs'),
    'utf8',
  );
  assert.doesNotMatch(builder, /package:windows:pilot/u);
  assert.doesNotMatch(builder, /installer:local-pilot-bundle/u);
  assert.doesNotMatch(builder, /\bcreateLocalPilotReleaseBundle\s*\(/u);

  for (const relativePath of [
    'scripts/package-windows.mjs',
    'installer/scripts/releaseWindowsInstaller.mjs',
    'installer/scripts/createLocalPilotReleaseBundle.mjs',
  ]) {
    const ordinaryPath = await readFile(
      join(desktopDirectory, ...relativePath.split('/')),
      'utf8',
    );
    assert.doesNotMatch(ordinaryPath, /historicalWindowsInstallerFixture/u);
  }
});

function createValidSourceMetadata() {
  return {
    backendPackage: {
      dependencies: { 'better-sqlite3': '13.0.2' },
    },
    desktopPackage: {
      devDependencies: { electron: '43.3.0' },
      version: '0.2.6',
    },
    globalJson: {
      sdk: {
        allowPrerelease: false,
        rollForward: 'disable',
        version: '10.0.302',
      },
    },
    nugetConfig:
      '<add key="signatureValidationMode" value="require" />\n' +
      '<add key="nuget.org" value="https://api.nuget.org/v3/index.json" />\n' +
      '<package pattern="WixToolset.Sdk" />\n' +
      '<author name="FireGiant">',
    packagesLock: {
      version: 1,
      dependencies: { 'native,Version=v0.0': {} },
    },
    project:
      '<Project Sdk="WixToolset.Sdk/7.0.0">' +
      '<RestoreLockedMode>true</RestoreLockedMode></Project>',
    release: HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    rootPackage: {
      engines: { node: '>=24 <25' },
      packageManager: 'pnpm@11.1.3',
    },
  };
}

async function createLockedInputFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-historical-locks-'));
  temporaryDirectories.push(root);
  for (const relativePath of
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE_INTERNALS.lockedInputRelativePaths) {
    const path = join(root, ...relativePath.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${relativePath}\n`);
  }
  return root;
}
