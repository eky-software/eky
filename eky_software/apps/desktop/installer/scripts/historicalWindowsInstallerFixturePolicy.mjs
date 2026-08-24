import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INSTALLER_APP_IDENTITY,
  INSTALLER_UPGRADE_CODE,
  createInstallerProductCode,
} from '../installerIdentity.mjs';
import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE } from './historicalWindowsInstallerFixtureProvenance.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');

export const HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE = Object.freeze({
  appIdentity: INSTALLER_APP_IDENTITY,
  appVersion: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion,
  architecture: 'x64',
  msiProductVersion:
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
  platform: 'win32',
  releaseChannel: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.releaseChannel,
});

export const HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY = Object.freeze({
  desktopDirectory,
  exactLocalBundleRoot: join(
    installerDirectory,
    'local-pilot-releases',
    'Eky-0.2.6-x64-local-unsigned-pilot',
  ),
  exactLocalChecksumFilename: 'Eky-0.2.6-x64.sha256.txt',
  exactLocalInstallerFilename: 'Eky-0.2.6-x64.msi',
  exactLocalManifestFilename: 'Eky-0.2.6-x64.manifest.json',
  expectedBetterSqliteVersion: '13.0.2',
  expectedDotnetVersion: '10.0.302',
  expectedElectronVersion: '43.3.0',
  expectedNodeMajor: 24,
  expectedPnpmVersion: '11.1.3',
  expectedWixVersion: '7.0.0',
  gitRepositoryRoot: resolve(repositoryRoot, '..'),
  installerDirectory,
  lockedInputRelativePaths: Object.freeze([
    'package.json',
    'pnpm-lock.yaml',
    'global.json',
    'apps/backend/package.json',
    'apps/desktop/package.json',
    'apps/desktop/installer/installer-release.json',
    'apps/desktop/installer/installerIdentity.mjs',
    'apps/desktop/installer/Eky.Installer.wixproj',
    'apps/desktop/installer/NuGet.Config',
    'apps/desktop/installer/packages.lock.json',
  ]),
  maximumJsonBytes: 64 * 1024,
  maximumLegacyWindowsPathLength: 259,
  repositoryRoot,
  scriptDirectory,
});

export function validateHistoricalSourceMetadata({
  backendPackage,
  desktopPackage,
  globalJson,
  nugetConfig,
  packagesLock,
  project,
  release,
  rootPackage,
}) {
  const {
    expectedBetterSqliteVersion,
    expectedDotnetVersion,
    expectedElectronVersion,
    expectedPnpmVersion,
    expectedWixVersion,
  } = HISTORICAL_WINDOWS_INSTALLER_FIXTURE_POLICY;
  if (
    !isRecord(rootPackage) ||
    rootPackage.packageManager !== `pnpm@${expectedPnpmVersion}` ||
    !isRecord(rootPackage.engines) ||
    rootPackage.engines.node !== '>=24 <25' ||
    !isRecord(desktopPackage) ||
    desktopPackage.version !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    !isRecord(desktopPackage.devDependencies) ||
    desktopPackage.devDependencies.electron !== expectedElectronVersion ||
    !isRecord(backendPackage) ||
    !isRecord(backendPackage.dependencies) ||
    backendPackage.dependencies['better-sqlite3'] !==
      expectedBetterSqliteVersion ||
    !sameHistoricalFixtureJson(globalJson, {
      sdk: {
        allowPrerelease: false,
        rollForward: 'disable',
        version: expectedDotnetVersion,
      },
    }) ||
    !sameHistoricalFixtureJson(packagesLock, {
      dependencies: { 'native,Version=v0.0': {} },
      version: 1,
    }) ||
    !sameHistoricalFixtureJson(
      release,
      HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    )
  ) {
    throw new Error('HISTORICAL_FIXTURE_SOURCE_METADATA_MISMATCH');
  }
  if (
    typeof project !== 'string' ||
    !project.includes(`Project Sdk="WixToolset.Sdk/${expectedWixVersion}"`) ||
    !project.includes('<RestoreLockedMode>true</RestoreLockedMode>') ||
    typeof nugetConfig !== 'string' ||
    !nugetConfig.includes(
      '<add key="signatureValidationMode" value="require" />',
    ) ||
    (nugetConfig.match(/<add key="nuget\.org"/gu) ?? []).length !== 1 ||
    !nugetConfig.includes(
      'value="https://api.nuget.org/v3/index.json"',
    ) ||
    !nugetConfig.includes('<package pattern="WixToolset.Sdk" />') ||
    !nugetConfig.includes('<author name="FireGiant">')
  ) {
    throw new Error('HISTORICAL_FIXTURE_TOOLCHAIN_POLICY_MISMATCH');
  }
}

export function validateHistoricalWindowsInstallerIdentity(value) {
  const expectedProductCode = `{${createInstallerProductCode(
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
  )}}`;
  const expectedUpgradeCode = `{${INSTALLER_UPGRADE_CODE}}`;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 5 ||
    value.architecture !== 'x64' ||
    value.packageScope !== 'perUser' ||
    typeof value.productCode !== 'string' ||
    value.productCode.toUpperCase() !== expectedProductCode ||
    value.productVersion !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion ||
    typeof value.upgradeCode !== 'string' ||
    value.upgradeCode.toUpperCase() !== expectedUpgradeCode
  ) {
    throw new Error('HISTORICAL_FIXTURE_INSTALLER_IDENTITY_MISMATCH');
  }
  return Object.freeze({ ...value });
}

export function validateHistoricalPackagedApplicationIdentity({
  buildInfo,
  packageModePresent,
  pilotManifestPresent,
  releaseInfo,
}) {
  const expectedReleaseInfo = {
    ...HISTORICAL_WINDOWS_INSTALLER_EXPECTED_RELEASE,
    buildRevision:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
    schemaVersion: 1,
    upgradeCode: INSTALLER_UPGRADE_CODE,
  };
  if (
    !isRecord(buildInfo) ||
    !hasExactKeys(buildInfo, [
      'appVersion',
      'buildCreatedAt',
      'buildDirty',
      'buildRevision',
      'schemaVersion',
    ]) ||
    buildInfo.appVersion !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    typeof buildInfo.buildCreatedAt !== 'string' ||
    !isCanonicalIsoTimestamp(buildInfo.buildCreatedAt) ||
    buildInfo.buildRevision !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision ||
    buildInfo.buildDirty !== false ||
    buildInfo.schemaVersion !== 1 ||
    !isRecord(releaseInfo) ||
    !sameHistoricalFixtureJson(releaseInfo, expectedReleaseInfo) ||
    packageModePresent !== false ||
    pilotManifestPresent !== false ||
    !hasExactKeys(releaseInfo, Object.keys(expectedReleaseInfo))
  ) {
    throw new Error('HISTORICAL_FIXTURE_PACKAGE_IDENTITY_MISMATCH');
  }
  return Object.freeze({ buildInfo, releaseInfo });
}

export function sameHistoricalFixtureJson(left, right) {
  return (
    JSON.stringify(canonicalizeJson(left)) ===
    JSON.stringify(canonicalizeJson(right))
  );
}

export function isHistoricalFixtureRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isHistoricalFixtureRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isCanonicalIsoTimestamp(value) {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isRecord(value) {
  return isHistoricalFixtureRecord(value);
}
