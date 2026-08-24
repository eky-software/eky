import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INSTALLER_UPGRADE_CODE,
  createInstallerProductCode,
} from '../installerIdentity.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
  validateHistoricalPackagedApplicationIdentity,
  validateHistoricalSourceMetadata,
  validateHistoricalWindowsInstallerIdentity,
} from './historicalWindowsInstallerFixturePolicy.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
} from './historicalWindowsInstallerFixtureProvenance.mjs';

const approvedCommit = '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032';
const approvedRuntimeRevision = approvedCommit.slice(0, 12);

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

test('rejects historical package build identity drift and production output', () => {
  const valid = {
    buildInfo: {
      appVersion: '0.2.6',
      buildCreatedAt: '2026-08-22T00:00:00.000Z',
      buildDirty: false,
      buildRevision: approvedRuntimeRevision,
      schemaVersion: 1,
    },
    packageModePresent: false,
    pilotManifestPresent: false,
    releaseInfo: {
      ...HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
      buildRevision: approvedRuntimeRevision,
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
      buildInfo: { ...valid.buildInfo, buildRevision: approvedCommit },
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
    {
      ...valid,
      releaseInfo: { ...valid.releaseInfo, buildRevision: approvedCommit },
    },
  ]) {
    assert.throws(
      () => validateHistoricalPackagedApplicationIdentity(candidate),
      /HISTORICAL_FIXTURE_PACKAGE_IDENTITY_MISMATCH/,
    );
  }
});

test('keeps historical MSI provenance full while runtime identity matches the approved package', () => {
  assert.equal(HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit.length, 40);
  assert.equal(
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit.slice(0, 12),
  );
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
