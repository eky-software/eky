import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  runBoundedWindowsAdapterProcess,
} from './boundedWindowsAdapterProcess.mjs';

class FakeChild extends EventEmitter {
  constructor({ closeOnKill = true } = {}) {
    super();
    this.closeOnKill = closeOnKill;
    this.killCount = 0;
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
  const completion = runWithChild(child);
  child.emit('close', 0, null);

  assert.deepEqual(await completion, {
    status: 'completed',
    resultCode: 'processCompleted',
    exitCode: 0,
    directProcessAbsent: true,
  });
  assert.equal(child.killCount, 0);
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
  const result = await runWithChild(child, {
    timeoutMilliseconds: 5,
    terminationTimeoutMilliseconds: 5,
  });

  assert.deepEqual(result, {
    status: 'failed',
    resultCode: 'terminationUnconfirmed',
    exitCode: null,
    directProcessAbsent: false,
  });
  assert.equal(child.killCount, 1);
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
