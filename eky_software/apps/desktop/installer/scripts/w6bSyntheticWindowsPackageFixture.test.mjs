import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  W6B_SYNTHETIC_WINDOWS_PACKAGE_PATHS,
  createW6bSyntheticNextPatchRelease,
} from './w6bSyntheticWindowsPackageFixture.mjs';

const currentRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.6',
  architecture: 'x64',
  msiProductVersion: '0.2.6',
  platform: 'win32',
  releaseChannel: 'pilot',
});

test('creates only the exact next patch W6B fixture identity', () => {
  assert.deepEqual(createW6bSyntheticNextPatchRelease(currentRelease), {
    ...currentRelease,
    appVersion: '0.2.7',
    msiProductVersion: '0.2.7',
  });
});

test('rejects non-pilot, mismatched and malformed source identities', () => {
  for (const value of [
    undefined,
    { ...currentRelease, appIdentity: 'Other' },
    { ...currentRelease, releaseChannel: 'stable' },
    { ...currentRelease, architecture: 'arm64' },
    { ...currentRelease, appVersion: '0.2.5' },
    { ...currentRelease, appVersion: '0.2.6-alpha.1' },
  ]) {
    assert.throws(
      () => createW6bSyntheticNextPatchRelease(value),
      /W6B_SYNTHETIC_RELEASE_SOURCE_INVALID|INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID/,
    );
  }
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
