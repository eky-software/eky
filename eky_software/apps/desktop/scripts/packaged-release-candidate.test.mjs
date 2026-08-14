import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPriorAcceptedBuildMetadata,
  readFirstParentReleaseHistory,
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

test('reads package snapshots from every first-parent revision', async () => {
  const calls = [];
  const outputByCommand = new Map([
    [
      'log --first-parent --format=%H',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' +
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n',
    ],
    [
      'show aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:eky_software/apps/desktop/package.json',
      '{"version":"0.1.1"}',
    ],
    [
      'show bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:eky_software/apps/desktop/package.json',
      '{"version":"0.1.0"}',
    ],
  ]);

  const history = await readFirstParentReleaseHistory(
    'eky_software/apps/desktop/package.json',
    '0.1.1',
    async (args) => {
      const command = args.join(' ');
      calls.push(command);
      const output = outputByCommand.get(command);
      if (output === undefined) {
        throw new Error('unexpected git command');
      }
      return output;
    },
  );

  assert.deepEqual(history, [
    { appVersion: '0.1.1', buildRevision: 'aaaaaaaaaaaa' },
    { appVersion: '0.1.0', buildRevision: 'bbbbbbbbbbbb' },
  ]);
  assert.deepEqual(calls, [
    'log --first-parent --format=%H',
    'show aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:eky_software/apps/desktop/package.json',
    'show bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:eky_software/apps/desktop/package.json',
  ]);
});
