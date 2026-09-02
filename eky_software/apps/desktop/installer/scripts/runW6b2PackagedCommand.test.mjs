import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  parseW6b2PackagedCommandArguments,
  runW6b2PackagedCommand,
  terminalizeFailedOwnedProcessHandle,
  W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B2_PACKAGED_COMMAND_HEARTBEAT_MILLISECONDS,
} from './runW6b2PackagedCommand.mjs';

const proofToken = 'a'.repeat(64);

test('selects bounded one-run and full command budgets', () => {
  assert.deepEqual(
    parseW6b2PackagedCommandArguments([
      '--kind=success',
      '--',
      '--run=1',
    ]),
    {
      commandKind: 'success',
      scenarioArguments: ['--run=1'],
      timeoutMilliseconds: 25 * 60 * 1000,
    },
  );
  assert.deepEqual(
    parseW6b2PackagedCommandArguments(['--kind=success']),
    {
      commandKind: 'success',
      scenarioArguments: [],
      timeoutMilliseconds: 38 * 60 * 1000,
    },
  );
  assert.equal(
    parseW6b2PackagedCommandArguments([
      '--kind=faultRollback',
      '--scenario=acceptanceInterruption',
      '--run=2',
    ]).timeoutMilliseconds,
    25 * 60 * 1000,
  );
  assert.equal(
    parseW6b2PackagedCommandArguments(['--kind=faultRollback'])
      .timeoutMilliseconds,
    135 * 60 * 1000,
  );
  assert.equal(
    W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT_MILLISECONDS,
    30_000,
  );
  assert.equal(W6B2_PACKAGED_COMMAND_HEARTBEAT_MILLISECONDS, 60_000);
});

test('preserves normal worker exit and proves exact cleanup', async () => {
  const harness = createHarness();
  const run = startCommand(harness);

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(harness.cleanupInputs.length, 1);
  assert.equal(harness.cleanupInputs[0].commandKind, 'success');
  assert.equal(harness.cleanupInputs[0].proofToken, proofToken);
  assert.match(
    harness.spawnArguments[0][1][2],
    /^--process-proof-token=[0-9a-f]{64}$/u,
  );
  assert.deepEqual(lastEvent(harness.events), {
    commandKind: 'success',
    durationMs: 0,
    elapsedMs: 0,
    operation: 'w6b2PackagedCommandProcess',
    phase: 'command',
    status: 'completed',
  });
});

test('turns the absolute deadline into cleanup and a safe timeout', async () => {
  const harness = createHarness();
  const run = startCommand(harness);

  harness.fireHeartbeat();
  harness.fireDeadline();

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT/u,
  );
  assert.equal(harness.cleanupInputs.length, 1);
  assert.equal(
    harness.events.some(
      ({ phase, status }) =>
        phase === 'waitHeartbeat' && status === 'heartbeat',
    ),
    true,
  );
  assert.equal(
    harness.events.some(
      ({ errorCode, phase }) =>
        phase === 'waitTimedOut' &&
        errorCode === 'W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT',
    ),
    true,
  );
});

test('preserves non-zero worker exit after cleanup', async () => {
  const harness = createHarness();
  const run = startCommand(harness);

  harness.child.emit('exit', 19, null);

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_PROCESS_EXIT_FAILED/u,
  );
  assert.equal(harness.cleanupInputs.length, 1);
});

test('keeps process timeout primary when the owned process tree remains', async () => {
  const harness = createHarness({ cleanupResult: { status: 'remains' } });
  const run = startCommand(harness);

  harness.fireDeadline();

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT/u,
  );
  assert.equal(
    harness.events.some(
      ({ errorCode, phase }) =>
        phase === 'cleanupCompleted' &&
        errorCode === 'W6B2_PACKAGED_COMMAND_CLEANUP_FAILED',
    ),
    true,
  );
});

test('keeps process timeout primary when cleanup also times out', async () => {
  const harness = createHarness({
    cleanupError: new Error('W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT'),
  });
  const run = startCommand(harness);

  harness.fireDeadline();

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT/u,
  );
  assert.equal(harness.childKillCount(), 1);
  assert.equal(harness.childUnrefCount(), 1);
});

test('cleanup failure terminalizes only the direct owned child handle', () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let killCount = 0;
  let unrefCount = 0;
  child.kill = () => {
    killCount += 1;
    return true;
  };
  child.unref = () => {
    unrefCount += 1;
  };

  terminalizeFailedOwnedProcessHandle(child);
  assert.equal(killCount, 1);
  assert.equal(unrefCount, 1);
  assert.doesNotThrow(() => child.emit('error', new Error('late failure')));
});

test('completed child handle is unreferenced without a second kill', () => {
  const child = new EventEmitter();
  child.exitCode = 0;
  child.signalCode = null;
  let killCount = 0;
  let unrefCount = 0;
  child.kill = () => {
    killCount += 1;
    return true;
  };
  child.unref = () => {
    unrefCount += 1;
  };

  terminalizeFailedOwnedProcessHandle(child);
  assert.equal(killCount, 0);
  assert.equal(unrefCount, 1);
});

test('uses cleanup timeout when the worker itself completed', async () => {
  const harness = createHarness({
    cleanupError: new Error('W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT'),
  });
  const run = startCommand(harness);

  harness.child.emit('exit', 0, null);

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_CLEANUP_TIMEOUT/u,
  );
  assert.equal(
    harness.events.filter(
      ({ phase, status }) => phase === 'command' && status === 'failed',
    ).length,
    1,
  );
});

test('emits one command failure when worker exit and cleanup both fail', async () => {
  const harness = createHarness({
    cleanupError: new Error('W6B2_PACKAGED_COMMAND_CLEANUP_FAILED'),
  });
  const run = startCommand(harness);

  harness.child.emit('exit', 19, null);

  await assert.rejects(
    run,
    /W6B2_PACKAGED_COMMAND_PROCESS_EXIT_FAILED/u,
  );
  assert.deepEqual(
    harness.events
      .filter(({ phase, status }) => phase === 'command' && status === 'failed')
      .map(({ errorCode }) => errorCode),
    ['W6B2_PACKAGED_COMMAND_PROCESS_EXIT_FAILED'],
  );
});

test('rejects malformed command selectors and proof tokens', async () => {
  assert.throws(
    () => parseW6b2PackagedCommandArguments(['--kind=foreign']),
    /W6B2_PACKAGED_COMMAND_ARGUMENTS_INVALID/u,
  );
  const harness = createHarness({ proofToken: 'foreign' });
  await assert.rejects(
    startCommand(harness),
    /W6B2_PACKAGED_COMMAND_PROOF_TOKEN_INVALID/u,
  );
  assert.equal(harness.spawnArguments.length, 0);
});

test('safe events expose no command inputs or proof token', async () => {
  const harness = createHarness();
  const run = startCommand(harness);

  harness.child.emit('exit', 7, null);
  await assert.rejects(run);

  const output = JSON.stringify(harness.events);
  assert.doesNotMatch(
    output,
    /fixture|process-proof-token|powershell|stack|private|aaaaaaaa/iu,
  );
});

test('cleanup script validates exact worker ownership', async () => {
  const source = await readFile(
    new URL('./stopW6b2PackagedCommandProcess.ps1', import.meta.url),
    'utf8',
  );

  assert.match(source, /ValidateSet\('success', 'faultRollback'\)/u);
  assert.match(source, /w6b2PackagedCommandWorker\\\.mjs/u);
  assert.match(source, /--process-proof-token/u);
  assert.match(source, /Stop-EkyProcessTree -Process \$process/u);
  assert.match(source, /actualCreationToken -cne \$expectedCreationToken/u);
  assert.doesNotMatch(source, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(source, /taskkill\.exe/iu);
  const commandSource = await readFile(
    new URL('./runW6b2PackagedCommand.mjs', import.meta.url),
    'utf8',
  );
  assert.match(commandSource, /terminalizeFailedOwnedProcessHandle/u);
  assert.match(commandSource, /child\.unref\?\.\(\)/u);
});

test(
  'real Windows worker timeout terminates its owned process tree',
  { skip: process.platform !== 'win32', timeout: 40_000 },
  async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'eky-w6b2-command-contract-'),
    );
    const markerPath = join(temporaryRoot, 'worker-ready');
    const hangingPnpmPath = join(temporaryRoot, 'hanging-pnpm.mjs');
    const events = [];
    const startedAt = Date.now();
    let run;

    try {
      await writeFile(
        hangingPnpmPath,
        [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const markerPath = process.env.EKY_W6B2_PROCESS_CONTRACT_MARKER;",
          "if (typeof markerPath !== 'string' || markerPath.length === 0) process.exit(2);",
          "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
          "writeFileSync(markerPath, 'ready', 'utf8');",
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        'utf8',
      );

      run = runW6b2PackagedCommand(['--kind=success', '--run=1'], {
        dependencies: {
          createProofToken: () => proofToken,
          observe(event) {
            events.push(event);
          },
          setTimeout(callback) {
            return globalThis.setTimeout(callback, 5_000);
          },
          spawnProcess(command, arguments_, options) {
            return spawn(command, arguments_, {
              ...options,
              env: {
                ...options.env,
                EKY_W6B2_PROCESS_CONTRACT_MARKER: markerPath,
                npm_execpath: hangingPnpmPath,
              },
            });
          },
        },
      });

      await waitForFile(markerPath, 4_000);
      await assert.rejects(
        run,
        /W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT/u,
      );

      assert.deepEqual(
        events
          .filter(({ phase }) =>
            [
              'waitTimedOut',
              'cleanupStarted',
              'cleanupCompleted',
              'processTreeAbsent',
              'command',
            ].includes(phase),
          )
          .slice(-5)
          .map(({ errorCode, phase, status }) => ({
            ...(errorCode === undefined ? {} : { errorCode }),
            phase,
            status,
          })),
        [
          {
            errorCode: 'W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT',
            phase: 'waitTimedOut',
            status: 'failed',
          },
          { phase: 'cleanupStarted', status: 'started' },
          { phase: 'cleanupCompleted', status: 'completed' },
          { phase: 'processTreeAbsent', status: 'completed' },
          {
            errorCode: 'W6B2_PACKAGED_COMMAND_PROCESS_TIMEOUT',
            phase: 'command',
            status: 'failed',
          },
        ],
      );
      assert.ok(Date.now() - startedAt < 35_000);
    } finally {
      if (run !== undefined) await run.catch(() => undefined);
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  },
);

function startCommand(harness) {
  return runW6b2PackagedCommand(['--kind=success', '--run=1'], {
    dependencies: harness.dependencies,
  });
}

function createHarness(options = {}) {
  const child = new EventEmitter();
  child.pid = 42;
  const cleanupInputs = [];
  const events = [];
  const spawnArguments = [];
  let childKillCount = 0;
  let childUnrefCount = 0;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    childKillCount += 1;
    return true;
  };
  child.unref = () => {
    childUnrefCount += 1;
  };
  child.on('exit', (exitCode, signal) => {
    child.exitCode = exitCode;
    child.signalCode = signal;
  });
  let deadline;
  let heartbeat;
  const dependencies = {
    clearInterval() {},
    clearTimeout() {},
    createProofToken: () => options.proofToken ?? proofToken,
    now: () => 1_000,
    observe(event) {
      events.push(event);
    },
    setInterval(callback) {
      heartbeat = callback;
      return Object.freeze({ timer: 'heartbeat' });
    },
    setTimeout(callback) {
      deadline = callback;
      return Object.freeze({ timer: 'deadline' });
    },
    spawnProcess(...arguments_) {
      spawnArguments.push(arguments_);
      return child;
    },
    async terminateOwnedProcessTree(input) {
      cleanupInputs.push(input);
      if (options.cleanupError !== undefined) throw options.cleanupError;
      return options.cleanupResult ?? { status: 'absent' };
    },
  };
  return {
    child,
    childKillCount: () => childKillCount,
    childUnrefCount: () => childUnrefCount,
    cleanupInputs,
    dependencies,
    events,
    fireDeadline() {
      assert.equal(typeof deadline, 'function');
      deadline();
    },
    fireHeartbeat() {
      assert.equal(typeof heartbeat, 'function');
      heartbeat();
    },
    spawnArguments,
  };
}

function lastEvent(events) {
  assert.ok(events.length > 0);
  return events.at(-1);
}

async function waitForFile(path, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolvePromise) =>
        globalThis.setTimeout(resolvePromise, 25),
      );
    }
  }
  throw new Error('W6B2_PACKAGED_COMMAND_WORKER_NOT_READY');
}
