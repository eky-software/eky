import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectPackageArtifactInventory } from './package-artifact-inventory.mjs';
import { createPilotArtifactManifest } from './pilot-build-gate.mjs';

import {
  assertReleaseVersionIntroducedAtCurrentHead,
  createPriorAcceptedBuildMetadata,
  preparePackagedReleaseCandidateSmoke,
  readFirstParentReleaseHistory,
  selectPreviousReleaseIdentity,
} from './packaged-release-candidate.mjs';

for (const revision of ['a'.repeat(12), `${'a'.repeat(12)}${'b'.repeat(28)}`]) {
  test(`rejects non-exact current history revision: ${revision.length}`, () => {
    assert.throws(() => assertReleaseVersionIntroducedAtCurrentHead('0.2.3', 'a'.repeat(40), [
      { appVersion: '0.2.3', buildRevision: revision },
    ]), /HISTORY_INVALID/);
    assert.throws(() => assertReleaseVersionIntroducedAtCurrentHead('0.2.3', revision, [
      { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
    ]), /HISTORY_INVALID/);
  });
}

test('rejects mutually matching short current identities', () => {
  assert.throws(() => assertReleaseVersionIntroducedAtCurrentHead('0.2.3', 'a'.repeat(12), [
    { appVersion: '0.2.3', buildRevision: 'a'.repeat(12) },
  ]), /HISTORY_INVALID/);
});

for (const mode of ['full', 'short', 'samePrefix']) {
  test(`RC preparation binds the full current manifest and preserves historical identity: ${mode}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-rc-identity-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const desktopDirectory = join(root, 'apps/desktop');
    const packageRoot = join(desktopDirectory, 'out/Eky-win32-x64');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'Eky.exe'), 'synthetic non-executable package');
    await writeFile(join(desktopDirectory, 'package.json'), JSON.stringify({ version: '0.2.3' }));
    const revision = 'a'.repeat(40);
    const buildRevision = mode === 'short' ? revision.slice(0, 12)
      : mode === 'samePrefix' ? `${revision.slice(0, 12)}${'b'.repeat(28)}` : revision;
    const inventory = await inspectPackageArtifactInventory({ root: packageRoot, stage: 'packagedApp' });
    await writeFile(`${packageRoot}.pilot-manifest.json`, JSON.stringify(createPilotArtifactManifest({
      buildInfo: { appVersion: '0.2.3', buildDirty: false, buildRevision }, inventory,
    })));
    const outputs = new Map([
      ['rev-parse HEAD', revision], ['status --porcelain', ''], ['rev-parse --show-prefix', ''],
      ['log --first-parent --format=%H', `${revision}\n${'c'.repeat(40)}\n`],
      [`show ${revision}:apps/desktop/package.json`, '{"version":"0.2.3"}'],
      [`show ${'c'.repeat(40)}:apps/desktop/package.json`, '{"version":"0.2.2"}'],
    ]);
    const smokeUserDataPath = join(root, 'smoke');
    const prepare = () => preparePackagedReleaseCandidateSmoke({ desktopDirectory,
      repositoryRoot: root, smokeUserDataPath }, { readGitOutput: async (args) => {
        assert.ok(outputs.has(args.join(' ')));
        return outputs.get(args.join(' '));
      } });
    if (mode === 'full') {
      assert.deepEqual(await prepare(), { currentVersion: '0.2.3', previousVersion: '0.2.2' });
      const accepted = JSON.parse(await readFile(join(smokeUserDataPath, 'update-state/accepted-build-v1.json'), 'utf8'));
      assert.equal(accepted.buildRevision, 'c'.repeat(12));
    } else {
      await assert.rejects(prepare, /PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID/);
      await assert.rejects(stat(smokeUserDataPath), { code: 'ENOENT' });
    }
  });
}

test('requires the candidate version to be introduced at current HEAD', () => {
  assert.doesNotThrow(() =>
    assertReleaseVersionIntroducedAtCurrentHead(
      '0.2.3',
      'a'.repeat(40),
      [
        { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
        { appVersion: '0.2.2', buildRevision: 'bbbbbbbbbbbb' },
      ],
    ),
  );
});

test('rejects every earlier use of the candidate version', () => {
  for (const history of [
    [
      { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
      { appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.2.2', buildRevision: 'cccccccccccc' },
    ],
    [
      { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
      { appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.2.3', buildRevision: 'cccccccccccc' },
      { appVersion: '0.2.2', buildRevision: 'dddddddddddd' },
    ],
  ]) {
    assert.throws(
      () =>
        assertReleaseVersionIntroducedAtCurrentHead(
          '0.2.3',
          'a'.repeat(40),
          history,
        ),
      /VERSION_REUSED/u,
    );
  }
});

test('rejects a history that does not start from the current build', () => {
  for (const history of [
    [],
    [{ appVersion: '0.2.2', buildRevision: 'a'.repeat(40) }],
    [{ appVersion: '0.2.3', buildRevision: 'bbbbbbbbbbbb' }],
  ]) {
    assert.throws(
      () =>
        assertReleaseVersionIntroducedAtCurrentHead(
          '0.2.3',
          'a'.repeat(40),
          history,
        ),
      /HISTORY_INVALID/u,
    );
  }
});

test('rejects malformed candidate and history identities', () => {
  const validHistory = [
    { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
    { appVersion: '0.2.2', buildRevision: 'bbbbbbbbbbbb' },
  ];

  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3-alpha.1',
        'a'.repeat(40),
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
        'a'.repeat(40),
        [
          { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
          { appVersion: '0.2.2-alpha.1', buildRevision: 'bbbbbbbbbbbb' },
        ],
      ),
    /HISTORY_INVALID/u,
  );
  assert.throws(
    () =>
      assertReleaseVersionIntroducedAtCurrentHead(
        '0.2.3',
        'a'.repeat(40),
        [
          { appVersion: '0.2.3', buildRevision: 'a'.repeat(40) },
          { appVersion: '0.2.2', buildRevision: 'not-a-revision' },
        ],
      ),
    /HISTORY_INVALID/u,
  );
});

test('selects the first lower numeric release behind the candidate', () => {
  assert.deepEqual(
    selectPreviousReleaseIdentity('0.1.1', [
      { appVersion: '0.1.1', buildRevision: 'a'.repeat(40) },
      { appVersion: '0.1.1', buildRevision: 'bbbbbbbbbbbb' },
      { appVersion: '0.1.0', buildRevision: 'cccccccccccc' },
    ]),
    { appVersion: '0.1.0', buildRevision: 'cccccccccccc' },
  );
});

test('keeps the numeric 0.2.1 to 0.1.0 release transition valid', () => {
  const history = [
    { appVersion: '0.2.1', buildRevision: 'a'.repeat(40) },
    { appVersion: '0.1.0', buildRevision: 'bbbbbbbbbbbb' },
  ];

  assert.doesNotThrow(() =>
    assertReleaseVersionIntroducedAtCurrentHead(
      '0.2.1',
      'a'.repeat(40),
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
        { appVersion: '0.1.1', buildRevision: 'a'.repeat(40) },
      ]),
    /PREVIOUS_RELEASE_UNAVAILABLE/u,
  );
  assert.throws(
    () =>
      selectPreviousReleaseIdentity('0.1.1', [
        { appVersion: '0.2.0', buildRevision: 'a'.repeat(40) },
      ]),
    /HISTORY_INVALID/u,
  );
  assert.throws(
    () =>
      selectPreviousReleaseIdentity('0.1.1', [
        { appVersion: '0.1.0-alpha.1', buildRevision: 'a'.repeat(40) },
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
    { appVersion: '0.1.1', buildRevision: 'a'.repeat(40) },
    { appVersion: '0.1.0', buildRevision: 'bbbbbbbbbbbb' },
  ]);
  assert.deepEqual(calls, [
    'log --first-parent --format=%H',
    'show aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:eky_software/apps/desktop/package.json',
    'show bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:eky_software/apps/desktop/package.json',
  ]);
});

test('only the current history entry is full even when an older commit has the same version', async () => {
  const revisions = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  const history = await readFirstParentReleaseHistory('apps/desktop/package.json', '0.2.3', async (args) => {
    if (args[0] === 'log') return revisions.join('\n');
    assert.equal(args[0], 'show');
    return JSON.stringify({ version: args[1].startsWith(revisions[2]) ? '0.2.2' : '0.2.3' });
  });
  assert.deepEqual(history, [
    { appVersion: '0.2.3', buildRevision: revisions[0] },
    { appVersion: '0.2.3', buildRevision: revisions[1].slice(0, 12) },
    { appVersion: '0.2.2', buildRevision: revisions[2].slice(0, 12) },
  ]);
  assert.throws(() => assertReleaseVersionIntroducedAtCurrentHead('0.2.3', revisions[0], history), /VERSION_REUSED/);
  assert.equal(selectPreviousReleaseIdentity('0.2.3', history).buildRevision, revisions[2].slice(0, 12));
});
