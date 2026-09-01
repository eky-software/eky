import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPackageLayout,
  packageWindowsApplication,
} from '../../scripts/packageWindowsApplication.mjs';
import { validateInstallerReleaseConfig } from '../installerVersion.mjs';
import {
  createUpgradeFixtureAppVersion,
  createUpgradeFixtureMsiVersion,
} from './prepareWindowsInstallerUpgradeFixture.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '../..');
const fixtureRoot = join(
  desktopDirectory,
  '.stage',
  'w6b',
  'synthetic-next-patch',
);
const w6bLegacyTargetVersion = '0.2.7';

export const W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS = Object.freeze({
  artifactsRoot: join(fixtureRoot, 'installer-artifacts'),
  fixtureRoot,
  inputRoot: join(fixtureRoot, 'installer-input'),
  outputDirectory: join(fixtureRoot, 'out'),
  stagingRoot: join(fixtureRoot, 'package-stage'),
});

export function createW6bSyntheticNextPatchRelease(currentRelease) {
  if (
    typeof currentRelease !== 'object' ||
    currentRelease === null ||
    Array.isArray(currentRelease) ||
    currentRelease.appIdentity !== 'Eky' ||
    currentRelease.architecture !== 'x64' ||
    currentRelease.platform !== 'win32' ||
    currentRelease.releaseChannel !== 'pilot' ||
    typeof currentRelease.appVersion !== 'string' ||
    typeof currentRelease.msiProductVersion !== 'string' ||
    currentRelease.appVersion !== currentRelease.msiProductVersion
  ) {
    throw new Error('W6B_SYNTHETIC_RELEASE_SOURCE_INVALID');
  }

  const appVersion = createUpgradeFixtureAppVersion(
    currentRelease.appVersion,
  );
  const msiProductVersion = createUpgradeFixtureMsiVersion(
    currentRelease.msiProductVersion,
  );
  if (appVersion !== msiProductVersion) {
    throw new Error('W6B_SYNTHETIC_RELEASE_VERSION_MISMATCH');
  }

  return Object.freeze({
    ...currentRelease,
    appVersion,
    msiProductVersion,
  });
}

export function createW6bLegacyTargetRelease(releaseTemplate) {
  let validatedRelease;
  try {
    validatedRelease = validateInstallerReleaseConfig(
      releaseTemplate,
      releaseTemplate?.appVersion,
    );
  } catch {
    throw new Error('W6B_SYNTHETIC_RELEASE_SOURCE_INVALID');
  }
  if (
    validatedRelease.releaseChannel !== 'pilot' ||
    validatedRelease.appVersion !== validatedRelease.msiProductVersion
  ) {
    throw new Error('W6B_SYNTHETIC_RELEASE_SOURCE_INVALID');
  }

  return Object.freeze({
    ...validatedRelease,
    appVersion: w6bLegacyTargetVersion,
    msiProductVersion: w6bLegacyTargetVersion,
  });
}

export async function packageW6bSyntheticNextPatchApplication(
  currentRelease,
) {
  const release = createW6bLegacyTargetRelease(currentRelease);
  const packaged = await packageWindowsApplication({
    layout: createPackageLayout(W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS),
    pilotBuild: true,
    reportPackagedPath: false,
    releaseOverride: release,
  });
  return Object.freeze({
    ...packaged,
    paths: W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS,
  });
}
