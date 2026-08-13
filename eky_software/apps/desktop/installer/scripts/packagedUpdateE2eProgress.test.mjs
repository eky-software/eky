import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPackagedUpdateE2eProgressObserver,
  packagedUpdateE2ePhases,
  packagedUpdateE2eScenarios,
} from './packagedUpdateE2eProgress.mjs';

describe('packaged update E2E progress observer', () => {
  it('emits a start and terminal event for every reviewed scenario', async () => {
    const events = [];
    const progress = createTestObserver(events);

    for (const scenario of packagedUpdateE2eScenarios) {
      assert.equal(
        await progress.runScenario(scenario, async () => scenario),
        scenario,
      );
    }

    for (const scenario of packagedUpdateE2eScenarios) {
      assert.deepEqual(
        events
          .filter((event) => event.scenario === scenario)
          .map((event) => event.event),
        ['scenarioStarted', 'scenarioCompleted'],
      );
    }
  });

  it('emits a start and completion pair for every reviewed phase', async () => {
    const events = [];
    const progress = createTestObserver(events);

    for (const phase of packagedUpdateE2ePhases) {
      await progress.runPhase(
        { phase, scenario: 'coordinatedSuccess' },
        async () => undefined,
      );
    }

    for (const phase of packagedUpdateE2ePhases) {
      assert.deepEqual(
        events
          .filter((event) => event.phase === phase)
          .map((event) => event.event),
        ['phaseStarted', 'phaseCompleted'],
      );
    }
  });

  it('emits safe failed terminal events and preserves the original error', async () => {
    const events = [];
    const progress = createTestObserver(events);
    const failure = new Error('PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT');

    await assert.rejects(
      progress.runScenario('coordinatedRollback', () =>
        progress.runPhase(
          {
            phase: 'coordinatedRollbackInstallerWait',
            scenario: 'coordinatedRollback',
          },
          async () => {
            throw failure;
          },
        ),
      ),
      (error) => error === failure,
    );

    assert.deepEqual(
      events.map(({ errorCode, event }) => ({ errorCode, event })),
      [
        { errorCode: undefined, event: 'scenarioStarted' },
        { errorCode: undefined, event: 'phaseStarted' },
        {
          errorCode: 'PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT',
          event: 'phaseFailed',
        },
        {
          errorCode: 'PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT',
          event: 'scenarioFailed',
        },
      ],
    );
  });

  it('rejects unknown scenarios and phases before running an operation', async () => {
    const progress = createTestObserver([]);
    let operationCount = 0;
    const operation = async () => {
      operationCount += 1;
    };

    await assert.rejects(
      progress.runScenario('unknownScenario', operation),
      /PACKAGED_UPDATE_E2E_PROGRESS_SCENARIO_INVALID/,
    );
    await assert.rejects(
      progress.runPhase(
        { phase: 'unknownPhase', scenario: 'coordinatedSuccess' },
        operation,
      ),
      /PACKAGED_UPDATE_E2E_PROGRESS_PHASE_INVALID/,
    );
    assert.equal(operationCount, 0);
  });

  it('never writes a raw error, path or stack to a progress line', async () => {
    const lines = [];
    const progress = createPackagedUpdateE2eProgressObserver({
      now: createClock(),
      setIntervalFn: createInactiveTimer,
      writeLine: (line) => lines.push(line),
    });
    const failure = new Error(
      'C:\\private\\release\\Eky.msi --runtime-session=secret',
    );
    failure.stack = 'STACK C:\\private\\release\\Eky.msi';

    await assert.rejects(
      progress.runPhase(
        { phase: 'nextPackageInstall', scenario: 'coordinatedSuccess' },
        async () => {
          throw failure;
        },
      ),
      (error) => error === failure,
    );

    const output = lines.join('\n');
    assert.doesNotMatch(output, /private|Eky\.msi|runtime-session|STACK|secret/);
    assert.match(output, /PACKAGED_UPDATE_E2E_PROGRESS_FAILURE/);
  });

  it('stops the heartbeat in finally after a failed operation', async () => {
    const events = [];
    const clearedTimers = [];
    let heartbeat;
    const timer = { unrefCalled: false };
    const progress = createPackagedUpdateE2eProgressObserver({
      clearIntervalFn: (value) => clearedTimers.push(value),
      now: createClock(),
      setIntervalFn: (callback, milliseconds) => {
        assert.equal(milliseconds, 60_000);
        heartbeat = callback;
        timer.unref = () => {
          timer.unrefCalled = true;
        };
        return timer;
      },
      writeLine: (line) => events.push(JSON.parse(line)),
    });

    await assert.rejects(
      progress.runPhase(
        { phase: 'applicationExitWait', scenario: 'directSetupFailure' },
        async () => {
          heartbeat();
          throw new Error('PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID');
        },
      ),
      /PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID/,
    );

    assert.equal(timer.unrefCalled, true);
    assert.deepEqual(clearedTimers, [timer]);
    assert.deepEqual(
      events.map((event) => event.event),
      ['phaseStarted', 'heartbeat', 'phaseFailed'],
    );
  });

  it('reports cleanup boundaries without changing the cleanup result', async () => {
    const events = [];
    const progress = createTestObserver(events);
    const result = Object.freeze({ cleaned: true });

    assert.equal(
      await progress.runCleanup(
        { phase: 'scenarioPostCleanup', scenario: 'directSetupSuccess' },
        async () => result,
      ),
      result,
    );
    assert.deepEqual(
      events.map((event) => event.event),
      ['cleanupStarted', 'cleanupCompleted'],
    );
  });

  it('does not let a broken output writer change an operation result', async () => {
    const progress = createPackagedUpdateE2eProgressObserver({
      now: createClock(),
      setIntervalFn: createInactiveTimer,
      writeLine: () => {
        throw new Error('writer failed with C:\\private\\path');
      },
    });

    assert.equal(
      await progress.runPhase(
        { phase: 'fixtureRead' },
        async () => 'unchanged-result',
      ),
      'unchanged-result',
    );
  });

  it('keeps a nonzero process outcome as an error with observability enabled', async () => {
    const events = [];
    const progress = createTestObserver(events);
    const failure = new Error('PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID');

    await assert.rejects(
      progress.runPhase(
        {
          phase: 'applicationOutcomeValidation',
          scenario: 'directSetupFailure',
        },
        async () => {
          throw failure;
        },
      ),
      (error) => error === failure,
    );
    assert.equal(events.at(-1).event, 'phaseFailed');
    assert.equal(
      events.at(-1).errorCode,
      'PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID',
    );
  });
});

function createTestObserver(events) {
  return createPackagedUpdateE2eProgressObserver({
    now: createClock(),
    setIntervalFn: createInactiveTimer,
    writeLine: (line) => events.push(JSON.parse(line)),
  });
}

function createClock() {
  let value = 0;
  return () => {
    value += 10;
    return value;
  };
}

function createInactiveTimer() {
  return { unref() {} };
}
