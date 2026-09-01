import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS,
  createW6bLegacyTargetRelease,
  createW6bSyntheticNextPatchRelease,
} from './w6bSyntheticWindowsPackageFixture.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '../..');

const currentRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.7',
  architecture: 'x64',
  msiProductVersion: '0.2.7',
  platform: 'win32',
  releaseChannel: 'pilot',
});

test('creates only the exact next patch W6B fixture identity', () => {
  assert.deepEqual(createW6bSyntheticNextPatchRelease(currentRelease), {
    ...currentRelease,
    appVersion: '0.2.8',
    msiProductVersion: '0.2.8',
  });
});

test('keeps the private legacy target at 0.2.7 across the canonical version bump', () => {
  const previousReleaseTarget = createW6bLegacyTargetRelease({
    ...currentRelease,
    appVersion: '0.2.6',
    msiProductVersion: '0.2.6',
  });

  assert.deepEqual(createW6bLegacyTargetRelease(currentRelease), {
    ...currentRelease,
    appVersion: '0.2.7',
    msiProductVersion: '0.2.7',
  });
  assert.deepEqual(previousReleaseTarget, currentRelease);
});

test('rejects non-pilot, mismatched and malformed source identities', () => {
  for (const value of [
    undefined,
    { ...currentRelease, appIdentity: 'Other' },
    { ...currentRelease, releaseChannel: 'stable' },
    { ...currentRelease, architecture: 'arm64' },
    { ...currentRelease, msiProductVersion: '0.2.6' },
    { ...currentRelease, appVersion: '0.2.6-alpha.1' },
  ]) {
    assert.throws(
      () => createW6bSyntheticNextPatchRelease(value),
      /W6B_SYNTHETIC_RELEASE_SOURCE_INVALID|INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID/,
    );
  }

  assert.throws(
    () => createW6bLegacyTargetRelease({ ...currentRelease, extra: true }),
    /W6B_SYNTHETIC_RELEASE_SOURCE_INVALID/,
  );
});

test('keeps every W6B package artifact under the ignored desktop stage', () => {
  const normalizedRoot = W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS.fixtureRoot
    .replaceAll('\\', '/')
    .toLowerCase();
  assert.match(normalizedRoot, /\/apps\/desktop\/\.stage\/w6b\/synthetic-next-patch$/);
  for (const path of Object.values(W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS)) {
    assert.equal(
      path.replaceAll('\\', '/').toLowerCase().startsWith(normalizedRoot),
      true,
    );
  }
});

test('isolates the W6B wrapper from the ordinary Windows package CLI', async () => {
  const [cliSource, coreSource, fixtureSource] = await Promise.all([
    readFile(resolve(desktopDirectory, 'scripts/package-windows.mjs'), 'utf8'),
    readFile(
      resolve(desktopDirectory, 'scripts/packageWindowsApplication.mjs'),
      'utf8',
    ),
    readFile(
      resolve(scriptDirectory, 'w6bSyntheticWindowsPackageFixture.mjs'),
      'utf8',
    ),
  ]);

  assert.doesNotMatch(cliSource, /W6B|w6b/u);
  assert.doesNotMatch(coreSource, /W6B|w6b/u);
  assert.match(cliSource, /Unsupported Windows package argument/u);
  assert.match(fixtureSource, /packageWindowsApplication/u);
  assert.match(fixtureSource, /W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS/u);
});
