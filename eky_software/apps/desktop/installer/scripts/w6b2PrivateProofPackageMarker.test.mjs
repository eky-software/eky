import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createW6b2PrivateProofPackageMarker,
  W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE,
  writeW6b2PrivateProofPackageMarker,
} from './w6b2PrivateProofPackageMarker.mjs';

test('creates only the closed source and target marker identities', () => {
  assert.deepEqual(
    createW6b2PrivateProofPackageMarker({
      appVersion: '0.2.7',
      role: 'source',
    }),
    { appVersion: '0.2.7', formatVersion: 1, role: 'source' },
  );
  assert.deepEqual(
    createW6b2PrivateProofPackageMarker({
      appVersion: '0.2.8',
      role: 'target',
    }),
    { appVersion: '0.2.8', formatVersion: 1, role: 'target' },
  );
});

test('rejects unsupported roles, versions and paths', async () => {
  assert.throws(
    () =>
      createW6b2PrivateProofPackageMarker({
        appVersion: '0.2.8',
        role: 'source',
      }),
    /W6B2_PRIVATE_PROOF_PACKAGE_MARKER_INVALID/u,
  );
  assert.throws(
    () =>
      createW6b2PrivateProofPackageMarker({
        appVersion: '0.2.7',
        role: 'ordinary',
      }),
    /W6B2_PRIVATE_PROOF_PACKAGE_MARKER_INVALID/u,
  );
  await assert.rejects(
    () =>
      writeW6b2PrivateProofPackageMarker({
        appVersion: '0.2.7',
        backendStage: 'relative',
        role: 'source',
      }),
    /W6B2_PRIVATE_PROOF_PACKAGE_MARKER_PATH_INVALID/u,
  );
});

test('writes the canonical marker into the private backend stage', async (context) => {
  const backendStage = await mkdtemp(join(tmpdir(), 'eky-w6b2-marker-'));
  context.after(() => rm(backendStage, { force: true, recursive: true }));

  await writeW6b2PrivateProofPackageMarker({
    appVersion: '0.2.7',
    backendStage,
    role: 'source',
  });

  assert.equal(
    await readFile(
      join(backendStage, W6B2_PRIVATE_PROOF_PACKAGE_MARKER_FILE),
      'utf8',
    ),
    '{"appVersion":"0.2.7","formatVersion":1,"role":"source"}\n',
  );
});
