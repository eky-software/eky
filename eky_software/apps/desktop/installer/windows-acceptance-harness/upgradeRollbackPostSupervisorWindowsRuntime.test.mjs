import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyUpgradeRollbackProductStates, createUpgradeRollbackPostSupervisorWindowsRuntime } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const exited = { status: 'completed', resultCode: 'processCompleted', exitCode: 0, directProcessAbsent: true,
  state: { productState: 5, productName: 'Synthetic', productVersion: '0.2.8',
    localPackagePresent: true, ownedRegistryExists: true } };
const uncertain = { status: 'failed', resultCode: 'terminationUnconfirmed', exitCode: null, directProcessAbsent: false };
function productRuntime(results, observe) {
  const calls = [];
  const runtime = createUpgradeRollbackPostSupervisorWindowsRuntime({ scenarioRoot: DIRECTORY, observe,
    artifact: { roles: { source: { productCode: '00000000-0000-0000-0000-000000000001' },
      target: { productCode: '00000000-0000-0000-0000-000000000002' } } },
  }, {
    systemRoot: DIRECTORY,
    runProcess: async (request, dependencies) => {
      if (observe) assert.equal(dependencies.observe, observe);
      calls.push(request);
      assert.ok(results.length, 'No real process may be started by this fixture');
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { runtime, calls };
}

test('unverified inspector stops all later product operations', async () => {
  const { runtime, calls } = productRuntime([uncertain, exited]);
  assert.equal((await runtime.verifyExactProductStates()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(calls.length, 1);
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

test('safe observations separate product inspection from uninstall without changing failure or ownership', async () => {
  const phases = [];
  const { runtime, calls } = productRuntime([exited, exited, uncertain], (phase, status) => {
    phases.push([phase, status]);
    throw new Error('synthetic diagnostic failure');
  });
  assert.equal((await runtime.cleanupExactProducts()).errorCode, 'semanticCleanupProcessRemains');
  assert.equal(runtime.outcome().productProcessAbsent, false);
  assert.equal(calls.length, 3);
  assert.deepEqual(phases, [
    ['sourceProductInspection', 'started'], ['sourceProductInspection', 'completed'],
    ['targetProductInspection', 'started'], ['targetProductInspection', 'completed'],
    ['targetProductUninstall', 'started'], ['targetProductUninstall', 'failed'],
  ]);
});

test('a rejected adapter invocation is not proof of absence', async () => {
  const { runtime, calls } = productRuntime([new Error('synthetic adapter failure'), exited]);
  assert.equal((await runtime.verifyExactProductStates()).errorCode, 'productStateVerificationProcessRemains');
  assert.equal(calls.length, 1);
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
