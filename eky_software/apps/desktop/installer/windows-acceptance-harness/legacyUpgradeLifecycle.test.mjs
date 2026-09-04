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
    runSourceStartup: async () => calls.push('sourceStartup'),
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
    'sourceStartup',
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

test('legacy lifecycle preserves a closed product inspection failure class', async () => {
  let inspection = 0;
  const result = await executeLegacyUpgradeLifecycle(
    successfulDependencies({
      inspectState: async () => {
        inspection += 1;
        if (inspection === 1) return state();
        if (inspection === 2) return state('source');
        throw new Error('installerTargetProductInspectionFailed');
      },
    }),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'installerTargetProductInspectionFailed');
});

for (const [dependency, errorCode, forbiddenCall] of [
  ['runSourcePackagedSmoke', 'sourcePackagedSmokeFailed', 'sourceStartup'],
  ['runSourceStartup', 'sourceNormalStartupFailed', 'sourceEvidence'],
  ['captureSourceEvidence', 'legacyBusinessFixtureInvalid', 'majorUpgrade'],
  ['validateTargetPayload', 'majorUpgradeStateInvalid', 'first'],
]) {
  test(`${dependency} failure stops the next lifecycle step and hides raw errors`, async () => {
    const entries = [];
    const dependencies = successfulDependencies({
      [dependency]: async () => { throw new Error('private-path-and-secret'); },
      reportProgress: (entry) => entries.push(entry),
    });
    const result = await executeLegacyUpgradeLifecycle(dependencies);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, errorCode);
    assert.equal(dependencies.calls.includes(forbiddenCall), false);
    assert.equal(JSON.stringify(entries).includes('private-path-and-secret'), false);
    assert.equal(entries.filter((entry) => entry.phase === 'lifecycle' && entry.status === 'failed').length, 1);
  });
}

for (const failingGeneration of ['first', 'second']) {
  test(`target ${failingGeneration} startup failure cannot accept the upgrade`, async () => {
    const starts = [];
    const result = await executeLegacyUpgradeLifecycle(successfulDependencies({
      runTargetStartup: async (generation) => {
        starts.push(generation);
        if (generation === failingGeneration) throw new Error('privateFailure');
      },
      reportProgress: () => { throw new Error('brokenOutput'); },
    }));
    assert.equal(result.errorCode, failingGeneration === 'first' ? 'targetFirstStartupFailed' : 'targetSecondStartupFailed');
    assert.equal(result.status, 'failed');
    assert.equal(result.targetSecondStartupValidated, false);
    assert.equal(result.artifactBytesValidated, false);
    assert.deepEqual(starts, failingGeneration === 'first' ? ['first'] : ['first', 'second']);
  });
}
