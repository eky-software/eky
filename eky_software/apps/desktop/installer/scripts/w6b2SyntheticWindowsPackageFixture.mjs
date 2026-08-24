import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPackageLayout,
  packageWindowsApplication,
} from '../../scripts/packageWindowsApplication.mjs';
import { createW6bSyntheticNextPatchRelease } from './w6bSyntheticWindowsPackageFixture.mjs';
import { prepareW6b2HistoricalBackendStage } from './w6b2HistoricalBackendStage.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '../..');
const fixtureRoot = join(
  desktopDirectory,
  '.stage',
  'w6b2',
  'packaged-success',
);

export const W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS = Object.freeze({
  fixtureRoot,
  source: createFixturePackagePaths(join(fixtureRoot, 'source')),
  target: createFixturePackagePaths(join(fixtureRoot, 'target')),
});

export function createW6b2SyntheticReleasePair(canonicalRelease) {
  const source = createW6bSyntheticNextPatchRelease(canonicalRelease);
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
  if (input.kind === 'source') {
    return Object.freeze({
      ...request,
      prepareBackendStage: prepareW6b2HistoricalBackendStage,
    });
  }
  return Object.freeze(request);
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
    outputDirectory: join(root, 'out'),
    stagingRoot: join(root, 'package-stage'),
  });
}
