import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createWindowsPackageReleaseIdentity,
  getUpdateFixtureMigrationMode,
  getWindowsPackageDirectoryNames,
  readWindowsPackageBuildMode,
} from './windows-update-package-fixture.mjs';

describe('Windows update package fixtures', () => {
  it('keeps normal and pilot packaging separate from test fixtures', () => {
    assert.deepEqual(readWindowsPackageBuildMode([]), {
      kind: 'standard',
      pilot: false,
    });
    assert.deepEqual(readWindowsPackageBuildMode(['--pilot']), {
      kind: 'standard',
      pilot: true,
    });
    assert.deepEqual(
      getWindowsPackageDirectoryNames(readWindowsPackageBuildMode([])),
      { output: 'out', staging: '.stage' },
    );
  });

  it('uses monotonic non-release identities for actual update fixtures', () => {
    const current = readWindowsPackageBuildMode(['--update-e2e-current']);
    const next = readWindowsPackageBuildMode(['--update-e2e-next']);
    const failure = readWindowsPackageBuildMode(['--update-e2e-failure']);
    const release = { appVersion: '9.9.9', msiProductVersion: '9.9.9' };

    assert.deepEqual(createWindowsPackageReleaseIdentity(current, release), {
      appVersion: '0.0.0-update-fixture.1',
      msiProductVersion: '0.0.1',
    });
    assert.deepEqual(createWindowsPackageReleaseIdentity(next, release), {
      appVersion: '0.0.0-update-fixture.2',
      msiProductVersion: '0.0.2',
    });
    assert.deepEqual(createWindowsPackageReleaseIdentity(failure, release), {
      appVersion: '0.0.0-update-fixture.3',
      msiProductVersion: '0.0.3',
    });
    assert.equal(getUpdateFixtureMigrationMode(current), 'omit-latest-two');
    assert.equal(getUpdateFixtureMigrationMode(next), 'complete');
    assert.equal(getUpdateFixtureMigrationMode(failure), 'fail-latest');
  });

  it('rejects arbitrary package modes and arguments', () => {
    for (const value of [
      ['--update-e2e-other'],
      ['--pilot', '--update-e2e-next'],
      ['--output', 'C:\\arbitrary'],
    ]) {
      assert.throws(
        () => readWindowsPackageBuildMode(value),
        /WINDOWS_PACKAGE_ARGUMENTS_INVALID/,
      );
    }
  });
});
