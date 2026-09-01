import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPackageLayout,
  packageWindowsApplication,
} from '../../scripts/packageWindowsApplication.mjs';
import { validateInstallerReleaseConfig } from '../installerVersion.mjs';
import { createW6bSyntheticNextPatchRelease } from './w6bSyntheticWindowsPackageFixture.mjs';
import { prepareW6b2HistoricalBackendStage } from './w6b2HistoricalBackendStage.mjs';
import { writeW6b2PrivateProofPackageMarker } from './w6b2PrivateProofPackageMarker.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '../..');
const fixtureRoot = join(
  desktopDirectory,
  '.stage',
  'w6b2',
  'packaged-success',
);
const w6b2FixtureBaselineVersion = '0.2.6';

export const W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS = Object.freeze({
  fixtureRoot,
  source: createFixturePackagePaths(join(fixtureRoot, 'source')),
  target: createFixturePackagePaths(join(fixtureRoot, 'target')),
});

export function createW6b2SyntheticReleasePair(releaseTemplate) {
  const fixtureBaseline = createW6b2FixtureBaselineRelease(releaseTemplate);
  const source = createW6bSyntheticNextPatchRelease(fixtureBaseline);
  const target = createW6bSyntheticNextPatchRelease(source);
  if (
    source.appVersion !== '0.2.7' ||
    source.msiProductVersion !== '0.2.7' ||
    target.appVersion !== '0.2.8' ||
    target.msiProductVersion !== '0.2.8'
  ) {
    throw new Error('W6B2_SYNTHETIC_RELEASE_PAIR_INVALID');
  }
  return Object.freeze({ source, target });
}

function createW6b2FixtureBaselineRelease(releaseTemplate) {
  let validatedRelease;
  try {
    validatedRelease = validateInstallerReleaseConfig(
      releaseTemplate,
      releaseTemplate?.appVersion,
    );
  } catch {
    throw new Error('W6B2_SYNTHETIC_RELEASE_PAIR_INVALID');
  }
  if (
    validatedRelease.releaseChannel !== 'pilot' ||
    validatedRelease.appVersion !== validatedRelease.msiProductVersion
  ) {
    throw new Error('W6B2_SYNTHETIC_RELEASE_PAIR_INVALID');
  }
  return Object.freeze({
    ...validatedRelease,
    appVersion: w6b2FixtureBaselineVersion,
    msiProductVersion: w6b2FixtureBaselineVersion,
  });
}

export function createW6b2PackageRequest(input) {
  if (
    typeof input !== 'object' ||
    input === null ||
    (input.kind !== 'source' && input.kind !== 'target')
  ) {
    throw new Error('W6B2_PACKAGE_REQUEST_INVALID');
  }
  const paths = W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS[input.kind];
  const request = {
    layout: createPackageLayout(paths),
    pilotBuild: true,
    reportPackagedPath: false,
    releaseOverride: input.release,
  };
  return Object.freeze({
    ...request,
    prepareBackendStage:
      input.kind === 'source'
        ? async (backendStage) => {
            await prepareW6b2HistoricalBackendStage(backendStage);
            await writeW6b2PrivateProofPackageMarker({
              appVersion: input.release.appVersion,
              backendStage,
              role: 'source',
            });
          }
        : async (backendStage) => {
            await writeW6b2PrivateProofPackageMarker({
              appVersion: input.release.appVersion,
              backendStage,
              role: 'target',
            });
          },
  });
}

export async function packageW6b2SyntheticApplications(canonicalRelease) {
  const releases = createW6b2SyntheticReleasePair(canonicalRelease);
  const source = await packageWindowsApplication(
    createW6b2PackageRequest({ kind: 'source', release: releases.source }),
  );
  const target = await packageWindowsApplication(
    createW6b2PackageRequest({ kind: 'target', release: releases.target }),
  );
  return Object.freeze({ releases, source, target });
}

function createFixturePackagePaths(root) {
  return Object.freeze({
    artifactsRoot: join(root, 'installer-artifacts'),
    inputRoot: join(root, 'installer-input'),
    outputDirectory: join(root, 'out'),
    root,
    stagingRoot: join(root, 'package-stage'),
  });
}
