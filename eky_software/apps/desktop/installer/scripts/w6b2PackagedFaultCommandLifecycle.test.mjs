import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createW6b2PackagedFaultCommandLifecycle,
  W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS,
} from './w6b2PackagedFaultCommandLifecycle.mjs';

const runContext = Object.freeze({
  faultScenario: 'acceptanceInterruption',
  runNumber: 2,
});

test('records a closed fault command lifecycle with allowlisted context', async () => {
  let now = 1_000;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });

  await lifecycle.runPhase('installerPairBuild', async () => {
    now += 40;
  });
  await lifecycle.runPhase(
    'scenario',
    async () => {
      now += 30;
    },
    runContext,
  );
  lifecycle.observeProcessTreeAbsent(runContext);
  await lifecycle.runCleanupPhase(
    'fixtureRemove',
    async () => {
      now += 20;
    },
    runContext,
  );
  lifecycle.complete();

  assert.deepEqual(
    events.map(({ faultScenario, phase, runNumber, status }) => ({
      phase,
      status,
      ...(faultScenario === undefined ? {} : { faultScenario }),
      ...(runNumber === undefined ? {} : { runNumber }),
    })),
    [
      { phase: 'command', status: 'started' },
      { phase: 'installerPairBuild', status: 'started' },
      { phase: 'installerPairBuild', status: 'completed' },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'scenario',
        runNumber: 2,
        status: 'started',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'scenario',
        runNumber: 2,
        status: 'completed',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'processTreeAbsent',
        runNumber: 2,
        status: 'completed',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'cleanup',
        runNumber: 2,
        status: 'started',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'fixtureRemove',
        runNumber: 2,
        status: 'started',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'fixtureRemove',
        runNumber: 2,
        status: 'completed',
      },
      {
        faultScenario: 'acceptanceInterruption',
        phase: 'cleanup',
        runNumber: 2,
        status: 'completed',
      },
      { phase: 'command', status: 'completed' },
    ],
  );
});

test('retains the full scenario and cleanup budget after a slow build', () => {
  let now = 0;
  const lifecycle = createW6b2PackagedFaultCommandLifecycle({
    dependencies: { now: () => now, observe() {} },
  });
  now = 531_297;

  assert.doesNotThrow(() =>
    lifecycle.requireScenarioStartBudget(12 * 60 * 1000, runContext),
  );
  assert.equal(
    lifecycle.getScenarioTimeoutMilliseconds(
      12 * 60 * 1000,
      runContext,
    ),
    12 * 60 * 1000,
  );
  assert.equal(W6B2_PACKAGED_FAULT_COMMAND_TIMEOUT_MILLISECONDS, 1_500_000);
});

test('fails closed before a scenario that cannot retain cleanup reserve', () => {
  let now = 0;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });
  now = 851;

  assert.throws(
    () => lifecycle.requireScenarioStartBudget(50, runContext),
    /W6B2_FAULT_COMMAND_DEADLINE_EXCEEDED/u,
  );
  lifecycle.fail(new Error('W6B2_FAULT_COMMAND_DEADLINE_EXCEEDED'));

  assert.deepEqual(
    events.slice(-2).map(({ errorCode, phase, status }) => ({
      errorCode,
      phase,
      status,
    })),
    [
      {
        errorCode: 'W6B2_FAULT_COMMAND_DEADLINE_EXCEEDED',
        phase: 'commandDeadline',
        status: 'failed',
      },
      {
        errorCode: 'W6B2_FAULT_COMMAND_DEADLINE_EXCEEDED',
        phase: 'command',
        status: 'failed',
      },
    ],
  );
});

test('cleanup remains observable after the command deadline', async () => {
  let now = 0;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });
  now = 1_001;
  let cleaned = false;

  await lifecycle.runCleanupPhase(
    'fixtureRemove',
    async () => {
      cleaned = true;
    },
    runContext,
  );

  assert.equal(cleaned, true);
  assert.equal(
    events.some(
      ({ phase, status }) =>
        phase === 'fixtureRemove' && status === 'completed',
    ),
    true,
  );
});

test('observer receives no caller supplied failures or unsafe context', async () => {
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => 0 });

  await assert.rejects(
    lifecycle.runPhase(
      'scenario',
      async () => {
        throw new Error(
          'C:\\private\\fixture secret session stack companyId command-line',
        );
      },
      runContext,
    ),
    /private/u,
  );
  lifecycle.fail(new Error('private failure'));

  const output = JSON.stringify(events);
  assert.doesNotMatch(
    output,
    /private|secret|session|companyId|command-line|stack|C:\\\\/iu,
  );
  assert.match(output, /acceptanceInterruption/u);
  assert.match(output, /W6B2_FAULT_COMMAND_PHASE_FAILED/u);
  assert.match(output, /W6B2_FAULT_COMMAND_FAILED/u);
  assert.throws(
    () => lifecycle.observeProcessTreeAbsent({
      faultScenario: 'unknown',
      runNumber: 1,
    }),
    /W6B2_FAULT_SCENARIO_INVALID/u,
  );
});

function createLifecycle({ events = [], now }) {
  return createW6b2PackagedFaultCommandLifecycle({
    cleanupReserveMilliseconds: 100,
    dependencies: {
      now,
      observe(event) {
        events.push(event);
      },
    },
    timeoutMilliseconds: 1_000,
  });
}
