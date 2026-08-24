import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createW6b2PackageRequest,
  createW6b2SyntheticReleasePair,
} from './w6b2SyntheticWindowsPackageFixture.mjs';
import { prepareW6b2HistoricalBackendStage } from './w6b2HistoricalBackendStage.mjs';

const canonicalRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.6',
  architecture: 'x64',
  msiProductVersion: '0.2.6',
  platform: 'win32',
  releaseChannel: 'pilot',
});

test('creates private numeric 0.2.7 to 0.2.8 fixture releases without changing the canonical release', () => {
  const pair = createW6b2SyntheticReleasePair(canonicalRelease);

  assert.equal(pair.source.appVersion, '0.2.7');
  assert.equal(pair.source.msiProductVersion, '0.2.7');
  assert.equal(pair.target.appVersion, '0.2.8');
  assert.equal(pair.target.msiProductVersion, '0.2.8');
  assert.equal(canonicalRelease.appVersion, '0.2.6');
});

test('limits the historical backend preparation to the private W6B.2 source fixture', () => {
  const pair = createW6b2SyntheticReleasePair(canonicalRelease);
  const source = createW6b2PackageRequest({
    kind: 'source',
    release: pair.source,
  });
  const target = createW6b2PackageRequest({
    kind: 'target',
    release: pair.target,
  });

  assert.equal(
    source.prepareBackendStage,
    prepareW6b2HistoricalBackendStage,
  );
  assert.equal('prepareBackendStage' in target, false);
});

test('rejects unsupported fixture release baselines and package kinds', () => {
  assert.throws(
    () =>
      createW6b2SyntheticReleasePair({
        ...canonicalRelease,
        appVersion: '0.2.7',
        msiProductVersion: '0.2.7',
      }),
    /W6B2_SYNTHETIC_RELEASE_PAIR_INVALID/u,
  );
  assert.throws(
    () => createW6b2PackageRequest({ kind: 'ordinary' }),
    /W6B2_PACKAGE_REQUEST_INVALID/u,
  );
});
