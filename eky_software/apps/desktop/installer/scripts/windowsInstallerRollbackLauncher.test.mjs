import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = join(scriptDirectory, '..', '..');
const temporaryDirectories = [];
const launcherDeadlineMs = 10_000;
const progressPollIntervalMs = 50;
const expectedValidationProgress = [
  { event: 'started', phase: 'inputValidation' },
  { event: 'failed', phase: 'inputValidation' },
];
const launcherExitClasses = new Map([
  [0, 'SUCCESS'],
  [20, 'FAILED_PACKAGE_UNINSTALL_FAILED'],
  [21, 'FAILED_PACKAGE_REPAIR_SUCCEEDED'],
  [22, 'FAILED_PACKAGE_REPAIR_FAILED'],
  [23, 'ROLLBACK_HELPER_FAILED'],
  [24, 'MSIEXEC_INVALID'],
  [25, 'FAILED_PACKAGE_INVALID'],
  [26, 'ROLLBACK_PACKAGE_INVALID'],
  [27, 'LAUNCHER_EXIT_WAIT_FAILED'],
  [30, 'LAUNCHER_FAILED'],
  [31, 'SYSTEM_ROOT_INVALID'],
]);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test(
  'the fixed launcher reaches rollback validation and propagates its exit code',
  { skip: process.platform !== 'win32' },
  async () => {
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot);
    const proofRoot = await mkdtemp(
      join(tmpdir(), 'eky-rollback-launcher-proof-'),
    );
    temporaryDirectories.push(proofRoot);
    const progressPath = join(proofRoot, 'rollback-progress.jsonl');
    const updateRuntimeDirectory = join(
      desktopDirectory,
      'resources',
      'update',
    );
    const commandPath = join(systemRoot, 'System32', 'cmd.exe');
    const msiExecPath = join(systemRoot, 'System32', 'msiexec.exe');
    const processHandle = spawn(
      commandPath,
      [
        '/d',
        '/q',
        '/v:off',
        '/s',
        '/c',
        'rollbackWindowsInstallerLauncher.cmd',
      ],
      {
        cwd: updateRuntimeDirectory,
        // Production detachment is covered by windowsInstallerRollbackHandoff.test.ts.
        // Keep this process-level test attached so CI can observe its exact exit.
        detached: false,
        env: {
          EKY_ROLLBACK_FAILED_PACKAGE_PATH: join(
            proofRoot,
            'missing-failed.msi',
          ),
          EKY_ROLLBACK_FAILED_PRODUCT_CODE:
            '{22222222-2222-4222-8222-222222222222}',
          EKY_ROLLBACK_LAUNCHER_PROCESS_ID: String(process.pid),
          EKY_ROLLBACK_MSIEXEC_PATH: msiExecPath,
          EKY_ROLLBACK_PROGRESS_PATH: progressPath,
          EKY_ROLLBACK_PACKAGE_PATH: join(
            proofRoot,
            'missing-rollback.msi',
          ),
          SystemRoot: systemRoot,
          windir: systemRoot,
        },
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const exitPromise = observeProcessExit(processHandle);
    await waitUntilSpawned(processHandle);
    const deadlineAt = Date.now() + launcherDeadlineMs;
    const progressObserver = observeValidationFailure(
      progressPath,
      deadlineAt,
    );
    try {
      const firstTerminal = await Promise.race([
        exitPromise.then((exit) => ({ exit, type: 'exit' })),
        progressObserver.promise,
      ]);
      const { exit, rows } = await resolveLauncherTerminalState({
        deadlineAt,
        exitPromise,
        firstTerminal,
        processHandle,
        progressPath,
      });
      assert.deepEqual(
        rows.map(({ event, phase }) => ({ event, phase })),
        expectedValidationProgress,
      );
      assert.deepEqual(exit, { code: 25, signal: null });
    } finally {
      progressObserver.stop();
      if (processHandle.exitCode === null && !processHandle.killed) {
        processHandle.kill();
      }
    }
  },
);

function waitUntilSpawned(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once('error', () => {
      reject(new Error('ROLLBACK_LAUNCHER_START_FAILED'));
    });
    processHandle.once('spawn', resolve);
  });
}

function observeProcessExit(processHandle) {
  return new Promise((resolve) => {
    processHandle.once('error', () => {
      resolve({ type: 'error' });
    });
    processHandle.once('exit', (code, signal) => {
      resolve({ code, signal, type: 'exit' });
    });
  });
}

async function resolveLauncherTerminalState({
  deadlineAt,
  exitPromise,
  firstTerminal,
  processHandle,
  progressPath,
}) {
  if (firstTerminal.type === 'exit') {
    return resolveExitedLauncher(firstTerminal.exit, progressPath);
  }
  if (firstTerminal.type === 'progress') {
    return {
      exit: await waitForExitUntilDeadline(
        exitPromise,
        processHandle,
        deadlineAt,
      ),
      rows: firstTerminal.rows,
    };
  }
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    throw new Error('ROLLBACK_LAUNCHER_EXIT_TIMEOUT');
  }
  return resolveExitedLauncher(await exitPromise, progressPath);
}

async function resolveExitedLauncher(exit, progressPath) {
  if (exit.type === 'error') {
    throw new Error('ROLLBACK_LAUNCHER_START_FAILED');
  }
  const rows = await readProgressRows(progressPath);
  if (hasValidationFailure(rows)) {
    return {
      exit: { code: exit.code, signal: exit.signal },
      rows,
    };
  }
  throw new Error(classifyExitBeforeProgress(exit));
}

function waitForExitUntilDeadline(exitPromise, processHandle, deadlineAt) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        reject(new Error('ROLLBACK_LAUNCHER_EXIT_TIMEOUT'));
        return;
      }
      exitPromise.then((outcome) => settleExitOutcome(outcome, resolve, reject));
    }, remainingMs);
    exitPromise.then((outcome) => {
      clearTimeout(timeout);
      settleExitOutcome(outcome, resolve, reject);
    });
  });
}

function settleExitOutcome(outcome, resolve, reject) {
  if (outcome.type === 'error') {
    reject(new Error('ROLLBACK_LAUNCHER_START_FAILED'));
    return;
  }
  resolve({ code: outcome.code, signal: outcome.signal });
}

function observeValidationFailure(progressPath, deadlineAt) {
  let finished = false;
  let pollTimer;
  let resolveObserver;
  const promise = new Promise((resolve) => {
    resolveObserver = resolve;
  });
  const finish = (outcome) => {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(pollTimer);
    resolveObserver(outcome);
  };
  const poll = async () => {
    const rows = await readProgressRows(progressPath);
    if (hasValidationFailure(rows)) {
      finish({ rows, type: 'progress' });
      return;
    }
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      finish({ type: 'deadline' });
      return;
    }
    pollTimer = setTimeout(
      poll,
      Math.min(progressPollIntervalMs, remainingMs),
    );
  };
  void poll();
  return {
    promise,
    stop() {
      finish({ type: 'stopped' });
    },
  };
}

async function readProgressRows(progressPath) {
  try {
    return (await readFile(progressPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function hasValidationFailure(rows) {
  return rows.some(
    (row) => row.phase === 'inputValidation' && row.event === 'failed',
  );
}

function classifyExitBeforeProgress(exit) {
  if (exit.signal !== null) {
    return 'ROLLBACK_LAUNCHER_EXITED_BEFORE_PROGRESS_SIGNALLED';
  }
  const exitClass = launcherExitClasses.get(exit.code);
  if (exitClass === undefined) {
    return 'ROLLBACK_LAUNCHER_EXITED_BEFORE_PROGRESS_UNKNOWN';
  }
  return `ROLLBACK_LAUNCHER_EXITED_BEFORE_PROGRESS_${exitClass}`;
}
