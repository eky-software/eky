const fullRevisionPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const numericVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const historicalExpectedCommit =
  '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032';

export const HISTORICAL_WINDOWS_INSTALLER_FIXTURE = Object.freeze({
  appVersion: '0.2.6',
  expectedCommit: historicalExpectedCommit,
  expectedLocalMsiSha256:
    '9d2b3db46a9c981e7e251715c8805fe6ff12dc57700c4bc023289ac4dfe54c23',
  expectedRuntimeBuildRevision: historicalExpectedCommit.slice(0, 12),
  expectedTree: '324953c8d36a824e6ff4e414afe73f84e7d0d7d7',
  fixtureFormatVersion: 1,
  msiProductVersion: '0.2.6',
  releaseChannel: 'pilot',
});

export const HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES = Object.freeze({
  exactLocalRelease: 'exact-local-release',
  historicalSourceRebuild: 'historical-source-rebuild',
});

const provenanceKeys = Object.freeze([
  'appVersion',
  'createdAt',
  'expectedCommit',
  'expectedTree',
  'fixtureFormatVersion',
  'msiProductVersion',
  'sourceArchiveManifestSha256',
]);

export function createHistoricalWindowsInstallerFixtureProvenance({
  createdAt = new Date().toISOString(),
  sourceArchiveManifestSha256,
}) {
  return parseHistoricalWindowsInstallerFixtureProvenance({
    appVersion: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion,
    createdAt,
    expectedCommit: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    expectedTree: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedTree,
    fixtureFormatVersion:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.fixtureFormatVersion,
    msiProductVersion:
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion,
    sourceArchiveManifestSha256,
  });
}

export function parseHistoricalWindowsInstallerFixtureProvenance(value) {
  if (!isPlainObject(value)) {
    throw new Error('HISTORICAL_FIXTURE_PROVENANCE_INVALID');
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== provenanceKeys.length ||
    keys.some((key, index) => key !== provenanceKeys[index])
  ) {
    throw new Error('HISTORICAL_FIXTURE_PROVENANCE_INVALID');
  }
  if (
    value.fixtureFormatVersion !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.fixtureFormatVersion ||
    value.expectedCommit !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit ||
    value.expectedTree !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedTree ||
    value.appVersion !== HISTORICAL_WINDOWS_INSTALLER_FIXTURE.appVersion ||
    value.msiProductVersion !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.msiProductVersion ||
    !fullRevisionPattern.test(value.expectedCommit) ||
    !fullRevisionPattern.test(value.expectedTree) ||
    !numericVersionPattern.test(value.appVersion) ||
    !numericVersionPattern.test(value.msiProductVersion) ||
    !sha256Pattern.test(value.sourceArchiveManifestSha256) ||
    typeof value.createdAt !== 'string' ||
    !isCanonicalIsoTimestamp(value.createdAt)
  ) {
    throw new Error('HISTORICAL_FIXTURE_PROVENANCE_INVALID');
  }
  return Object.freeze({ ...value });
}

export function classifyHistoricalWindowsInstallerArtifact({
  packageSha256,
  source,
}) {
  if (!sha256Pattern.test(packageSha256)) {
    throw new Error('HISTORICAL_FIXTURE_ARTIFACT_IDENTITY_INVALID');
  }
  if (source === 'local-release') {
    if (
      packageSha256 !==
      HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256
    ) {
      throw new Error('HISTORICAL_FIXTURE_LOCAL_RELEASE_MISMATCH');
    }
    return Object.freeze({
      artifactClass:
        HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.exactLocalRelease,
      matchesApprovedArtifact: true,
    });
  }
  if (source === 'historical-source-rebuild') {
    return Object.freeze({
      artifactClass:
        HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.historicalSourceRebuild,
      matchesApprovedArtifact:
        packageSha256 ===
        HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256,
    });
  }
  throw new Error('HISTORICAL_FIXTURE_ARTIFACT_SOURCE_INVALID');
}

function isCanonicalIsoTimestamp(value) {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
