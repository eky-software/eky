import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runW6b2PackagedScenarioProcess } from './w6b2PackagedScenarioProcess.mjs';

const proofToken = 'a'.repeat(64);

test('preserves a normal exit and proves the owned tree absent', async () => {
  const harness = createHarness();
  const run = startScenario(harness);

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(harness.cleanupCount(), 1);
  assert.equal(harness.clearedTimerCount(), 1);
  assert.equal(harness.child.listenerCount('error'), 0);
  assert.equal(harness.child.listenerCount('exit'), 0);
  assert.deepEqual(lastEvent(harness.events), {
    durationMs: 0,
    elapsedMs: 0,
    operation: 'w6b2PackagedScenario',
    phase: 'processTreeAbsent',
    status: 'completed',
  });
});

test('passes the closed scenario kind to exact owned-process cleanup', async () => {
  const cleanupInputs = [];
  const harness = createHarness({
    async terminateOwnedProcessTree(input) {
      cleanupInputs.push(input);
      return { status: 'absent' };
    },
  });
  const run = startScenario(harness, 'faultRollback');

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(cleanupInputs.length, 1);
  assert.equal(cleanupInputs[0].scenarioKind, 'faultRollback');
});

test('preserves a non-zero scenario exit after bounded cleanup', async () => {
  const harness = createHarness();
  const run = startScenario(harness);

  harness.child.emit('exit', 23, null);

  await assert.rejects(
    run,
    /W6B2_PACKAGED_SCENARIO_PROCESS_EXIT_FAILED/u,
  );
  assert.equal(harness.cleanupCount(), 1);
});

test('turns an absolute deadline into a safe timeout after cleanup', async () => {
  const harness = createHarness();
  const run = startScenario(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT/u);
  assert.equal(harness.cleanupCount(), 1);
  assert.ok(
    harness.events.some(
      (event) =>
        event.phase === 'waitTimedOut' &&
        event.errorCode === 'W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT',
    ),
  );
});

test('keeps timeout as the terminal result if PowerShell exits before cleanup', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      harness.child.emit('exit', 0, null);
      return { status: 'absent' };
    },
  });
  const run = startScenario(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B2_PACKAGED_SCENARIO_PROCESS_TIMEOUT/u);
});

test('fails closed when a child process remains after cleanup', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      return { status: 'remains' };
    },
  });
  const run = startScenario(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B2_PACKAGED_SCENARIO_CLEANUP_FAILED/u);
});

test('preserves cleanup timeout as the terminal failure', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      throw new Error('W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT');
    },
  });
  const run = startScenario(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B2_PACKAGED_SCENARIO_CLEANUP_TIMEOUT/u);
});

test('observer failure cannot change the process result', async () => {
  const harness = createHarness({
    observe() {
      throw new Error('private observer failure');
    },
  });
  const run = startScenario(harness);

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(harness.clearedTimerCount(), 1);
  assert.equal(harness.child.listenerCount('error'), 0);
  assert.equal(harness.child.listenerCount('exit'), 0);
});

test('safe observations do not expose process inputs', async () => {
  const harness = createHarness();
  const run = startScenario(harness);

  harness.child.emit('exit', 9, null);
  await assert.rejects(run);

  const serialized = JSON.stringify(harness.events);
  assert.doesNotMatch(serialized, /fixture-path|ProofToken|powershell|stack/iu);
  for (const event of harness.events) {
    assert.deepEqual(Object.keys(event).sort(), [
      ...(event.errorCode === undefined ? [] : ['errorCode']),
      'durationMs',
      'elapsedMs',
      'operation',
      'phase',
      'status',
    ].sort());
  }
});

test('cleanup script validates exact proof ownership without name-wide termination', async () => {
  const source = await readFile(
    new URL('./stopW6b2PackagedScenarioProcess.ps1', import.meta.url),
    'utf8',
  );

  assert.match(source, /ValidatePattern\('\^\[0-9a-f\]\{64\}\$'\)/u);
  assert.match(source, /ValidateSet\('success', 'faultRollback'\)/u);
  assert.match(source, /testW6b2PackagedSuccess\.ps1/u);
  assert.match(source, /testW6b2PackagedFaultRollback\.ps1/u);
  assert.match(source, /\[regex\]::Escape\(\$scenarioScriptName\)/u);
  assert.match(source, /Stop-EkyProcessTree -Process \$process/u);
  assert.match(source, /actualCreationToken -cne \$expectedCreationToken/u);
  assert.doesNotMatch(source, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(source, /taskkill\.exe/iu);
});

test('rejects an unknown scenario kind before process creation', async () => {
  const harness = createHarness();

  await assert.rejects(
    startScenario(harness, 'foreign'),
    /W6B2_PACKAGED_SCENARIO_INPUT_INVALID/u,
  );
  assert.equal(harness.spawnCount(), 0);
});

function startScenario(harness, scenarioKind = 'success') {
  return runW6b2PackagedScenarioProcess(
    {
      arguments: ['-File', 'fixture-path', '-ProofToken', proofToken],
      cleanupTimeoutMilliseconds: 10,
      command: 'powershell.exe',
      cwd: 'fixture-path',
      environment: {},
      proofToken,
      scenarioKind,
      timeoutMilliseconds: 10,
    },
    { dependencies: harness.dependencies },
  );
}

function createHarness(overrides = {}) {
  const child = new EventEmitter();
  child.pid = 42;
  const events = [];
  let cleanupCount = 0;
  let clearedTimerCount = 0;
  let deadline;
  let spawnCount = 0;
  const terminateOwnedProcessTree =
    overrides.terminateOwnedProcessTree ??
    (async () => {
      cleanupCount += 1;
      return { status: 'absent' };
    });
  const dependencies = {
    clearTimeout() {
      clearedTimerCount += 1;
    },
    now() {
      return 1_000;
    },
    observe: overrides.observe ?? ((event) => events.push(event)),
    setTimeout(callback) {
      deadline = callback;
      return Object.freeze({ timer: true });
    },
    spawnProcess() {
      spawnCount += 1;
      return child;
    },
    async terminateOwnedProcessTree(input) {
      if (overrides.terminateOwnedProcessTree !== undefined) cleanupCount += 1;
      return terminateOwnedProcessTree(input);
    },
  };
  return {
    child,
    cleanupCount: () => cleanupCount,
    clearedTimerCount: () => clearedTimerCount,
    dependencies,
    events,
    fireDeadline() {
      assert.equal(typeof deadline, 'function');
      deadline();
    },
    spawnCount: () => spawnCount,
  };
}

function lastEvent(events) {
  assert.ok(events.length > 0);
  return events.at(-1);
}
