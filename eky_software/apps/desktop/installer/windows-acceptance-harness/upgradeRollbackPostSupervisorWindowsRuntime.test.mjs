import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyUpgradeRollbackProductStates, createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const exited = { status: 'completed', resultCode: 'processCompleted', exitCode: 0, directProcessAbsent: true };
const uncertain = { status: 'failed', resultCode: 'terminationUnconfirmed', exitCode: null, directProcessAbsent: false };
function productRuntime(results) {
  const calls = [];
  const removals = [];
  const runtime = createUpgradeRollbackPostSupervisorWindowsRuntime({ scenarioRoot: DIRECTORY,
    artifact: { roles: { source: { productCode: '00000000-0000-0000-0000-000000000001' },
      target: { productCode: '00000000-0000-0000-0000-000000000002' } } },
  }, {
    systemRoot: DIRECTORY,
    runProcess: async (request) => {
      calls.push(request);
      assert.ok(results.length, 'No real process may be started by this fixture');
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    readResult: async () => ({ productState: 5, productName: 'Synthetic', productVersion: '0.2.8',
      localPackagePresent: true, ownedRegistryExists: true }),
    removeResult: async (path) => { removals.push(path); },
  });
  return { runtime, calls, removals };
}

test('unverified inspector stops all later product operations and retains its result', async () => {
  const { runtime, calls, removals } = productRuntime([uncertain, exited]);
  assert.equal((await runtime.verifyExactProductStates()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(calls.length, 1);
  assert.equal(removals.length, 0);
  assert.equal(runtime.outcome().productProcessAbsent, false);
  assert.equal((await runtime.cleanupExactProducts()).status, 'failed');
  assert.equal((await runtime.verifyExactProductStates()).status, 'failed');
  assert.equal(calls.length, 1);
  assert.equal(runtime.outcome().productProcessAbsent, false);
});

test('unverified target uninstall prevents source uninstall and later verification', async () => {
  const { runtime, calls } = productRuntime([exited, exited, uncertain, exited]);
  assert.equal((await runtime.cleanupExactProducts()).errorCode, 'semanticCleanupProcessRemains');
  assert.equal(calls.length, 3);
  assert.equal(runtime.outcome().productProcessAbsent, false);
  await runtime.verifyExactProductStates();
  assert.equal(calls.length, 3);
});

test('a known exited uninstall failure permits independent cleanup but remains failed', async () => {
  const { runtime, calls } = productRuntime([exited, exited, { ...exited, exitCode: 1 }, exited]);
  assert.equal((await runtime.cleanupExactProducts()).errorCode, 'semanticCleanupFailed');
  assert.equal(calls.length, 4);
  assert.equal(runtime.outcome().productProcessAbsent, true);
});

test('a rejected adapter invocation is not proof of absence or permission to remove its result', async () => {
  const { runtime, calls, removals } = productRuntime([new Error('synthetic adapter failure'), exited]);
  assert.equal((await runtime.verifyExactProductStates()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(calls.length, 1);
  assert.equal(removals.length, 0);
  assert.equal(runtime.outcome().productProcessAbsent, false);
});

test('post-supervisor runtime owns only bounded exact-product adapters', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'upgradeRollbackPostSupervisorWindowsRuntime.mjs'),
    'utf8',
  );
  assert.match(source, /createInstallerProductOperationRuntime/u);
  assert.match(source, /artifact\.roles\[roleName\]\.productCode/u);
  assert.doesNotMatch(source, /taskkill|Get-CimInstance|WindowsProcessSupervisor/iu);
  assert.doesNotMatch(source, /retry|setTimeout|Start-Sleep/iu);
});

test('shared installer registry never aliases the absent target ProductCode', () => {
  assert.deepEqual(
    classifyUpgradeRollbackProductStates(
      {
        exactProductPresent: true,
        installerRegistryPresent: true,
      },
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
    ),
    {
      status: 'completed',
      resultCode: 'sourceProductPresent',
      sourcePresent: true,
      targetPresent: false,
      installerRegistryPresent: true,
    },
  );
});

test('orphaned shared installer registry remains a distinct failed-safe state', () => {
  assert.equal(
    classifyUpgradeRollbackProductStates(
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
      {
        exactProductPresent: false,
        installerRegistryPresent: true,
      },
    ).resultCode,
    'installerRegistryPresent',
  );
});
