import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { assertPilotBuildPreconditions } from '../../scripts/pilot-build-gate.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const approvedCommit = '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032';

test('keeps the ordinary pilot release gate closed to historical provenance', () => {
  assert.throws(
    () =>
      assertPilotBuildPreconditions({
        buildInfo: {
          appVersion: '0.2.6',
          buildDirty: false,
          buildRevision: approvedCommit,
        },
        currentHead: 'f'.repeat(40),
      }),
    /PILOT_BUILD_PRECONDITION_FAILED/,
  );
});

test('does not route historical rebuilds through pilot or local bundle commands', async () => {
  const builder = await readFile(
    join(scriptDirectory, 'historicalWindowsInstallerFixtureBuilder.mjs'),
    'utf8',
  );
  assert.doesNotMatch(builder, /package:windows:pilot/u);
  assert.doesNotMatch(builder, /installer:local-pilot-bundle/u);
  assert.doesNotMatch(builder, /\bcreateLocalPilotReleaseBundle\s*\(/u);

  for (const relativePath of [
    'scripts/package-windows.mjs',
    'installer/scripts/releaseWindowsInstaller.mjs',
    'installer/scripts/createLocalPilotReleaseBundle.mjs',
  ]) {
    const ordinaryPath = await readFile(
      join(desktopDirectory, ...relativePath.split('/')),
      'utf8',
    );
    assert.doesNotMatch(ordinaryPath, /historicalWindowsInstallerFixture/u);
  }
});
