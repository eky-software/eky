import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  createCleanInstallUninstallPostSupervisorWindowsRuntime,
} from './cleanInstallUninstallPostSupervisorWindowsRuntime.mjs';

test('clean lifecycle uses the same sticky product-process uncertainty and retains the result', async () => {
  let starts = 0, removals = 0;
  const runtime = createCleanInstallUninstallPostSupervisorWindowsRuntime({
    manifest: { msiProductVersion: '255.255.65535' }, scenarioRoot: resolve('synthetic'),
  }, {
    systemRoot: resolve('synthetic'),
    runProcess: async () => { starts += 1; return { status: 'failed', directProcessAbsent: false }; },
    removeResult: async () => { removals += 1; },
  });
  assert.equal((await runtime.verifyExactProductState()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal((await runtime.cleanupExactProduct()).errorCode, 'semanticCleanupProcessRemains');
  assert.equal((await runtime.verifyExactProductState()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(starts, 1);
  assert.equal(removals, 0);
  assert.deepEqual(runtime.outcome(), { productProcessAbsent: false });
});

test('clean classification retains its existing ProductState-only contract', async () => {
  const runtime = createCleanInstallUninstallPostSupervisorWindowsRuntime({
    manifest: { msiProductVersion: '255.255.65535' }, scenarioRoot: resolve('synthetic'),
  }, {
    systemRoot: resolve('synthetic'),
    runProcess: async () => ({ status: 'completed', exitCode: 0, directProcessAbsent: true }),
    readResult: async () => ({ productState: -1, productName: 'Synthetic', localPackagePresent: true }),
    removeResult: async () => {},
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
