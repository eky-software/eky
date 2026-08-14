import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPriorAcceptedBuildMetadata,
  selectPreviousReleaseIdentity,
} from './packaged-release-candidate.mjs';

test('selects the first lower numeric release behind the candidate', () => {
  assert.deepEqual(
    selectPreviousReleaseIdentity('0.1.1', [
      { appVersion: '0.1.1', buildRevision: 'aaaaaaaaaaaa' },
      { appVersion: '0.1.1', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.1.0', buildRevision: 'cccccccccccc' },
    ]),
    { appVersion: '0.1.0', buildRevision: 'cccccccccccc' },
  );
});

test('rejects same-version, prerelease and newer release histories', () => {
  assert.throws(
    () =>
      selectPreviousReleaseIdentity('0.1.1', [
        { appVersion: '0.1.1', buildRevision: 'aaaaaaaaaaaa' },
      ]),
    /PREVIOUS_RELEASE_UNAVAILABLE/u,
  );
  assert.throws(
    () =>
      selectPreviousReleaseIdentity('0.1.1', [
        { appVersion: '0.2.0', buildRevision: 'aaaaaaaaaaaa' },
      ]),
    /HISTORY_INVALID/u,
  );
  assert.throws(
    () =>
      selectPreviousReleaseIdentity('0.1.1', [
        { appVersion: '0.1.0-alpha.1', buildRevision: 'aaaaaaaaaaaa' },
      ]),
    /HISTORY_INVALID/u,
  );
});

test('creates closed prior accepted-build metadata', () => {
  assert.deepEqual(
    createPriorAcceptedBuildMetadata(
      { appVersion: '0.1.0', buildRevision: '123456789abc' },
      '2026-08-14T20:00:00.000Z',
    ),
    {
      acceptedAt: '2026-08-14T20:00:00.000Z',
      appVersion: '0.1.0',
      buildRevision: '123456789abc',
      formatVersion: 1,
      releaseChannel: 'pilot',
    },
  );
  assert.throws(
    () =>
      createPriorAcceptedBuildMetadata(
        { appVersion: '0.1.0', buildRevision: '123456789abc' },
        'not-a-timestamp',
      ),
    /ACCEPTED_BUILD_INVALID/u,
  );
});
