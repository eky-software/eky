import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createCleanInstallUninstallPostSupervisorWindowsRuntime,
} from './cleanInstallUninstallPostSupervisorWindowsRuntime.mjs';

test(
  'post-supervisor verifier checks an exact absent ProductCode in a bounded adapter',
  { skip: process.platform !== 'win32', timeout: 40_000 },
  async (testContext) => {
    const scenarioRoot = await mkdtemp(
      join(tmpdir(), 'eky-v2-post-supervisor-'),
    );
    testContext.after(() => rm(scenarioRoot, { force: true, recursive: true }));

    const runtime =
      createCleanInstallUninstallPostSupervisorWindowsRuntime({
        manifest: { msiProductVersion: '255.255.65535' },
        scenarioRoot,
      });

    assert.deepEqual(await runtime.verifyExactProductState(), {
      status: 'completed',
      resultCode: 'exactProductAbsent',
      exactProductPresent: false,
    });
  },
);
