import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createW6b2PackageRequest,
  createW6b2SyntheticReleasePair,
} from './w6b2SyntheticWindowsPackageFixture.mjs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE } from './w6b2PrivateProofPackageMarker.mjs';

const canonicalRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.7',
  architecture: 'x64',
  msiProductVersion: '0.2.7',
  platform: 'win32',
  releaseChannel: 'pilot',
});

test('keeps the private 0.2.7 to 0.2.8 fixture independent of the canonical release version', () => {
  const pair = createW6b2SyntheticReleasePair(canonicalRelease);
  const previousPair = createW6b2SyntheticReleasePair({
    ...canonicalRelease,
    appVersion: '0.2.6',
    msiProductVersion: '0.2.6',
  });

  assert.equal(pair.source.appVersion, '0.2.7');
  assert.equal(pair.source.msiProductVersion, '0.2.7');
  assert.equal(pair.target.appVersion, '0.2.8');
  assert.equal(pair.target.msiProductVersion, '0.2.8');
  assert.deepEqual(previousPair, pair);
  assert.equal(canonicalRelease.appVersion, '0.2.7');
});

test('limits historical preparation and package markers to private W6B.2 fixtures', async (context) => {
  const pair = createW6b2SyntheticReleasePair(canonicalRelease);
  const source = createW6b2PackageRequest({
    kind: 'source',
    release: pair.source,
  });
  const target = createW6b2PackageRequest({
    kind: 'target',
    release: pair.target,
  });

  const sourceStage = await mkdtemp(join(tmpdir(), 'eky-w6b2-source-'));
  const targetStage = await mkdtemp(join(tmpdir(), 'eky-w6b2-target-'));
  context.after(() => rm(sourceStage, { force: true, recursive: true }));
  context.after(() => rm(targetStage, { force: true, recursive: true }));
  const sourceMigrations = join(sourceStage, 'dist', 'database', 'migrations');
  await mkdir(sourceMigrations, { recursive: true });
  await writeFile(join(sourceMigrations, '001_first.sql'), 'SELECT 1;\n');
  await writeFile(join(sourceMigrations, '002_second.sql'), 'SELECT 2;\n');

  await source.prepareBackendStage(sourceStage);
  await target.prepareBackendStage(targetStage);

  assert.deepEqual(await readdir(sourceMigrations), ['001_first.sql']);
  assert.equal(
    await readFile(
      join(sourceStage, W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE),
      'utf8',
    ),
    '{"appVersion":"0.2.7","formatVersion":1,"role":"source"}\n',
  );
  assert.equal(
    await readFile(
      join(targetStage, W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE),
      'utf8',
    ),
    '{"appVersion":"0.2.8","formatVersion":1,"role":"target"}\n',
  );
});

test('rejects unsupported fixture release baselines and package kinds', () => {
  assert.throws(
    () =>
      createW6b2SyntheticReleasePair({
        ...canonicalRelease,
        releaseChannel: 'stable',
      }),
    /W6B2_SYNTHETIC_RELEASE_PAIR_INVALID/u,
  );
  assert.throws(
    () =>
      createW6b2SyntheticReleasePair({
        ...canonicalRelease,
        msiProductVersion: '0.2.8',
      }),
    /W6B2_SYNTHETIC_RELEASE_PAIR_INVALID/u,
  );
  assert.throws(
    () => createW6b2PackageRequest({ kind: 'ordinary' }),
    /W6B2_PACKAGE_REQUEST_INVALID/u,
  );
});
