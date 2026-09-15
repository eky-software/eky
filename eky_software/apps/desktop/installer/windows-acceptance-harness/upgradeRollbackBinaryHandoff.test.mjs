import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { coordinateUpgradeRollbackBinaryHandoff } from './upgradeRollbackBinaryHandoff.mjs';

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

test('launcher fixture stays alive until its exact release message', {
  timeout: 5_000,
}, async () => {
  const child = spawn(process.execPath, [LAUNCHER_FIXTURE_PATH], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
  await once(child, 'spawn');
  assert.equal(child.exitCode, null);
  child.stdin.end('release\n');
  const [exitCode, signal] = await once(child, 'close');
  assert.equal(exitCode, 0);
  assert.equal(signal, null);
});
