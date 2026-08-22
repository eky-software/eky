import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertW6bSyntheticPackagedIdentity } from './buildW6bSyntheticNextPatchInstaller.mjs';

const targetRelease = Object.freeze({
  appVersion: '0.2.7',
  msiProductVersion: '0.2.7',
});

test('accepts a clean packaged application with the exact synthetic identity', () => {
  assert.doesNotThrow(() =>
    assertW6bSyntheticPackagedIdentity({
      packaged: {
        appVersion: '0.2.7',
        buildInfo: {
          appVersion: '0.2.7',
          buildDirty: false,
          buildRevision: '147ba4c29d79',
        },
        installerRelease: {
          appVersion: '0.2.7',
          msiProductVersion: '0.2.7',
        },
      },
      targetRelease,
    }),
  );
});

test('rejects dirty, wrong-version and malformed synthetic packages', () => {
  for (const packaged of [
    undefined,
    {
      appVersion: '0.2.6',
      buildInfo: {
        appVersion: '0.2.7',
        buildDirty: false,
        buildRevision: '147ba4c29d79',
      },
      installerRelease: targetRelease,
    },
    {
      appVersion: '0.2.7',
      buildInfo: {
        appVersion: '0.2.7',
        buildDirty: true,
        buildRevision: '147ba4c29d79',
      },
      installerRelease: targetRelease,
    },
    {
      appVersion: '0.2.7',
      buildInfo: {
        appVersion: '0.2.7',
        buildDirty: false,
        buildRevision: 'not-a-revision',
      },
      installerRelease: targetRelease,
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
