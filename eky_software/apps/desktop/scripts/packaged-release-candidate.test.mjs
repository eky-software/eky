import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertReleaseVersionIntroducedAtCurrentHead,
  createPriorAcceptedBuildMetadata,
  readFirstParentReleaseHistory,
  selectPreviousReleaseIdentity,
} from './packaged-release-candidate.mjs';

test('requires the candidate version to be introduced at current HEAD', () => {
  assert.doesNotThrow(() =>
    assertReleaseVersionIntroducedAtCurrentHead(
      '0.2.3',
      'aaaaaaaaaaaa',
      [
        { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
        { appVersion: '0.2.2', buildRevision: 'bbbbbbbbbbbb' },
      ],
    ),
  );
});

test('rejects every earlier use of the candidate version', () => {
  for (const history of [
    [
      { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
      { appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.2.2', buildRevision: 'cccccccccccc' },
    ],
    [
      { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
      { appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.2.3', buildRevision: 'cccccccccccc' },
      { appVersion: '0.2.2', buildRevision: 'dddddddddddd' },
    ],
  ]) {
    assert.throws(
      () =>
        assertReleaseVersionIntroducedAtCurrentHead(
          '0.2.3',
          'aaaaaaaaaaaa',
          history,
        ),
      /VERSION_REUSED/u,
    );
  }
});

test('rejects a history that does not start from the current build', () => {
  for (const history of [
    [],
    [{ appVersion: '0.2.2', buildRevision: 'aaaaaaaaaaaa' }],
    [{ appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' }],
  ]) {
    assert.throws(
      () =>
        assertReleaseVersionIntroducedAtCurrentHead(
          '0.2.3',
          'aaaaaaaaaaaa',
          history,
        ),
      /HISTORY_INVALID/u,
    );
  }
});

test('rejects malformed candidate and history identities', () => {
  const validHistory = [
    { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
    { appVersion: '0.2.2', buildRevision: 'bbbbbbbbbbbb' },
  ];

  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3-alpha.1',
        'aaaaaaaaaaaa',
        validHistory,
      ),
    /VERSION_INVALID/u,
  );
  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3',
        'not-a-revision',
        validHistory,
      ),
    /HISTORY_INVALID/u,
  );
  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3',
        'aaaaaaaaaaaa',
        [
          { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
          { appVersion: '0.2.2-alpha.1', buildRevision: 'bbbbbbbbbbbb' },
        ],
      ),
    /HISTORY_INVALID/u,
  );
  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3',
        'aaaaaaaaaaaa',
        [
          { appVersion: '0.2.3', buildRevision: 'aaaaaaaaaaaa' },
          { appVersion: '0.2.2', buildRevision: 'not-a-revision' },
        ],
      ),
    /HISTORY_INVALID/u,
  );
});

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

test('keeps the numeric 0.2.1 to 0.1.0 release transition valid', () => {
  const history = [
    { appVersion: '0.2.1', buildRevision: 'aaaaaaaaaaaa' },
    { appVersion: '0.1.0', buildRevision: 'bbbbbbbbbbbb' },
  ];

  assert.doesNotThrow(() =>
    assertReleaseVersionIntroducedAtCurrentHead(
      '0.2.1',
      'aaaaaaaaaaaa',
      history,
    ),
  );
  assert.deepEqual(selectPreviousReleaseIdentity('0.2.1', history), {
    appVersion: '0.1.0',
    buildRevision: 'bbbbbbbbbbbb',
  });
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
