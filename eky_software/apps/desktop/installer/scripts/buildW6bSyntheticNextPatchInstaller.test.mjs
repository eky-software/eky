import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertW6bSyntheticPackagedIdentity } from './buildW6bSyntheticNextPatchInstaller.mjs';

const targetRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.7',
  architecture: 'x64',
  msiProductVersion: '0.2.7',
  platform: 'win32',
  releaseChannel: 'pilot',
});

const validPackaged = Object.freeze({
  appVersion: '0.2.7',
  buildInfo: Object.freeze({
    appVersion: '0.2.7',
    buildDirty: false,
    buildRevision: '147ba4c29d79',
  }),
  installerRelease: targetRelease,
  manifestPath: 'Eky-win32-x64.pilot-manifest.json',
});

test('accepts a clean packaged application with the exact synthetic identity', () => {
  assert.doesNotThrow(() =>
    assertW6bSyntheticPackagedIdentity({
      packaged: validPackaged,
      targetRelease,
    }),
  );
});

test('rejects dirty, wrong-version and malformed synthetic packages', () => {
  for (const packaged of [
    undefined,
    {
      ...validPackaged,
      appVersion: '0.2.6',
    },
    {
      ...validPackaged,
      buildInfo: {
        ...validPackaged.buildInfo,
        appVersion: '0.2.7',
        buildDirty: true,
      },
    },
    {
      ...validPackaged,
      buildInfo: {
        ...validPackaged.buildInfo,
        buildRevision: 'not-a-revision',
      },
    },
    { ...validPackaged, manifestPath: '' },
    {
      ...validPackaged,
      installerRelease: { ...targetRelease, releaseChannel: 'development' },
    },
  ]) {
    assert.throws(
      () =>
        assertW6bSyntheticPackagedIdentity({
          packaged,
          targetRelease,
        }),
      /W6B_SYNTHETIC_PACKAGED_IDENTITY_INVALID/,
    );
  }
});
