import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createUpgradeFixtureAppVersion,
  createUpgradeFixtureMsiVersion,
} from './prepareWindowsInstallerUpgradeFixture.mjs';

test('creates a distinct synthetic app version without changing the release line', () => {
  assert.equal(
    createUpgradeFixtureAppVersion('0.1.0-alpha.1'),
    '0.1.0-alpha.1.installer-upgrade.1',
  );
  assert.equal(
    createUpgradeFixtureAppVersion('1.2.3'),
    '1.2.3-installer-upgrade.1',
  );
  assert.throws(
    () => createUpgradeFixtureAppVersion('1.2.3+build'),
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
