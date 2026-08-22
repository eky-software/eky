import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  verifyExactLocalHistoricalWindowsInstallerFixture,
  verifyHistoricalInstallerRelease,
  verifyHistoricalPackagedApplication,
} from './historicalWindowsInstallerVerifier.mjs';

test('rejects an alternate exact-local bundle root before reading artifacts', async () => {
  await assert.rejects(
    verifyExactLocalHistoricalWindowsInstallerFixture({
      localBundleRoot: 'alternate-local-bundle',
    }),
    /HISTORICAL_FIXTURE_LOCAL_BUNDLE_PATH_INVALID/,
  );
});

test('rejects an incomplete historical installer release', async () => {
  await assert.rejects(
    verifyHistoricalInstallerRelease({}),
    /HISTORICAL_FIXTURE_INSTALLER_RELEASE_INVALID/,
  );
});

test('rejects a missing packaged application root', async () => {
  await assert.rejects(
    verifyHistoricalPackagedApplication('missing-historical-workspace'),
    /HISTORICAL_FIXTURE_PACKAGE_OUTPUT_INVALID/,
  );
});
