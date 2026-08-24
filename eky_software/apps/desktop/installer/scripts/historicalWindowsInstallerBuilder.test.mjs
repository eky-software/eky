import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { inspectWindowsInstallerIdentity } from './historicalWindowsInstallerBuilder.mjs';

test('rejects a missing installer before invoking the identity inspector', async () => {
  await assert.rejects(
    inspectWindowsInstallerIdentity(
      join('missing', 'historical-installer-fixture.msi'),
    ),
    /HISTORICAL_FIXTURE_INSTALLER_ARTIFACT_INVALID/,
  );
});
