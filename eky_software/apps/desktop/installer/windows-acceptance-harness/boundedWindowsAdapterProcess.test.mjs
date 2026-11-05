import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  runBoundedWindowsAdapterProcess,
  captureBoundedWindowsAdapterProcessResult,
} from './boundedWindowsAdapterProcess.mjs';

test('bounded process result capture preserves uncertainty independently from Job-tree evidence', () => {
  const value = { status: 'failed', resultCode: 'terminationUnconfirmed', exitCode: null, directProcessAbsent: false };
  const captured = captureBoundedWindowsAdapterProcessResult(value);
  assert.deepEqual(captured, value); assert.equal(Object.isFrozen(captured), true);
  value.directProcessAbsent = true; assert.equal(captured.directProcessAbsent, false);
});

test('bounded process result capture rejects unsafe metadata without invoking getters', () => {
  const value = { status: 'failed', resultCode: 'terminationUnconfirmed', exitCode: null, directProcessAbsent: false };
  for (const changed of [{ ...value, resultCode: 'raw external error' }, { ...value, status: 'unknown' },
    { ...value, exitCode: Number.NaN }, { ...value, directProcessAbsent: 'false' }, { ...value, extra: true }]) {
    assert.throws(() => captureBoundedWindowsAdapterProcessResult(changed));
  }
  Object.defineProperty(value, 'resultCode', { get() { assert.fail('result getter must not execute'); } });
  assert.throws(() => captureBoundedWindowsAdapterProcessResult(value));
});

test('bounded process result capture preserves a real Windows unsigned failure exit', {
  skip: process.platform !== 'win32', timeout: 5_000,
}, async () => {
  const result = await runBoundedWindowsAdapterProcess({ command: process.execPath,
    arguments: ['-e', 'process.exit(0xC0000005)'], cwd: process.cwd(),
    timeoutMilliseconds: 1_000, terminationTimeoutMilliseconds: 1_000 });
  assert.equal(result.exitCode, 0xC0000005); assert.equal(result.directProcessAbsent, true);
  assert.deepEqual(captureBoundedWindowsAdapterProcessResult(result), result);
});

test('bounded process result capture retains all Windows exit bits and rejects overflow', () => {
  const base = { status: 'completed', resultCode: 'processCompleted', directProcessAbsent: true };
  for (const exitCode of [-2_147_483_648, -4058, 0, 2_147_483_648, 0xC0000005, 0xFFFFFFFF]) {
    assert.equal(captureBoundedWindowsAdapterProcessResult({ ...base, exitCode }).exitCode, exitCode);
  }
  for (const exitCode of [-2_147_483_649, 0x100000000]) {
    assert.throws(() => captureBoundedWindowsAdapterProcessResult({ ...base, exitCode }));
  }
});

class FakeChild extends EventEmitter {
  constructor({ closeOnKill = true } = {}) {
    super();
    this.closeOnKill = closeOnKill;
    this.killCount = 0;
    this.pid = 1234;
  }

  kill() {
    this.killCount += 1;
    if (this.closeOnKill) {
      queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    }
    return true;
  }
}

function runWithChild(child, overrides = {}) {
  return runBoundedWindowsAdapterProcess({
    command: 'fixture.exe',
    arguments: ['--fixture'],
    cwd: 'C:\\fixture',
    timeoutMilliseconds: 100,
    terminationTimeoutMilliseconds: 100,
    spawnProcess() {
      return child;
    },
    ...overrides,
  });
}

test('bounded adapter reports normal direct-child exit', async () => {
  const child = new FakeChild();
  const events = [];
  const completion = runWithChild(child, { observe: (phase, status) => events.push([phase, status]) });
  child.emit('spawn');
  child.emit('close', 0, null);

  assert.deepEqual(await completion, {
    status: 'completed',
    resultCode: 'processCompleted',
    exitCode: 0,
    directProcessAbsent: true,
  });
  assert.equal(child.killCount, 0);
  assert.deepEqual(events, [['launch', 'started'], ['launch', 'completed'],
    ['deadline', 'started'], ['spawn', 'completed']]);
});

test('bounded adapter terminates only its direct child at deadline', async () => {
  const child = new FakeChild();
  const result = await runWithChild(child, {
    timeoutMilliseconds: 5,
    terminationTimeoutMilliseconds: 100,
  });

  assert.deepEqual(result, {
    status: 'failed',
    resultCode: 'timedOut',
    exitCode: null,
    directProcessAbsent: true,
  });
  assert.equal(child.killCount, 1);
});

test('bounded adapter keeps unconfirmed direct-child cleanup visible', async () => {
  const child = new FakeChild({ closeOnKill: false });
  const events = [];
  const result = await runWithChild(child, {
    timeoutMilliseconds: 5,
    terminationTimeoutMilliseconds: 5,
    observe(phase, status) { events.push([phase, status]); throw new Error('synthetic observation failure'); },
  });

  assert.deepEqual(result, {
    status: 'failed',
    resultCode: 'terminationUnconfirmed',
    exitCode: null,
    directProcessAbsent: false,
  });
  assert.equal(child.killCount, 1);
  assert.deepEqual(events, [['launch', 'started'], ['launch', 'completed'], ['deadline', 'started'],
    ['deadline', 'failed'], ['termination', 'started'], ['termination', 'completed']]);
});

test('bounded adapter rejects malformed requests before spawn', async () => {
  assert.throws(
    () =>
      runBoundedWindowsAdapterProcess({
        command: 'fixture.exe',
        arguments: ['bad\0argument'],
        cwd: 'C:\\fixture',
        timeoutMilliseconds: 100,
        terminationTimeoutMilliseconds: 100,
      }),
    /WINDOWS_ACCEPTANCE_ADAPTER_REQUEST_INVALID/,
  );
});

test('a kill error cannot claim that the started process is absent', async () => {
  const child = new FakeChild({ closeOnKill: false });
  child.kill = () => {
    child.killCount += 1;
    child.emit('error', new Error('synthetic signal failure'));
    return false;
  };
  const result = await runWithChild(child, { timeoutMilliseconds: 5 });
  assert.deepEqual(result, {
    status: 'failed', resultCode: 'terminationFailed', exitCode: null, directProcessAbsent: false,
  });
  assert.equal(child.killCount, 1);
  child.emit('close', 0, null);
  assert.equal(result.directProcessAbsent, false);
});

test('a started process error keeps failure even after exact termination succeeds', async () => {
  const child = new FakeChild();
  const completion = runWithChild(child);
  child.emit('spawn');
  child.emit('error', new Error('synthetic process failure'));
  const result = await completion;
  assert.deepEqual(result, {
    status: 'failed', resultCode: 'processError', exitCode: null, directProcessAbsent: true,
  });
  assert.equal(child.killCount, 1);
});

test('repeated errors during unsuccessful termination retain unverified cleanup', async () => {
  const child = new FakeChild({ closeOnKill: false });
  child.kill = () => {
    child.killCount += 1;
    child.emit('error', new Error('synthetic kill failure'));
    return true;
  };
  const completion = runWithChild(child, { terminationTimeoutMilliseconds: 5 });
  child.emit('spawn');
  child.emit('error', new Error('synthetic process failure'));
  const result = await completion;
  assert.equal(result.status, 'failed');
  assert.equal(result.resultCode, 'terminationUnconfirmed');
  assert.equal(result.directProcessAbsent, false);
  assert.equal(child.killCount, 1);
});

test('an actual spawn rejection proves no direct process was created', async () => {
  const child = new FakeChild();
  child.pid = undefined;
  const completion = runWithChild(child);
  child.emit('error', new Error('synthetic spawn failure'));
  child.emit('close', -1, null);
  assert.deepEqual(await completion, {
    status: 'failed', resultCode: 'startFailed', exitCode: null, directProcessAbsent: true,
  });
  assert.equal(child.killCount, 0);
});

test('time spent in process creation is charged before the wait begins', async () => {
  const child = new FakeChild();
  let clock = 0;
  const events = [];
  const completion = runWithChild(child, {
    now: () => clock,
    timeoutMilliseconds: 100,
    observe: (phase, status) => events.push([phase, status]),
    spawnProcess() {
      assert.deepEqual(events, [['launch', 'started']]);
      clock = 101;
      return child;
    },
  });
  assert.equal(child.killCount, 1);
  assert.equal((await completion).resultCode, 'timedOut');
  assert.deepEqual(events, [['launch', 'started'], ['launch', 'completed'],
    ['deadline', 'failed'], ['termination', 'started'], ['termination', 'completed']]);
});

test('cancellation before start creates no process', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runWithChild(null, {
    signal: controller.signal,
    spawnProcess() { assert.fail('No process may be created'); },
  });
  assert.equal(result.resultCode, 'cancelled');
  assert.equal(result.directProcessAbsent, true);
});

test('cancellation uses the existing exact child termination once', async () => {
  const controller = new AbortController();
  const child = new FakeChild();
  const completion = runWithChild(child, { signal: controller.signal });
  controller.abort();
  controller.abort();
  const result = await completion;
  assert.equal(result.resultCode, 'cancelled');
  assert.equal(result.directProcessAbsent, true);
  assert.equal(child.killCount, 1);
});

test('cancellation does not turn unconfirmed cleanup into success', async () => {
  const controller = new AbortController();
  const child = new FakeChild({ closeOnKill: false });
  const completion = runWithChild(child, { signal: controller.signal, terminationTimeoutMilliseconds: 5 });
  controller.abort();
  const result = await completion;
  assert.equal(result.resultCode, 'terminationUnconfirmed');
  assert.equal(result.directProcessAbsent, false);
  child.emit('close', 0, null);
  assert.equal(result.directProcessAbsent, false);
  assert.equal(child.killCount, 1);
});

test('cancellation during creation is handled before waiting', async () => {
  const controller = new AbortController();
  const child = new FakeChild();
  const completion = runWithChild(child, {
    signal: controller.signal,
    spawnProcess() { controller.abort(); return child; },
  });
  assert.equal((await completion).resultCode, 'cancelled');
  assert.equal(child.killCount, 1);
});
