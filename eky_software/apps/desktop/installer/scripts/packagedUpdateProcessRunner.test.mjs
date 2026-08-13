import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import { createPackagedUpdateProcessRunner } from './packagedUpdateProcessRunner.mjs';

function createHarness() {
  const timers = [];
  const children = [];
  const runner = createPackagedUpdateProcessRunner({
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    setTimeoutFn(callback) {
      const timer = { callback, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    spawnProcess() {
      const child = new EventEmitter();
      child.pid = 123;
      child.stdout = new PassThrough();
      children.push(child);
      return child;
    },
  });
  return { children, runner, timers };
}

describe('packaged update bounded process runner', () => {
  it('settles once when exit wins the timeout race', async () => {
    const harness = createHarness();
    let terminationCount = 0;
    const result = harness.runner.run('safe.exe', [], {
      terminateProcess: async () => {
        terminationCount += 1;
        return 'terminated';
      },
      timeoutMs: 100,
    });
    harness.children[0].emit('exit', 0, null);
    harness.timers[0].callback();
    assert.deepEqual(await result, { code: 0, signal: null });
    assert.equal(terminationCount, 0);
  });

  it('claims timeout before asynchronous process-tree termination', async () => {
    const harness = createHarness();
    let releaseTermination;
    const result = harness.runner.run('safe.exe', [], {
      terminateProcess: () =>
        new Promise((resolvePromise) => {
          releaseTermination = resolvePromise;
        }),
      timeoutMs: 100,
    });
    harness.timers[0].callback();
    harness.children[0].emit('exit', 0, null);
    releaseTermination('terminated');
    await assert.rejects(result, (error) => {
      assert.equal(error.message, 'PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT');
      assert.equal(error.terminationOutcome, 'terminated');
      return true;
    });
  });

  it('preserves the timeout when termination reports a remaining tree', async () => {
    const harness = createHarness();
    const result = harness.runner.run('safe.exe', [], {
      terminateProcess: async () => 'remains',
      timeoutMs: 100,
    });
    harness.timers[0].callback();
    await assert.rejects(result, (error) => {
      assert.equal(error.message, 'PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT');
      assert.equal(error.terminationOutcome, 'remains');
      return true;
    });
  });

  it('bounds captured output and terminates the scoped process', async () => {
    const harness = createHarness();
    const result = harness.runner.capture('safe.exe', [], {
      maxOutputBytes: 4,
      terminateProcess: async () => 'terminated',
      timeoutMs: 100,
    });
    harness.children[0].stdout.write('12345');
    await assert.rejects(result, (error) => {
      assert.equal(
        error.message,
        'PACKAGED_UPDATE_E2E_PROCESS_OUTPUT_LIMIT',
      );
      assert.equal(error.terminationOutcome, 'terminated');
      return true;
    });
  });

  it('returns bounded UTF-8 output only after a clean exit', async () => {
    const harness = createHarness();
    const result = harness.runner.capture('safe.exe', [], {
      maxOutputBytes: 16,
      terminateProcess: async () => 'notRequired',
      timeoutMs: 100,
    });
    harness.children[0].stdout.write('ok');
    harness.children[0].emit('exit', 0, null);
    assert.equal(await result, 'ok');
  });

  it('does not allow an error event to settle an exited process twice', async () => {
    const harness = createHarness();
    const result = harness.runner.run('safe.exe', [], {
      terminateProcess: async () => 'failed',
      timeoutMs: 100,
    });
    harness.children[0].emit('exit', 0, null);
    harness.children[0].emit('error', new Error('private path'));
    assert.deepEqual(await result, { code: 0, signal: null });
  });

  it('reports a child start error without leaking the original error', async () => {
    const harness = createHarness();
    const result = harness.runner.run('safe.exe', [], {
      terminateProcess: async () => 'notRequired',
      timeoutMs: 100,
    });
    harness.children[0].emit('error', new Error('C:\\private\\tool.exe'));
    await assert.rejects(
      result,
      (error) =>
        error.message === 'PACKAGED_UPDATE_E2E_PROCESS_START_FAILED' &&
        !error.message.includes('private'),
    );
  });

  it('preserves the output-limit error when termination itself fails', async () => {
    const harness = createHarness();
    const result = harness.runner.capture('safe.exe', [], {
      maxOutputBytes: 4,
      terminateProcess: async () => {
        throw new Error('C:\\private\\termination');
      },
      timeoutMs: 100,
    });
    harness.children[0].stdout.write('12345');
    await assert.rejects(result, (error) => {
      assert.equal(error.message, 'PACKAGED_UPDATE_E2E_PROCESS_OUTPUT_LIMIT');
      assert.equal(error.terminationOutcome, 'failed');
      return true;
    });
  });

  it('keeps a nonzero captured process exit as a failure', async () => {
    const harness = createHarness();
    const result = harness.runner.capture('safe.exe', [], {
      maxOutputBytes: 16,
      terminateProcess: async () => 'notRequired',
      timeoutMs: 100,
    });
    harness.children[0].stdout.write('private output');
    harness.children[0].emit('exit', 1, null);
    await assert.rejects(
      result,
      /PACKAGED_UPDATE_E2E_PROCESS_FAILED/,
    );
  });
});
