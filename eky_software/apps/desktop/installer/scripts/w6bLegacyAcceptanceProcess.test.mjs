import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
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
  runW6bLegacyAcceptanceProcess,
  W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS,
  W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS,
} from './w6bLegacyAcceptanceProcess.mjs';

const proofToken = 'a'.repeat(64);

test('keeps the legacy host deadline inside the outer CI budget', () => {
  assert.equal(W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS, 18 * 60 * 1000);
  assert.equal(
    W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
    30_000,
  );
  assert.equal(W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS, 60_000);
  assert.ok(
    W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS +
      W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS <
      30 * 60 * 1000,
  );
});

test('preserves a normal host exit and proves the owned tree absent', async () => {
  const harness = createHarness();
  const run = startAcceptance(harness);

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(harness.cleanupCount(), 1);
  assert.equal(harness.cleanupInputs[0].processKind, 'acceptance');
  assert.equal(harness.clearedHeartbeatCount(), 1);
  assert.equal(harness.clearedDeadlineCount(), 1);
  assert.deepEqual(lastEvent(harness.events), {
    durationMs: 0,
    elapsedMs: 0,
    operation: 'w6bLegacyAcceptance',
    phase: 'command',
    status: 'completed',
  });
});

test('uses a distinct safe contract for the full legacy command owner', async () => {
  const harness = createHarness();
  const run = startAcceptance(harness, { processKind: 'command' });

  harness.child.emit('exit', 17, null);

  await assert.rejects(run, /W6B_LEGACY_COMMAND_PROCESS_EXIT_FAILED/u);
  assert.equal(harness.cleanupInputs[0].processKind, 'command');
  assert.equal(
    harness.events.every(
      ({ operation }) => operation === 'w6bLegacyCommandProcess',
    ),
    true,
  );
});

test('preserves a non-zero host exit after exact cleanup', async () => {
  const harness = createHarness();
  const run = startAcceptance(harness);

  harness.child.emit('exit', 23, null);

  await assert.rejects(
    run,
    /W6B_LEGACY_ACCEPTANCE_PROCESS_EXIT_FAILED/u,
  );
  assert.equal(harness.cleanupCount(), 1);
});

test('emits heartbeat and a safe timeout before owned cleanup', async () => {
  const harness = createHarness();
  const run = startAcceptance(harness);

  harness.fireHeartbeat();
  harness.fireDeadline();

  await assert.rejects(run, /W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT/u);
  assert.equal(harness.cleanupCount(), 1);
  assert.ok(
    harness.events.some(
      (event) =>
        event.phase === 'waitHeartbeat' && event.status === 'heartbeat',
    ),
  );
  assert.ok(
    harness.events.some(
      (event) =>
        event.phase === 'waitTimedOut' &&
        event.errorCode === 'W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT',
    ),
  );
});

test('keeps timeout terminal when the host exits during cleanup', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      harness.child.emit('exit', 0, null);
      return { status: 'absent' };
    },
  });
  const run = startAcceptance(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT/u);
});

test('fails closed when an owned child remains after cleanup', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      return { status: 'remains' };
    },
  });
  const run = startAcceptance(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B_LEGACY_ACCEPTANCE_CLEANUP_FAILED/u);
});

test('preserves cleanup timeout as the terminal failure', async () => {
  const harness = createHarness({
    async terminateOwnedProcessTree() {
      throw new Error('W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT');
    },
  });
  const run = startAcceptance(harness);

  harness.fireDeadline();

  await assert.rejects(run, /W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT/u);
  assert.equal(harness.childUnrefCount(), 1);
});

test('observer failure cannot change the host result or timer cleanup', async () => {
  const harness = createHarness({
    observe() {
      throw new Error('private observer failure');
    },
  });
  const run = startAcceptance(harness);

  harness.child.emit('exit', 0, null);

  await assert.doesNotReject(run);
  assert.equal(harness.clearedHeartbeatCount(), 1);
  assert.equal(harness.clearedDeadlineCount(), 1);
});

test('safe observations expose no process inputs or raw errors', async () => {
  const harness = createHarness();
  const run = startAcceptance(harness);

  harness.child.emit('exit', 9, null);
  await assert.rejects(run);

  const serialized = JSON.stringify(harness.events);
  assert.doesNotMatch(
    serialized,
    /fixture-path|ProcessProofToken|powershell|stack|private/iu,
  );
  for (const event of harness.events) {
    assert.deepEqual(
      Object.keys(event).sort(),
      [
        ...(event.errorCode === undefined ? [] : ['errorCode']),
        'durationMs',
        'elapsedMs',
        'operation',
        'phase',
        'status',
      ].sort(),
    );
  }
});

test('a real timeout stops only the owned child and preserves a foreign sentinel', {
  skip: process.platform !== 'win32',
  timeout: 10_000,
}, async () => {
  const owned = createRealSentinel();
  const foreign = createRealSentinel();
  const events = [];
  let ownedTerminalObserved = false;
  try {
    const run = runW6bLegacyAcceptanceProcess(
      {
        arguments: ['-e', 'fixture'],
        cleanupTimeoutMilliseconds: 2_000,
        command: process.execPath,
        cwd: process.cwd(),
        environment: process.env,
        heartbeatMilliseconds: 20,
        proofToken,
        timeoutMilliseconds: 100,
      },
      {
        dependencies: {
          observe: (event) => events.push(event),
          spawnProcess: () => owned,
          async terminateOwnedProcessTree({ processId }) {
            assert.equal(processId, owned.pid);
            owned.kill();
            if (owned.exitCode === null) await once(owned, 'exit');
            ownedTerminalObserved = true;
            return { status: 'stopped' };
          },
        },
      },
    );

    await assert.rejects(run, /W6B_LEGACY_ACCEPTANCE_PROCESS_TIMEOUT/u);
    assert.equal(ownedTerminalObserved, true);
    assert.equal(foreign.exitCode, null);
    assert.ok(events.some((event) => event.phase === 'waitHeartbeat'));
    assert.ok(events.some((event) => event.phase === 'processTreeAbsent'));
  } finally {
    if (owned.exitCode === null) owned.kill();
    if (foreign.exitCode === null) {
      foreign.kill();
      await once(foreign, 'exit').catch(() => undefined);
    }
  }
});

test(
  'a real command timeout removes the exact worker and its descendant',
  { skip: process.platform !== 'win32', timeout: 15_000 },
  async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'eky-w6b-legacy-command-contract-'),
    );
    const workerPath = join(
      temporaryRoot,
      'runW6bLegacyUpgradeCommand.mjs',
    );
    const markerPath = join(temporaryRoot, 'worker-ready.json');
    const events = [];
    try {
      await writeFile(
        workerPath,
        [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
          "writeFileSync(process.env.EKY_W6B_LEGACY_COMMAND_MARKER, JSON.stringify({ child: child.pid, root: process.pid }), 'utf8');",
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        'utf8',
      );

      const run = runW6bLegacyAcceptanceProcess(
        {
          arguments: [
            workerPath,
            '--worker',
            `--process-proof-token=${proofToken}`,
          ],
          cleanupTimeoutMilliseconds: 5_000,
          command: process.execPath,
          cwd: temporaryRoot,
          environment: {
            ...process.env,
            EKY_W6B_LEGACY_COMMAND_MARKER: markerPath,
          },
          heartbeatMilliseconds: 100,
          processKind: 'command',
          proofToken,
          timeoutMilliseconds: 1_000,
        },
        { dependencies: { observe: (event) => events.push(event) } },
      );

      await waitForFile(markerPath, 800);
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      await assert.rejects(run, /W6B_LEGACY_COMMAND_PROCESS_TIMEOUT/u);
      await waitForProcessAbsent(marker.root, 2_000);
      await waitForProcessAbsent(marker.child, 2_000);
      assert.ok(events.some((event) => event.phase === 'processTreeAbsent'));
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  },
);

test('cleanup script requires exact proof ownership without name-wide termination', async () => {
  const source = await readFile(
    new URL('./stopW6bLegacyAcceptanceProcess.ps1', import.meta.url),
    'utf8',
  );

  assert.match(source, /ValidatePattern\('\^\[0-9a-f\]\{64\}\$'\)/u);
  assert.match(source, /ValidateSet\('acceptance', 'command'\)/u);
  assert.match(source, /testW6bLegacyUpgradeAcceptance\\\.ps1/u);
  assert.match(source, /runW6bLegacyUpgradeCommand\\\.mjs/u);
  assert.match(source, /-ProcessProofToken/u);
  assert.match(source, /--process-proof-token/u);
  assert.match(source, /--worker/u);
  assert.match(source, /Stop-EkyProcessTree -Process \$process/u);
  assert.match(source, /actualCreationToken -cne \$expectedCreationToken/u);
  assert.doesNotMatch(source, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(source, /taskkill\.exe/iu);
});

function startAcceptance(harness, overrides = {}) {
  return runW6bLegacyAcceptanceProcess(
    {
      arguments: ['-File', 'fixture-path', '-ProcessProofToken', proofToken],
      cleanupTimeoutMilliseconds: 10,
      command: 'powershell.exe',
      cwd: 'fixture-path',
      environment: {},
      heartbeatMilliseconds: 5,
      processKind: overrides.processKind ?? 'acceptance',
      proofToken,
      timeoutMilliseconds: 10,
    },
    { dependencies: harness.dependencies },
  );
}

function createHarness(overrides = {}) {
  const child = new EventEmitter();
  child.pid = 42;
  const events = [];
  const cleanupInputs = [];
  let childKillCount = 0;
  let childUnrefCount = 0;
  let cleanupCount = 0;
  let clearedDeadlineCount = 0;
  let clearedHeartbeatCount = 0;
  let deadline;
  let heartbeat;
  const terminateOwnedProcessTree =
    overrides.terminateOwnedProcessTree ??
    (async () => {
      return { status: 'absent' };
    });
  const dependencies = {
    clearInterval() {
      clearedHeartbeatCount += 1;
    },
    clearTimeout() {
      clearedDeadlineCount += 1;
    },
    now() {
      return 1_000;
    },
    observe: overrides.observe ?? ((event) => events.push(event)),
    setInterval(callback) {
      heartbeat = callback;
      return Object.freeze({ timer: 'heartbeat' });
    },
    setTimeout(callback) {
      deadline = callback;
      return Object.freeze({ timer: 'deadline' });
    },
    spawnProcess() {
      return child;
    },
    async terminateOwnedProcessTree(input) {
      cleanupCount += 1;
      cleanupInputs.push(input);
      return terminateOwnedProcessTree(input);
    },
  };
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    childKillCount += 1;
    return true;
  };
  child.unref = () => {
    childUnrefCount += 1;
  };
  child.on('exit', (exitCode, signalCode) => {
    child.exitCode = exitCode;
    child.signalCode = signalCode;
  });
  return {
    child,
    childKillCount: () => childKillCount,
    childUnrefCount: () => childUnrefCount,
    cleanupCount: () => cleanupCount,
    cleanupInputs,
    clearedDeadlineCount: () => clearedDeadlineCount,
    clearedHeartbeatCount: () => clearedHeartbeatCount,
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
  };
}

function createRealSentinel() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
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
  throw new Error('W6B_LEGACY_COMMAND_WORKER_NOT_READY');
}

async function waitForProcessAbsent(processId, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if (error instanceof Error && error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolvePromise) =>
      globalThis.setTimeout(resolvePromise, 25),
    );
  }
  throw new Error('W6B_LEGACY_COMMAND_PROCESS_REMAINS');
}
