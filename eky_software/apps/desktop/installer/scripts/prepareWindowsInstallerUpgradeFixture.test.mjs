import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createUpgradeFixtureAppVersion,
  createUpgradeFixtureMsiVersion,
  validateUpgradeFixtureReleaseRevision,
} from './prepareWindowsInstallerUpgradeFixture.mjs';

test('creates the next numeric patch version for the synthetic upgrade', () => {
  assert.equal(
    createUpgradeFixtureAppVersion('0.1.0'),
    '0.1.1',
  );
  assert.equal(
    createUpgradeFixtureAppVersion('1.2.3'),
    '1.2.4',
  );
  assert.throws(
    () => createUpgradeFixtureAppVersion('1.2.3-alpha.1'),
    /INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID/,
  );
});

test('increments only the MSI build version for the synthetic upgrade', () => {
  assert.equal(createUpgradeFixtureMsiVersion('0.1.1'), '0.1.2');
  assert.equal(createUpgradeFixtureMsiVersion('255.255.65534'), '255.255.65535');
  assert.throws(
    () => createUpgradeFixtureMsiVersion('255.255.65535'),
    /INSTALLER_UPGRADE_FIXTURE_MSI_VERSION_EXHAUSTED/,
  );
});

test('accepts only a frozen release revision in the clean harness ancestry', () => {
  const releaseRevision = 'a'.repeat(40);
  const harnessRevision = 'b'.repeat(40);

  assert.equal(
    validateUpgradeFixtureReleaseRevision({
      artifactRevision: releaseRevision,
      currentRevision: harnessRevision,
      isAncestor: true,
    }),
    releaseRevision,
  );
  assert.throws(
    () => validateUpgradeFixtureReleaseRevision({
      artifactRevision: releaseRevision,
      currentRevision: harnessRevision,
      isAncestor: false,
    }),
    /INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_INVALID/,
  );
  assert.throws(
    () => validateUpgradeFixtureReleaseRevision({
      artifactRevision: 'not-a-revision',
      currentRevision: harnessRevision,
      isAncestor: true,
    }),
    /INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_INVALID/,
  );
});
