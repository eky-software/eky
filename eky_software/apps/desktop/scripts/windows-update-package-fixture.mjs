const fixtureDefinitions = Object.freeze({
  current: Object.freeze({
    appVersion: '0.0.0-update-fixture.1',
    migrationMode: 'baseline',
    msiProductVersion: '0.0.1',
  }),
  failure: Object.freeze({
    appVersion: '0.0.0-update-fixture.3',
    migrationMode: 'fail-forward',
    msiProductVersion: '0.0.3',
  }),
  next: Object.freeze({
    appVersion: '0.0.0-update-fixture.2',
    migrationMode: 'forward',
    msiProductVersion: '0.0.2',
  }),
});

const forwardMigration = Object.freeze({
  content: `
CREATE TABLE update_e2e_forward_marker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  marker TEXT NOT NULL
);
`.trimStart(),
  fileName: '039_update_e2e_add_forward_marker.sql',
});

const successfulForwardDetailMigration = Object.freeze({
  content: `
ALTER TABLE update_e2e_forward_marker
  ADD COLUMN marker_detail TEXT;
`.trimStart(),
  fileName: '040_update_e2e_add_forward_detail.sql',
});

const failingForwardDetailMigration = Object.freeze({
  content:
    'THIS IS AN INTENTIONAL PACKAGED UPDATE E2E MIGRATION FAILURE;\n',
  fileName: '040_update_e2e_add_forward_detail.sql',
});

const fixtureArgumentPrefix = '--update-e2e-';

export const windowsUpdateFixtureNames = Object.freeze([
  'current',
  'next',
  'failure',
]);

export function getWindowsUpdateFixtureDefinition(fixtureName) {
  const definition = fixtureDefinitions[fixtureName];
  if (definition === undefined) {
    throw new Error('WINDOWS_UPDATE_FIXTURE_NAME_INVALID');
  }
  return definition;
}

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
    if (Object.hasOwn(fixtureDefinitions, fixtureName)) {
      const definition = getWindowsUpdateFixtureDefinition(fixtureName);
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

export function getUpdateFixtureAdditionalMigrations(mode) {
  const migrationMode = getUpdateFixtureMigrationMode(mode);
  if (migrationMode === 'baseline' || migrationMode === 'complete') {
    return Object.freeze([]);
  }
  if (migrationMode === 'forward') {
    return Object.freeze([
      forwardMigration,
      successfulForwardDetailMigration,
    ]);
  }
  if (migrationMode === 'fail-forward') {
    return Object.freeze([forwardMigration, failingForwardDetailMigration]);
  }
  throw new Error('WINDOWS_UPDATE_FIXTURE_MIGRATION_MODE_INVALID');
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
