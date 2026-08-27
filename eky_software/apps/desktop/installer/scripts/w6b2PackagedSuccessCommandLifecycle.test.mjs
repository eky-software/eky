import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createW6b2PackagedSuccessCommandLifecycle,
  createW6b2PackagedSuccessRunPhase,
} from './w6b2PackagedSuccessCommandLifecycle.mjs';

test('records closed command and phase lifecycle events', async () => {
  let now = 1_000;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });

  await lifecycle.runPhase('installerPairBuild', async () => {
    now += 40;
  });
  await lifecycle.runCleanupPhase('run1FixtureRemove', async () => {
    now += 20;
  });
  lifecycle.observeProcessTreeAbsent(1);
  lifecycle.complete();

  assert.deepEqual(
    events.map(({ phase, status }) => ({ phase, status })),
    [
      { phase: 'command', status: 'started' },
      { phase: 'installerPairBuild', status: 'started' },
      { phase: 'installerPairBuild', status: 'completed' },
      { phase: 'cleanup', status: 'started' },
      { phase: 'run1FixtureRemove', status: 'started' },
      { phase: 'run1FixtureRemove', status: 'completed' },
      { phase: 'cleanup', status: 'completed' },
      { phase: 'run1ProcessTreeAbsent', status: 'completed' },
      { phase: 'command', status: 'completed' },
    ],
  );
  assert.deepEqual(Object.keys(events[0]), [
    'operation',
    'phase',
    'status',
    'durationMs',
    'elapsedMs',
  ]);
});

test('preserves the existing scenario timeout only with cleanup reserve', () => {
  let now = 0;
  const lifecycle = createLifecycle({ now: () => now });
  assert.equal(lifecycle.getScenarioTimeoutMilliseconds(500), 500);

  now = 401;
  assert.throws(
    () => lifecycle.getScenarioTimeoutMilliseconds(500),
    /W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED/u,
  );
});

test('fails closed before a scenario that cannot retain cleanup reserve', () => {
  let now = 0;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });
  now = 851;

  assert.throws(
    () => lifecycle.requireScenarioStartBudget(50),
    /W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED/u,
  );
  lifecycle.fail(new Error('W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED'));

  assert.deepEqual(
    events.slice(-2).map(({ errorCode, phase, status }) => ({
      errorCode,
      phase,
      status,
    })),
    [
      {
        errorCode: 'W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED',
        phase: 'commandDeadline',
        status: 'failed',
      },
      {
        errorCode: 'W6B2_SUCCESS_COMMAND_DEADLINE_EXCEEDED',
        phase: 'command',
        status: 'failed',
      },
    ],
  );
});

test('retains the full scenario and cleanup budget after a measured slow installer build', () => {
  let now = 0;
  const lifecycle = createW6b2PackagedSuccessCommandLifecycle({
    dependencies: {
      now: () => now,
      observe() {},
    },
  });
  now = 531_297;

  assert.doesNotThrow(() =>
    lifecycle.requireScenarioStartBudget(12 * 60 * 1000),
  );
  assert.equal(
    lifecycle.getScenarioTimeoutMilliseconds(12 * 60 * 1000),
    12 * 60 * 1000,
  );
});

test('cleanup runs after the command deadline without changing its result', async () => {
  let now = 0;
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => now });
  now = 1_001;
  let cleaned = false;

  await lifecycle.runCleanupPhase('run2FixtureRemove', async () => {
    cleaned = true;
  });

  assert.equal(cleaned, true);
  assert.equal(
    events.some(
      ({ phase, status }) =>
        phase === 'run2FixtureRemove' && status === 'completed',
    ),
    true,
  );
});

test('observer receives no caller supplied values or raw failures', async () => {
  const events = [];
  const lifecycle = createLifecycle({ events, now: () => 0 });

  await assert.rejects(
    lifecycle.runPhase('profilePreparation', async () => {
      throw new Error(
        'C:\\private\\fixture secret session stack companyId command-line',
      );
    }),
    /private/u,
  );
  lifecycle.fail(new Error('private failure'));

  const output = JSON.stringify(events);
  assert.doesNotMatch(
    output,
    /private|secret|session|companyId|command-line|stack|C:\\\\/iu,
  );
  assert.match(output, /W6B2_SUCCESS_COMMAND_PHASE_FAILED/u);
  assert.match(output, /W6B2_SUCCESS_COMMAND_FAILED/u);
});

test('rejects unknown run phases', () => {
  assert.throws(
    () => createW6b2PackagedSuccessRunPhase(3, 'Scenario'),
    /W6B2_SUCCESS_COMMAND_PHASE_INVALID/u,
  );
  assert.throws(
    () => createW6b2PackagedSuccessRunPhase(1, 'Foreign'),
    /W6B2_SUCCESS_COMMAND_PHASE_INVALID/u,
  );
});

function createLifecycle({ events = [], now }) {
  return createW6b2PackagedSuccessCommandLifecycle({
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
