import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES,
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
  classifyHistoricalWindowsInstallerArtifact,
  createHistoricalWindowsInstallerFixtureProvenance,
  parseHistoricalWindowsInstallerFixtureProvenance,
} from './historicalWindowsInstallerFixtureProvenance.mjs';

const sourceArchiveManifestSha256 = 'a'.repeat(64);

test('creates a closed provenance contract for the approved historical source', () => {
  const provenance = createHistoricalWindowsInstallerFixtureProvenance({
    createdAt: '2026-08-22T12:00:00.000Z',
    sourceArchiveManifestSha256,
  });

  assert.deepEqual(provenance, {
    appVersion: '0.2.6',
    createdAt: '2026-08-22T12:00:00.000Z',
    expectedCommit: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
    expectedTree: HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedTree,
    fixtureFormatVersion: 1,
    msiProductVersion: '0.2.6',
    sourceArchiveManifestSha256,
  });
});

test('rejects unknown, missing and changed provenance fields', () => {
  const valid = createHistoricalWindowsInstallerFixtureProvenance({
    createdAt: '2026-08-22T12:00:00.000Z',
    sourceArchiveManifestSha256,
  });

  assert.throws(
    () =>
      parseHistoricalWindowsInstallerFixtureProvenance({
        ...valid,
        localPath: 'forbidden',
      }),
    /HISTORICAL_FIXTURE_PROVENANCE_INVALID/,
  );
  const { expectedTree: _expectedTree, ...missingTree } = valid;
  assert.throws(
    () => parseHistoricalWindowsInstallerFixtureProvenance(missingTree),
    /HISTORICAL_FIXTURE_PROVENANCE_INVALID/,
  );
  assert.throws(
    () =>
      parseHistoricalWindowsInstallerFixtureProvenance({
        ...valid,
        expectedCommit: 'b'.repeat(40),
      }),
    /HISTORICAL_FIXTURE_PROVENANCE_INVALID/,
  );
  assert.throws(
    () =>
      parseHistoricalWindowsInstallerFixtureProvenance({
        ...valid,
        createdAt: 'not-a-timestamp',
      }),
    /HISTORICAL_FIXTURE_PROVENANCE_INVALID/,
  );
});

test('classifies only the exact approved local release as exact', () => {
  assert.deepEqual(
    classifyHistoricalWindowsInstallerArtifact({
      packageSha256:
        HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256,
      source: 'local-release',
    }),
    {
      artifactClass:
        HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.exactLocalRelease,
      matchesApprovedArtifact: true,
    },
  );
  assert.throws(
    () =>
      classifyHistoricalWindowsInstallerArtifact({
        packageSha256: 'b'.repeat(64),
        source: 'local-release',
      }),
    /HISTORICAL_FIXTURE_LOCAL_RELEASE_MISMATCH/,
  );
});

test('keeps a source rebuild classified as a rebuild and reports byte identity separately', () => {
  assert.deepEqual(
    classifyHistoricalWindowsInstallerArtifact({
      packageSha256:
        HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedLocalMsiSha256,
      source: 'historical-source-rebuild',
    }),
    {
      artifactClass:
        HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.historicalSourceRebuild,
      matchesApprovedArtifact: true,
    },
  );
  assert.deepEqual(
    classifyHistoricalWindowsInstallerArtifact({
      packageSha256: 'b'.repeat(64),
      source: 'historical-source-rebuild',
    }),
    {
      artifactClass:
        HISTORICAL_WINDOWS_INSTALLER_ARTIFACT_CLASSES.historicalSourceRebuild,
      matchesApprovedArtifact: false,
    },
  );
});
