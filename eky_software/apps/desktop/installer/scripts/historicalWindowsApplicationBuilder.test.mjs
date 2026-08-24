import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  createHistoricalApplicationBuildEnvironment,
} from './historicalWindowsApplicationBuilder.mjs';
import { HISTORICAL_WINDOWS_INSTALLER_FIXTURE } from './historicalWindowsInstallerFixtureProvenance.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

test('uses only the ordinary package command for the historical application payload', async () => {
  const source = await readFile(
    join(scriptDirectory, 'historicalWindowsApplicationBuilder.mjs'),
    'utf8',
  );

  assert.match(source, /'package:windows'/u);
  assert.doesNotMatch(source, /package:windows:pilot/u);
  assert.doesNotMatch(source, /installer:local-pilot-bundle/u);
  assert.doesNotMatch(source, /verifyHistorical/u);
});

test('rebuilds the historical runtime with the approved packaged revision identity', () => {
  const baseEnvironment = { EXISTING_VALUE: 'preserved' };
  const environment =
    createHistoricalApplicationBuildEnvironment(baseEnvironment);

  assert.equal(environment.EXISTING_VALUE, 'preserved');
  assert.equal(
    environment.EKY_BUILD_REVISION,
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
  );
  assert.equal(environment.EKY_BUILD_REVISION.length, 12);
  assert.notEqual(
    environment.EKY_BUILD_REVISION,
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedCommit,
  );
  assert.deepEqual(baseEnvironment, { EXISTING_VALUE: 'preserved' });
});
