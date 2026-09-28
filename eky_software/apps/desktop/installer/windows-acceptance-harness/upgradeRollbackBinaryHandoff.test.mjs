import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { coordinateUpgradeRollbackBinaryHandoff } from './upgradeRollbackBinaryHandoff.mjs';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';

const LAUNCHER_FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'upgradeRollbackLauncherFixture.mjs',
);

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function createFixture() {
  const events = [];
  const launcherCompletion = deferred();
  const progressCompletion = deferred();
  const rollbackCompletion = deferred();
  let closeCount = 0;
  return {
    closeCount: () => closeCount,
    events,
    launcherCompletion,
    progressCompletion,
    rollbackCompletion,
    run: () =>
      coordinateUpgradeRollbackBinaryHandoff({
        createProgressWaiter() {
          events.push('progressWaiterCreated');
          return {
            close() {
              closeCount += 1;
            },
            completion: progressCompletion.promise,
          };
        },
        async startLauncher() {
          events.push('launcherStarted');
          return {
            completion: launcherCompletion.promise,
            processId: 101,
            async release() {
              events.push('launcherReleased');
              launcherCompletion.resolve({ exitCode: 0, processId: 101 });
            },
          };
        },
        async startRollback(processId) {
          events.push(`rollbackStarted:${processId}`);
          return { completion: rollbackCompletion.promise };
        },
      }),
  };
}

test('binary rollback releases a live launcher only after launcher wait evidence', async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.events, [
    'launcherStarted',
    'progressWaiterCreated',
    'rollbackStarted:101',
  ]);

  fixture.progressCompletion.resolve();
  await Promise.resolve();
  fixture.rollbackCompletion.resolve({ exitCode: 0, processId: 202 });

  assert.equal(await completion, 0);
  assert.equal(fixture.events.at(-1), 'launcherReleased');
  assert.equal(fixture.closeCount(), 1);
});

test('binary rollback preserves an early production input failure', async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  await Promise.resolve();
  await Promise.resolve();
  fixture.rollbackCompletion.resolve({ exitCode: 25, processId: 202 });

  await assert.rejects(completion, /binaryRollbackTargetPackagePathInvalid/);
  assert.equal(fixture.events.at(-1), 'launcherReleased');
  assert.equal(fixture.closeCount(), 1);
});

test('binary rollback rejects a launcher that exits before the handoff', async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  await Promise.resolve();
  await Promise.resolve();
  fixture.launcherCompletion.resolve({ exitCode: 0, processId: 101 });
  fixture.rollbackCompletion.resolve({ exitCode: 0, processId: 202 });

  await assert.rejects(completion, /binaryRollbackLauncherExitedEarly/);
  assert.equal(fixture.closeCount(), 1);
});

test('binary rollback closes ownership when progress validation fails', async () => {
  const fixture = createFixture();
  const completion = fixture.run();
  await Promise.resolve();
  await Promise.resolve();
  fixture.progressCompletion.reject(new Error('invalid'));
  fixture.rollbackCompletion.resolve({ exitCode: 27, processId: 202 });

  await assert.rejects(completion, /binaryRollbackProgressInvalid/);
  assert.equal(fixture.events.at(-1), 'launcherReleased');
  assert.equal(fixture.closeCount(), 1);
});

test('binary rollback rejects an invalid progress waiter and releases the launcher', async () => {
  const launcherCompletion = deferred();
  let releaseCount = 0;
  await assert.rejects(
    coordinateUpgradeRollbackBinaryHandoff({
      createProgressWaiter: () => ({}),
      async startLauncher() {
        return {
          completion: launcherCompletion.promise,
          processId: 101,
          async release() {
            releaseCount += 1;
            launcherCompletion.resolve({ exitCode: 0, processId: 101 });
          },
        };
      },
      async startRollback() {
        throw new Error('must not start');
      },
    }),
    /binaryRollbackProgressInvalid/,
  );
  assert.equal(releaseCount, 1);
});

const LAUNCHER_TEST_TIMEOUT = 5_000;
const LAUNCHER_CLEANUP_RESERVE = 1_000;

test('launcher fixture stays alive until its exact release message', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  try {
    await fixture.ready;
    assert.equal(fixture.child.exitCode, null);
    await fixture.release('release\n');
    assert.deepEqual(await fixture.completion, {
      status: 'completed', resultCode: 'processCompleted', exitCode: 0, directProcessAbsent: true,
    });
  } finally {
    await fixture.stop();
  }
});

test('launcher fixture closes after an assertion without replacing the original error', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  const original = new assert.AssertionError({ message: 'synthetic handoff assertion' });
  await assert.rejects(async () => {
    try {
      await fixture.ready;
      throw original;
    } finally {
      await fixture.stop();
    }
  }, error => error === original);
  const result = await fixture.completion;
  assert.equal(result.resultCode, 'cancelled');
  assert.equal(result.directProcessAbsent, true);
});

test('launcher fixture timeout waits for actual close within the original test budget', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  try {
    await fixture.ready;
    const result = await fixture.completion;
    assert.equal(result.status, 'failed');
    assert.equal(result.resultCode, 'timedOut');
    assert.equal(result.directProcessAbsent, true);
  } finally {
    await fixture.stop();
  }
});

test('launcher fixture abort closes its exact child', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  try {
    await fixture.ready;
    const result = await fixture.stop();
    assert.equal(result.status, 'failed');
    assert.equal(result.resultCode, 'cancelled');
    assert.equal(result.directProcessAbsent, true);
  } finally {
    await fixture.stop();
  }
});

test('launcher fixture rejects an inexact release and still observes close', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  try {
    await fixture.ready;
    await fixture.release('invalid\n');
    assert.deepEqual(await fixture.completion, {
      status: 'completed', resultCode: 'processCompleted', exitCode: 65, directProcessAbsent: true,
    });
  } finally {
    await fixture.stop();
  }
});

test('launcher fixture preserves a failed release write and still closes', {
  timeout: LAUNCHER_TEST_TIMEOUT,
}, async (context) => {
  const fixture = startLauncherTestProcess(context);
  let releaseError;
  await assert.rejects(async () => {
    try {
      await fixture.ready;
      fixture.child.stdin.destroy();
      try { await fixture.release('release\n'); }
      catch (error) { releaseError = error; throw error; }
    } finally {
      await fixture.stop();
    }
  }, error => error === releaseError && error?.code === 'ERR_STREAM_DESTROYED');
  assert.equal((await fixture.completion).directProcessAbsent, true);
});

// This fixture is childless. Reuse the existing direct-process boundary;
// do not give this isolated contract test another process-tree supervisor.
function startLauncherTestProcess(context) {
  const controller = new AbortController();
  const events = [];
  let child;
  let ready;
  let streamError;
  const completion = runBoundedWindowsAdapterProcess({
    command: process.execPath,
    arguments: [LAUNCHER_FIXTURE_PATH],
    cwd: dirname(LAUNCHER_FIXTURE_PATH),
    signal: AbortSignal.any([controller.signal, context.signal]),
    timeoutMilliseconds: LAUNCHER_TEST_TIMEOUT - LAUNCHER_CLEANUP_RESERVE,
    terminationTimeoutMilliseconds: LAUNCHER_CLEANUP_RESERVE,
    spawnProcess(command, arguments_, options) {
      child = spawn(command, arguments_, { ...options, stdio: ['pipe', 'ignore', 'ignore'] });
      ready = once(child, 'spawn');
      void ready.catch(() => {});
      child.stdin.on('error', error => { streamError ??= error; });
      child.once('exit', () => events.push('exit'));
      child.once('close', () => events.push('close'));
      return child;
    },
  });
  const stop = async () => { controller.abort(); return completion; };
  // The hook also runs when the test framework aborts before the body finishes.
  // Its cleanup assertion is separate from the body's original failure.
  context.after(async () => {
    const result = await stop();
    assert.equal(result.directProcessAbsent, true, 'launcher cleanup unverified');
    assert.deepEqual(events, ['exit', 'close']);
    if (streamError) assert.equal(streamError.code, 'ERR_STREAM_DESTROYED');
  });
  return {
    child, ready, completion, stop,
    release(message) {
      return new Promise((resolveRelease, rejectRelease) => {
        child.stdin.end(message, error => error ? rejectRelease(error) : resolveRelease());
      });
    },
  };
}
