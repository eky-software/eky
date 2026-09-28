import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import test from 'node:test';
import { observeWorkspaceInstallation } from './workspaceInstallationObservation.mjs';

const PHASES = [
  'installation', 'installationWait', 'installedState', 'payload', 'artifactFixture',
  'activityBeforeCommand', 'activityBeforeResult', 'activityBeforeCleanup',
  'sourceProductCommand', 'sourceProductResult', 'sourceProductCleanup',
  'targetProductCommand', 'targetProductResult', 'targetProductCleanup',
  'activityAfterCommand', 'activityAfterResult', 'activityAfterCleanup',
  'rollbackProgressRead', 'nextObservation',
];
const RECORD_KEYS = ['schemaVersion', 'operation', 'role', 'phase', 'status', 'observation', 'busyCount'].sort();

function fakeScheduler() {
  const scheduled = [];
  const cancelled = [];
  let unrefCalls = 0;
  const handle = { unref() { unrefCalls++; } };
  return {
    scheduled, cancelled, handle,
    get unrefCalls() { return unrefCalls; },
    schedule(callback, delay) { scheduled.push({ callback, delay }); return handle; },
    cancel(timer) { cancelled.push(timer); },
    // Deliberately deliver even cancelled callbacks to check the inactive guard.
    tick() { for (const { callback } of scheduled) callback(); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function record(role, phase, status, observation, busyCount = 0) {
  return { schemaVersion: 1, operation: 'workspaceInstallationObservation',
    role, phase, status, observation, busyCount };
}

function assertClosedRecords(records, role) {
  for (const value of records) {
    assert.deepEqual(Reflect.ownKeys(value).sort(), RECORD_KEYS);
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.operation, 'workspaceInstallationObservation');
    assert.equal(value.role, role);
    assert.ok(PHASES.includes(value.phase));
    assert.ok(['started', 'completed', 'failed'].includes(value.status));
    assert.ok(['first', 'heartbeat', 'terminal', 'truncated'].includes(value.observation));
    assert.ok(Number.isSafeInteger(value.busyCount) && value.busyCount >= 0 && value.busyCount <= 1_000_000);
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
}

for (const role of ['source', 'target']) {
  test(`${role} observations report each allowed boundary immediately and preserve result identity`, async () => {
    const clock = fakeScheduler();
    const records = [];
    let valueReads = 0;
    const result = Object.freeze({ privateValue: 'synthetic-private-value',
      get toJSON() { valueReads++; throw new Error('synthetic-private-value-access'); } });
    const returned = await observeWorkspaceInstallation(role, (value) => records.push(value), async ({ step }) => {
      assert.deepEqual(records, [record(role, 'installation', 'started', 'first')]);
      for (const phase of PHASES.slice(1)) {
        assert.equal(await step(phase, () => {
          assert.deepEqual(records.at(-1), record(role, phase, 'started', 'first'));
          return result;
        }), result);
        assert.deepEqual(records.at(-1), record(role, phase, 'completed', 'first'));
      }
      return result;
    }, clock);
    assert.equal(returned, result);
    assert.equal(valueReads, 0);
    assert.equal(records.length, 2 * PHASES.length);
    assert.deepEqual(records.at(-1), record(role, 'installation', 'completed', 'terminal'));
    assert.equal(clock.scheduled.length, 1);
    assert.equal(clock.scheduled[0].delay, 60_000);
    assert.equal(clock.unrefCalls, 1);
    assert.deepEqual(clock.cancelled, [clock.handle]);
    const completed = records.slice();
    clock.tick();
    assert.deepEqual(records, completed);
    assertClosedRecords(records, role);
    assert.equal(JSON.stringify(records).includes('synthetic-private-value'), false);
  });
}

test('a later repeated loop stall reports the currently awaited inner phase and cumulative busy count', async () => {
  const clock = fakeScheduler();
  const records = [];
  const entered = deferred();
  const release = deferred();
  const result = {};
  const running = observeWorkspaceInstallation('target', (value) => records.push(value), async ({ step, busy }) => {
    for (let iteration = 0; iteration < 3; iteration++) {
      await step('installationWait', async () => {
        busy();
        await step('targetProductResult', () => {
          if (iteration === 2) { entered.resolve(); return release.promise; }
          return undefined;
        });
      });
    }
    return result;
  }, clock);
  try {
    await entered.promise;
    assert.equal(records.filter((value) => value.phase === 'targetProductResult' && value.status === 'started').length, 1);
    assert.deepEqual(records.at(-1), record('target', 'installationWait', 'completed', 'first', 1));
    clock.tick();
    assert.deepEqual(records.at(-1), record('target', 'targetProductResult', 'started', 'heartbeat', 3));
    clock.tick();
    assert.deepEqual(records.at(-1), record('target', 'targetProductResult', 'started', 'heartbeat', 3));
  } finally {
    release.resolve();
    assert.equal(await running, result);
  }
  assert.deepEqual(records.at(-1), record('target', 'installation', 'completed', 'terminal', 3));
  assert.deepEqual(clock.cancelled, [clock.handle]);
  assertClosedRecords(records, 'target');
});

test('nested successful and failed steps restore the awaiting parent and then the installation', async () => {
  const clock = fakeScheduler();
  const records = [];
  const failure = Object.freeze({ privateError: 'synthetic-private-error' });
  await observeWorkspaceInstallation('source', (value) => records.push(value), async ({ step }) => {
    await step('installationWait', async () => {
      await step('sourceProductResult', async () => {
        await step('installedState', () => undefined);
        clock.tick();
        assert.deepEqual(records.at(-1), record('source', 'sourceProductResult', 'started', 'heartbeat'));
        await assert.rejects(step('payload', () => { throw failure; }), (error) => error === failure);
        assert.deepEqual(records.at(-1), record('source', 'payload', 'failed', 'first'));
        clock.tick();
        assert.deepEqual(records.at(-1), record('source', 'sourceProductResult', 'started', 'heartbeat'));
      });
      clock.tick();
      assert.deepEqual(records.at(-1), record('source', 'installationWait', 'started', 'heartbeat'));
    });
    clock.tick();
    assert.deepEqual(records.at(-1), record('source', 'installation', 'started', 'heartbeat'));
  }, clock);
  assert.deepEqual(records.at(-1), record('source', 'installation', 'completed', 'terminal'));
  assertClosedRecords(records, 'source');
  assert.equal(JSON.stringify(records).includes('synthetic-private-error'), false);
});

test('repeated boundaries emit only their first distinct status while heartbeats remain live', async () => {
  const clock = fakeScheduler();
  const records = [];
  const failure = {};
  await observeWorkspaceInstallation('target', (value) => records.push(value), async ({ step }) => {
    for (let iteration = 0; iteration < 500; iteration++) {
      await step('installedState', () => undefined);
      await assert.rejects(step('payload', () => { throw failure; }), (error) => error === failure);
      await step('payload', () => undefined);
    }
    assert.equal(records.length, 6);
    clock.tick();
    assert.deepEqual(records.at(-1), record('target', 'installation', 'started', 'heartbeat'));
  }, clock);
  const first = records.filter((value) => value.observation === 'first');
  assert.equal(new Set(first.map((value) => `${value.phase}:${value.status}`)).size, first.length);
  assert.equal(records.length, 8);
  assertClosedRecords(records, 'target');
});

test('busy count saturates without emitting a record per increment or resetting between phases', async () => {
  const clock = fakeScheduler();
  const records = [];
  await observeWorkspaceInstallation('source', (value) => records.push(value), async ({ step, busy }) => {
    for (let count = 0; count < 999_999; count++) busy();
    assert.equal(records.length, 1);
    clock.tick();
    assert.equal(records.at(-1).busyCount, 999_999);
    busy();
    clock.tick();
    assert.equal(records.at(-1).busyCount, 1_000_000);
    busy();
    await step('nextObservation', () => { clock.tick(); });
    assert.equal(records.at(-1).busyCount, 1_000_000);
  }, clock);
  assert.equal(records.at(-1).busyCount, 1_000_000);
  assertClosedRecords(records, 'source');
});

for (const fails of [false, true]) {
  test(`the 128th record is the final truncation marker even when the task ${fails ? 'rejects' : 'completes'}`, async () => {
    const clock = fakeScheduler();
    const records = [];
    const outcome = Object.freeze({ privateValue: 'synthetic-private-outcome' });
    const running = observeWorkspaceInstallation('target', (value) => records.push(value), async ({ step, busy }) => {
      for (let tick = 0; tick < 126; tick++) clock.tick();
      assert.equal(records.length, 127);
      assert.equal(records.at(-1).observation, 'heartbeat');
      clock.tick();
      assert.deepEqual(records.at(-1), record('target', 'installation', 'started', 'truncated'));
      busy();
      await step('artifactFixture', () => undefined);
      for (let tick = 0; tick < 200; tick++) clock.tick();
      if (fails) throw outcome;
      return outcome;
    }, clock);
    if (fails) await assert.rejects(running, (error) => error === outcome);
    else assert.equal(await running, outcome);
    clock.tick();
    assert.equal(records.length, 128);
    assert.equal(records.filter((value) => value.observation === 'truncated').length, 1);
    assert.equal(records.at(-1).observation, 'truncated');
    assert.deepEqual(clock.cancelled, [clock.handle]);
    assertClosedRecords(records, 'target');
  });
}

for (const failureMode of ['synchronous', 'asynchronous']) {
  test(`${failureMode} rejection preserves opaque identity without reading private error fields`, async () => {
    const clock = fakeScheduler();
    const records = [];
    let privateReads = 0;
    const failure = Object.freeze(Object.fromEntries(['message', 'stack', 'path', 'toJSON'].map((key) => [key, undefined])));
    const opaque = new Proxy(failure, {
      get(target, key) {
        if (Object.hasOwn(target, key)) { privateReads++; throw new Error('synthetic-private-error-access'); }
        return Reflect.get(target, key);
      },
    });
    await assert.rejects(observeWorkspaceInstallation('source', (value) => records.push(value), () => {
      if (failureMode === 'synchronous') throw opaque;
      return Promise.reject(opaque);
    }, clock), (error) => error === opaque);
    assert.equal(privateReads, 0);
    assert.deepEqual(records.at(-1), record('source', 'installation', 'failed', 'terminal'));
    assert.deepEqual(clock.cancelled, [clock.handle]);
    const completed = records.slice();
    clock.tick();
    assert.deepEqual(records, completed);
    assertClosedRecords(records, 'source');
  });
}

test('invalid boundaries are not emitted or coerced and their tasks still return or reject unchanged', async () => {
  const clock = fakeScheduler();
  const records = [];
  const failure = new Error('synthetic-private-error /synthetic-private/profile');
  let coercions = 0;
  const invalid = [undefined, null, 1, Symbol('private-boundary'), 'installation\nprivate-value',
    'unknown', '/synthetic-private/profile', { toString() { coercions++; throw failure; } }];
  let calls = 0;
  const result = {};
  await observeWorkspaceInstallation('target', (value) => records.push(value), async ({ step }) => {
    await step('installationWait', async () => {
      for (const boundary of invalid) {
        const before = records.length;
        assert.equal(await step(boundary, () => { calls++; return result; }), result);
        await assert.rejects(step(boundary, () => { calls++; throw failure; }), (error) => error === failure);
        assert.equal(records.length, before);
        await step(boundary, () => { clock.tick(); });
        assert.deepEqual(records.at(-1), record('target', 'installationWait', 'started', 'heartbeat'));
      }
    });
  }, clock);
  assert.equal(calls, invalid.length * 2);
  assert.equal(coercions, 0);
  assertClosedRecords(records, 'target');
  assert.equal(JSON.stringify(records).includes('private'), false);
});

test('invalid roles and missing reporters disable diagnostics without disabling step tasks', async () => {
  const records = [];
  const cases = [
    ...[undefined, null, '', 'Source', 'other', {}].map((role) => [role, (value) => records.push(value)]),
    ...[undefined, null, false, {}].map((report) => ['source', report]),
  ];
  const result = {};
  const failure = {};
  for (const [role, report] of cases) {
    const clock = fakeScheduler();
    let calls = 0;
    assert.equal(await observeWorkspaceInstallation(role, report, async ({ step, busy }) => {
      busy();
      return step('payload', () => { calls++; return result; });
    }, clock), result);
    await assert.rejects(observeWorkspaceInstallation(role, report, ({ step }) =>
      step('payload', () => { calls++; throw failure; }), clock), (error) => error === failure);
    assert.equal(calls, 2);
    assert.deepEqual(clock.scheduled, []);
    assert.deepEqual(clock.cancelled, []);
    assert.equal(clock.unrefCalls, 0);
  }
  assert.deepEqual(records, []);
});

for (const broken of ['schedule', 'cancel', 'report', 'unref']) {
  for (const fails of [false, true]) {
    test(`${broken} synchronous failure cannot replace a task ${fails ? 'rejection' : 'result'}`, async () => {
      const clock = fakeScheduler();
      const records = [];
      const diagnosticFailure = new Error('synthetic-private-diagnostic /synthetic-private/profile');
      const outcome = {};
      let injectedFailures = 0;
      function fail() { injectedFailures++; throw diagnosticFailure; }
      const options = {
        schedule: broken === 'schedule' ? fail : clock.schedule,
        cancel(timer) { clock.cancel(timer); if (broken === 'cancel') fail(); },
      };
      if (broken === 'unref') clock.handle.unref = fail;
      let calls = 0;
      const running = observeWorkspaceInstallation('target', (value) => {
        records.push(value);
        if (broken === 'report') fail();
      }, async ({ step }) => {
        calls++;
        await step('installedState', () => { clock.tick(); });
        if (fails) throw outcome;
        return outcome;
      }, options);
      if (fails) await assert.rejects(running, (error) => error === outcome);
      else assert.equal(await running, outcome);
      assert.equal(calls, 1);
      assert.ok(injectedFailures > 0);
      assert.deepEqual(records.at(-1), record('target', 'installation', fails ? 'failed' : 'completed', 'terminal'));
      assert.deepEqual(clock.cancelled, broken === 'schedule' ? [] : [clock.handle]);
      const completed = records.slice();
      clock.tick();
      assert.deepEqual(records, completed);
      assertClosedRecords(records, 'target');
      assert.equal(JSON.stringify(records).includes('private'), false);
    });
  }
}

test('a throwing reporter still has at most 128 delivery attempts and a final truncation marker', async () => {
  const clock = fakeScheduler();
  const records = [];
  const diagnosticFailure = new Error('synthetic-private-diagnostic');
  const result = {};
  assert.equal(await observeWorkspaceInstallation('source', (value) => {
    records.push(value);
    throw diagnosticFailure;
  }, () => {
    for (let tick = 0; tick < 300; tick++) clock.tick();
    return result;
  }, clock), result);
  clock.tick();
  assert.equal(records.length, 128);
  assert.equal(records.at(-1).observation, 'truncated');
  assert.deepEqual(clock.cancelled, [clock.handle]);
  assertClosedRecords(records, 'source');
});

test('both canonical workspace node test chains select this contract test exactly once', async () => {
  const maximumBytes = 64 * 1024;
  const file = await open(new URL('../../package.json', import.meta.url), 'r');
  let desktop;
  try {
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assert.ok(length > 0 && length <= maximumBytes, 'Desktop package JSON must fit the bounded read');
    desktop = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { await file.close(); }
  const testPath = 'installer/windows-acceptance-harness/workspaceInstallationObservation.test.mjs';
  for (const name of ['installer:test:windows-acceptance-workspace-fault', 'installer:test:windows-acceptance-workspace']) {
    const script = desktop.scripts[name];
    assert.equal(typeof script, 'string', name);
    const chains = script.split(' && ').map((command) => command.split(' '));
    const nodeTests = chains.filter(([command, flag]) => command === 'node' && flag === '--test');
    assert.equal(nodeTests.length, 1, name);
    assert.equal(nodeTests[0].filter((argument) => argument === testPath).length, 1, name);
    assert.equal(chains.flat().filter((argument) => argument === testPath).length, 1, name);
  }
});
