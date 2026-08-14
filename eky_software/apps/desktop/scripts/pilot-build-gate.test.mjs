import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  assertPilotBuildPreconditions,
  createPilotArtifactManifest,
  readPilotArtifactManifest,
} from './pilot-build-gate.mjs';

const temporaryDirectories = [];
const buildInfo = Object.freeze({
  appVersion: '0.1.0',
  buildDirty: false,
  buildRevision: '123456789abc',
});
const inventory = Object.freeze({
  fileCount: 10,
  identity: 'a'.repeat(64),
  stage: 'packagedApp',
  totalByteSize: 1_000,
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('rejects dirty, mismatched and invalid pilot build identities', () => {
  for (const input of [
    { buildInfo: { ...buildInfo, buildDirty: true }, currentHead: '123456789abc' },
    { buildInfo, currentHead: 'abcdef123456' },
    { buildInfo: { ...buildInfo, appVersion: 'pilot' }, currentHead: '123456789abc' },
    {
      buildInfo: { ...buildInfo, appVersion: '0.1.0-alpha.2' },
      currentHead: '123456789abc',
    },
  ]) {
    assert.throws(() => assertPilotBuildPreconditions(input), /PILOT_BUILD/);
  }
});

test('requires an exact pilot manifest matching build info and inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-pilot-manifest-'));
  temporaryDirectories.push(root);
  const path = join(root, 'pilot-manifest.json');
  const manifest = createPilotArtifactManifest({ buildInfo, inventory });
  await writeFile(path, `${JSON.stringify(manifest)}\n`, 'utf8');

  await assert.doesNotReject(
    readPilotArtifactManifest(path, { buildInfo, inventory }),
  );
  await assert.rejects(
    readPilotArtifactManifest(join(root, 'missing.json'), {
      buildInfo,
      inventory,
    }),
    /PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID/,
  );
  await writeFile(
    path,
    JSON.stringify({ ...manifest, releaseChannel: 'stable' }),
    'utf8',
  );
  await assert.rejects(
    readPilotArtifactManifest(path, { buildInfo, inventory }),
    /PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID/,
  );
});
