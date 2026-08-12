const fixtureDefinitions = Object.freeze({
  current: Object.freeze({
    appVersion: '0.0.0-update-fixture.1',
    migrationMode: 'omit-latest-two',
    msiProductVersion: '0.0.1',
  }),
  failure: Object.freeze({
    appVersion: '0.0.0-update-fixture.3',
    migrationMode: 'fail-latest',
    msiProductVersion: '0.0.3',
  }),
  next: Object.freeze({
    appVersion: '0.0.0-update-fixture.2',
    migrationMode: 'complete',
    msiProductVersion: '0.0.2',
  }),
});

const fixtureArgumentPrefix = '--update-e2e-';

export function readWindowsPackageBuildMode(argumentsList) {
  if (!Array.isArray(argumentsList)) {
    throw new Error('WINDOWS_PACKAGE_ARGUMENTS_INVALID');
  }
  if (argumentsList.length === 0) {
    return Object.freeze({ kind: 'standard', pilot: false });
  }
  if (argumentsList.length === 1 && argumentsList[0] === '--pilot') {
    return Object.freeze({ kind: 'standard', pilot: true });
  }
  if (
    argumentsList.length === 1 &&
    typeof argumentsList[0] === 'string' &&
    argumentsList[0].startsWith(fixtureArgumentPrefix)
  ) {
    const fixtureName = argumentsList[0].slice(fixtureArgumentPrefix.length);
    const definition = fixtureDefinitions[fixtureName];
    if (definition !== undefined) {
      return Object.freeze({
        definition,
        fixtureName,
        kind: 'update-e2e-fixture',
        pilot: false,
      });
    }
  }
  throw new Error('WINDOWS_PACKAGE_ARGUMENTS_INVALID');
}

export function createWindowsPackageReleaseIdentity(mode, release) {
  if (mode.kind === 'standard') {
    return Object.freeze({
      appVersion: release.appVersion,
      msiProductVersion: release.msiProductVersion,
    });
  }
  return Object.freeze({
    appVersion: mode.definition.appVersion,
    msiProductVersion: mode.definition.msiProductVersion,
  });
}

export function createWindowsPackageReleaseInfo({
  buildRevision,
  mode,
  release,
  upgradeCode,
}) {
  const identity = createWindowsPackageReleaseIdentity(mode, release);

  return Object.freeze({
    appIdentity: release.appIdentity,
    appVersion: identity.appVersion,
    architecture: release.architecture,
    buildRevision,
    msiProductVersion: identity.msiProductVersion,
    platform: release.platform,
    releaseChannel: release.releaseChannel,
    schemaVersion: 1,
    upgradeCode,
  });
}

export function getUpdateFixtureMigrationMode(mode) {
  return mode.kind === 'update-e2e-fixture'
    ? mode.definition.migrationMode
    : 'complete';
}

export function getWindowsPackageDirectoryNames(mode) {
  if (mode.kind === 'standard') {
    return Object.freeze({ output: 'out', staging: '.stage' });
  }
  return Object.freeze({
    output: `installer/artifacts/update-e2e/packages/${mode.fixtureName}`,
    staging: `.stage-update-e2e-${mode.fixtureName}`,
  });
}
