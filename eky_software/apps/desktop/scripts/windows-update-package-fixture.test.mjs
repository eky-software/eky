import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createWindowsPackageReleaseIdentity,
  createWindowsPackageReleaseInfo,
  getUpdateFixtureAdditionalMigrations,
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
    assert.equal(getUpdateFixtureMigrationMode(current), 'baseline');
    assert.equal(getUpdateFixtureMigrationMode(next), 'forward');
    assert.equal(getUpdateFixtureMigrationMode(failure), 'fail-forward');
  });

  it('extends the complete production migration prefix only inside fixtures', () => {
    const standard = readWindowsPackageBuildMode([]);
    const current = readWindowsPackageBuildMode(['--update-e2e-current']);
    const next = readWindowsPackageBuildMode(['--update-e2e-next']);
    const failure = readWindowsPackageBuildMode(['--update-e2e-failure']);

    assert.deepEqual(getUpdateFixtureAdditionalMigrations(standard), []);
    assert.deepEqual(getUpdateFixtureAdditionalMigrations(current), []);
    const nextMigrations = getUpdateFixtureAdditionalMigrations(next);
    const failureMigrations = getUpdateFixtureAdditionalMigrations(failure);
    assert.deepEqual(
      nextMigrations.map(({ fileName }) => fileName),
      [
        '039_update_e2e_add_forward_marker.sql',
        '040_update_e2e_add_forward_detail.sql',
      ],
    );
    assert.equal(nextMigrations[0].content, failureMigrations[0].content);
    assert.equal(nextMigrations[0].fileName, failureMigrations[0].fileName);
    assert.equal(nextMigrations[1].fileName, failureMigrations[1].fileName);
    assert.notEqual(nextMigrations[1].content, failureMigrations[1].content);
    assert.match(nextMigrations[0].content, /CREATE TABLE/);
    assert.match(nextMigrations[1].content, /ADD COLUMN/);
  });

  it('keeps packaged runtime and MSI release metadata on the same identity', () => {
    const mode = readWindowsPackageBuildMode(['--update-e2e-next']);
    const release = {
      appIdentity: 'Eky',
      appVersion: '9.9.9',
      architecture: 'x64',
      msiProductVersion: '9.9.9',
      platform: 'win32',
      releaseChannel: 'stable',
    };

    assert.deepEqual(
      createWindowsPackageReleaseInfo({
        buildRevision: 'abc123',
        mode,
        release,
        upgradeCode: 'upgrade-code',
      }),
      {
        appIdentity: 'Eky',
        appVersion: '0.0.0-update-fixture.2',
        architecture: 'x64',
        buildRevision: 'abc123',
        msiProductVersion: '0.0.2',
        platform: 'win32',
        releaseChannel: 'stable',
        schemaVersion: 1,
        upgradeCode: 'upgrade-code',
      },
    );
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
