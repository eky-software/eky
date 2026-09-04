import assert from 'node:assert/strict';
import test from 'node:test';

import { executeLegacyUpgradeLifecycle } from './legacyUpgradeLifecycle.mjs';

const VERSIONS = Object.freeze({ source: '0.2.6', target: '0.2.7' });

function product(version = null, registry = false) {
  return Object.freeze({
    schemaVersion: 1,
    productState: version === null ? -1 : 5,
    productName: version === null ? null : 'Eky',
    productVersion: version,
    localPackagePresent: version !== null,
    ownedRegistryExists: registry,
    ekyProcessCount: 0,
  });
}

function state(active = null) {
  const present = active !== null;
  return Object.freeze({
    source: product(active === 'source' ? VERSIONS.source : null, present),
    target: product(active === 'target' ? VERSIONS.target : null, present),
    installRootExists: present,
    executableExists: present,
    shortcutExists: present,
    installerRegistryExists: present,
    ekyProcessCount: 0,
  });
}

function successfulDependencies(overrides = {}) {
  const states = [state(), state('source'), state('target')];
  const calls = [];
  return {
    captureSourceEvidence: async () => calls.push('sourceEvidence'),
    inspectState: async () => states.shift(),
    reportProgress: () => undefined,
    runMsiOperation: async (operation) => {
      calls.push(operation);
      return 0;
    },
    runSourcePackagedSmoke: async () => calls.push('sourceSmoke'),
    runTargetStartup: async (generation) => calls.push(generation),
    validateTargetPayload: async () => calls.push('payload'),
    verifyArtifact: async () => calls.push('artifact'),
    versions: VERSIONS,
    calls,
    ...overrides,
  };
}

test('legacy lifecycle proves historical smoke, major upgrade, and two target starts', async () => {
  const dependencies = successfulDependencies();
  const result = await executeLegacyUpgradeLifecycle(dependencies);
  assert.equal(result.status, 'completed');
  assert.deepEqual(dependencies.calls, [
    'artifact',
    'sourceInstall',
    'sourceSmoke',
    'sourceEvidence',
    'majorUpgrade',
    'payload',
    'first',
    'second',
    'artifact',
  ]);
});

test('legacy lifecycle does not own emergency cleanup after a failed upgrade', async () => {
  const dependencies = successfulDependencies({
    runMsiOperation: async (operation) =>
      operation === 'majorUpgrade' ? 1603 : 0,
  });
  const result = await executeLegacyUpgradeLifecycle(dependencies);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'majorUpgradeFailed');
  assert.equal(result.targetFirstStartupValidated, false);
});

test('legacy lifecycle rejects a non-empty machine precondition', async () => {
  const dependencies = successfulDependencies({
    inspectState: async () => state('source'),
  });
  const result = await executeLegacyUpgradeLifecycle(dependencies);
  assert.equal(result.errorCode, 'upgradeLifecyclePreconditionFailed');
  assert.deepEqual(dependencies.calls, []);
});

test('safe progress failure cannot alter lifecycle semantics', async () => {
  const result = await executeLegacyUpgradeLifecycle(
    successfulDependencies({
      reportProgress() {
        throw new Error('output failed');
      },
    }),
  );
  assert.equal(result.status, 'completed');
});
