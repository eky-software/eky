import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { executeLegacyUpgradeLifecycle } from './legacyUpgradeLifecycle.mjs';
import { LEGACY_FOOTPRINT_ERROR_CODES } from './legacyUpgradeContracts.mjs';
import { runHistoricalPackagedSmokeProcessChain } from './legacyUpgradeSourceSmoke.mjs';
import { startLegacyOwnedProcess } from './legacyUpgradeWindowsRuntime.mjs';

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

test('legacy MSI observations preserve the close boundary before target postconditions', async () => {
  const child = new EventEmitter();
  child.pid = 17;
  const reached = Promise.withResolvers();
  const entries = [];
  const dependencies = successfulDependencies({
    reportProgress: (entry) => entries.push(entry),
    async runMsiOperation(operation, observe) {
      if (operation === 'sourceInstall') return 0;
      // Unknown observer input is never a public progress value.
      observe('private-path-or-error');
      const execution = await startLegacyOwnedProcess('synthetic', [], {}, {
        observe,
        spawnProcess() { queueMicrotask(() => child.emit('spawn')); return child; },
      });
      reached.resolve();
      return (await execution.completion).exitCode;
    },
  });
  const outcome = executeLegacyUpgradeLifecycle(dependencies);
  await reached.promise;
  child.emit('exit', 0, null);
  await setImmediate();
  assert.equal(entries.some((entry) => entry.phase === 'targetPostcondition'), false);
  child.emit('close', 0, null);
  assert.equal((await outcome).status, 'completed');
  const observations = entries.filter((entry) => entry.phase === 'majorUpgrade' && entry.status === 'observed');
  assert.deepEqual(observations.map((entry) => entry.resultCode), [
    'processSpawnRequested', 'processSpawned', 'processExited', 'processClosed',
  ]);
  for (const entry of observations) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'durationMs', 'elapsedMs', 'operation', 'phase', 'resultCode', 'scenario', 'schemaVersion', 'status',
    ]);
    assert.equal(entry.operation, 'historicalLegacyUpgradeLifecycle');
    assert.equal(entry.scenario, 'historicalLegacyUpgrade');
    assert.equal(entry.schemaVersion, 1);
    assert.ok(Number.isInteger(entry.durationMs) && entry.durationMs >= 0);
    assert.ok(Number.isInteger(entry.elapsedMs) && entry.elapsedMs >= entry.durationMs);
  }
  assert.ok(entries.indexOf(observations.at(-1)) < entries.findIndex((entry) => entry.phase === 'targetPostcondition'));
  assert.doesNotMatch(JSON.stringify(entries), /private-path-or-error/);
});

test('legacy failed MSI stays failed when process progress reporting throws', async () => {
  const result = await executeLegacyUpgradeLifecycle(successfulDependencies({
    reportProgress() { throw new Error('private observer failure'); },
    async runMsiOperation(operation, observe) {
      for (const code of ['processSpawnRequested', 'processSpawned', 'processExited', 'processClosed']) observe(code);
      return operation === 'majorUpgrade' ? 1603 : 0;
    },
  }));
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'majorUpgradeFailed');
  assert.equal(result.targetFirstStartupValidated, false);
});

for (const [name, content, exitCode, reason, stage, status, failureClass = 'notReported'] of [
  ['reported failure', { stage: 'backend', status: 'failed', code: 'PRIVATE_FAILURE_DETAIL' },
    1, 'applicationReportedFailure', 'backend', 'failed', 'unclassified'],
  ['backend readiness timeout', { stage: 'backend', status: 'failed', code: 'BACKEND_READINESS_TIMEOUT' },
    1, 'applicationReportedFailure', 'backend', 'failed', 'backendReadinessTimeout'],
  ['backend exited before ready', { stage: 'backend', status: 'failed', code: 'BACKEND_EXITED_BEFORE_READY' },
    1, 'applicationReportedFailure', 'backend', 'failed', 'backendExitedBeforeReady'],
  ['invalid result', '{\n', 0, 'resultInvalid', 'unknown', 'unknown'],
  ['incomplete result at exit', '{', 0, 'processExitedEarly', 'unknown', 'unknown'],
  ['nonzero exit after result', { stage: 'restoreRestart', status: 'started' },
    1, 'processExitFailed', 'restoreRestart', 'started'],
  ['spawn failure', null, null, 'processStartFailed', 'unknown', 'unknown'],
]) {
  test(`historical smoke ${name} retains safe failure evidence without advancing`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-evidence-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    for (const brokenObserver of [false, true]) {
      const resultPath = join(root, `result-${brokenObserver}.json`);
      const entries = [];
      const starts = [];
      const dependencies = successfulDependencies({
        runSourcePackagedSmoke: () => runHistoricalPackagedSmokeProcessChain({
          resultPath,
          async startGeneration(generation) {
            starts.push(generation);
            if (content === null) throw new Error('private-path-and-secret');
            await writeFile(resultPath, typeof content === 'string' ? content : `${JSON.stringify(content)}\n`);
            return { completion: Promise.resolve({ exitCode }) };
          },
        }),
        reportProgress(entry) {
          entries.push(entry);
          if (brokenObserver) throw new Error('private-observer-failure');
        },
      });
      const result = await executeLegacyUpgradeLifecycle(dependencies);
      assert.equal(result.status, 'failed');
      assert.equal(result.errorCode, 'sourcePackagedSmokeFailed');
      assert.equal(result.sourcePackagedSmokeValidated, false);
      assert.equal(dependencies.calls.includes('sourceStartup'), false);
      assert.equal(dependencies.calls.includes('majorUpgrade'), false);
      assert.deepEqual(starts, ['initial']);
      const evidence = entries.find(entry => entry.phase === 'sourcePackagedSmoke' && entry.status === 'failed');
      assert.deepEqual(Object.keys(evidence).sort(), [
        'durationMs', 'elapsedMs', 'errorCode', 'operation', 'phase', 'scenario',
        'schemaVersion', 'smokeFailureClass', 'smokeGeneration', 'smokeReason', 'smokeStage', 'smokeStatus', 'status',
      ].sort());
      assert.equal(evidence.smokeReason, reason);
      assert.equal(evidence.smokeStage, stage);
      assert.equal(evidence.smokeStatus, status);
      assert.equal(evidence.smokeFailureClass, failureClass);
      assert.equal(evidence.smokeGeneration, 'initial');
      assert.doesNotMatch(JSON.stringify({ entries, result }), /PRIVATE_FAILURE_DETAIL|private-path|private-observer/);
    }
  });
}

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

test('every closed footprint rejection survives lifecycle progress and blocks target startup', async () => {
  for (const errorCode of Object.keys(LEGACY_FOOTPRINT_ERROR_CODES)) {
    let inspection = 0;
    const entries = [];
    const dependencies = successfulDependencies({
      async inspectState() {
        if (++inspection === 1) return state();
        if (inspection === 2) return state('source');
        throw new Error(errorCode);
      },
      reportProgress: (entry) => entries.push(entry),
    });
    const result = await executeLegacyUpgradeLifecycle(dependencies);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, errorCode);
    assert.equal(result.targetFirstStartupValidated, false);
    assert.equal(dependencies.calls.includes('first'), false);
    assert.equal(entries.find((entry) => entry.phase === 'targetPostcondition' && entry.status === 'failed').errorCode, errorCode);
  }
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
