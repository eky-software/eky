import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  createCleanInstallUninstallPostSupervisorWindowsRuntime,
} from './cleanInstallUninstallPostSupervisorWindowsRuntime.mjs';

test('clean lifecycle blocks further product operations after uncertain process exit', async () => {
  let starts = 0;
  const runtime = createCleanInstallUninstallPostSupervisorWindowsRuntime({
    manifest: { msiProductVersion: '255.255.65535' }, scenarioRoot: resolve('synthetic'),
  }, {
    systemRoot: resolve('synthetic'),
    runProcess: async () => { starts += 1; return { status: 'failed', directProcessAbsent: false }; },
  });
  assert.equal((await runtime.verifyExactProductState()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal((await runtime.cleanupExactProduct()).errorCode, 'semanticCleanupProcessRemains');
  assert.equal((await runtime.verifyExactProductState()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(starts, 1);
  assert.deepEqual(runtime.outcome(), { productProcessAbsent: false });
});

test('clean classification retains its existing ProductState-only contract', async () => {
  const runtime = createCleanInstallUninstallPostSupervisorWindowsRuntime({
    manifest: { msiProductVersion: '255.255.65535' }, scenarioRoot: resolve('synthetic'),
  }, {
    systemRoot: resolve('synthetic'),
    runProcess: async () => ({ status: 'completed', exitCode: 0, directProcessAbsent: true,
      state: { productState: -1, productName: 'Synthetic', localPackagePresent: true } }),
  });
  assert.equal((await runtime.verifyExactProductState()).exactProductPresent, false);
  assert.deepEqual(runtime.outcome(), { productProcessAbsent: true });
});

test(
  'post-supervisor verifier checks an exact absent ProductCode in a bounded adapter',
  { skip: process.platform !== 'win32', timeout: 40_000 },
  async (testContext) => {
    const scenarioRoot = await mkdtemp(
      join(tmpdir(), 'eky-v2-post-supervisor-'),
    );
    const runtime =
      createCleanInstallUninstallPostSupervisorWindowsRuntime({
        manifest: { msiProductVersion: '255.255.65535' },
        scenarioRoot,
      });
    testContext.after(async () => {
      if (runtime.outcome().productProcessAbsent) {
        await rm(scenarioRoot, { force: true, recursive: true });
      }
    });

    assert.deepEqual(await runtime.verifyExactProductState(), {
      status: 'completed',
      resultCode: 'exactProductAbsent',
      exactProductPresent: false,
    });
  },
);
