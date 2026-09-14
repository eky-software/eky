import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, '..', '..');
const launchScriptPath = join(
  desktopDirectory,
  'resources',
  'update',
  'launchRollbackWindowsInstaller.ps1',
);

test(
  'rollback bootstrap starts a helper that survives bootstrap exit',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixture = createFixture(`
param(
  [string]$MsiExecPath,
  [string]$FailedProductCode,
  [int]$LauncherProcessId,
  [string]$FailedPackagePath,
  [string]$RollbackPackagePath,
  [string]$ProgressPath
)
$root = [System.IO.Path]::GetDirectoryName($ProgressPath)
$startedPath = Join-Path $root 'helper-started.signal'
$releasePath = Join-Path $root 'helper-release.signal'
[System.IO.File]::WriteAllText($startedPath, 'started')
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while (!(Test-Path -LiteralPath $releasePath)) {
  if ([DateTime]::UtcNow -ge $deadline) {
    exit 9
  }
  Start-Sleep -Milliseconds 25
}
[System.IO.File]::WriteAllText($ProgressPath, '{"status":"completed"}')
`);
    let verified = false;
    try {
      const result = await runBootstrapUntilExit(fixture);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'EKY_ROLLBACK_HELPER_STARTED\r\n');
      await waitForFile(fixture.startedPath);
      assert.equal(existsSync(fixture.startedPath), true);
      assert.equal(existsSync(fixture.progressPath), false);

      writeFileSync(fixture.releasePath, 'release', 'utf8');
      await waitForFile(fixture.progressPath);
      assert.equal(existsSync(fixture.progressPath), true);
      verified = true;
    } finally {
      if (!existsSync(fixture.releasePath)) {
        writeFileSync(fixture.releasePath, 'release', 'utf8');
        await waitForFile(fixture.progressPath);
      }
      if (verified) removeFixture(fixture.root);
    }
  },
);

test(
  'rollback bootstrap rejects a missing helper before handoff',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixture = createFixture('exit 0');
    let verified = false;
    try {
      unlinkSync(fixture.helperPath);
      const result = await runBootstrapUntilExit(fixture);
      assert.equal(result.status, 30);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, '');
      assert.equal(existsSync(fixture.progressPath), false);
      verified = true;
    } finally {
      if (verified) removeFixture(fixture.root);
    }
  },
);

test(
  'rollback bootstrap does not treat an early helper exit as terminal evidence',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixture = createFixture(`
param(
  [string]$MsiExecPath,
  [string]$FailedProductCode,
  [int]$LauncherProcessId,
  [string]$FailedPackagePath,
  [string]$RollbackPackagePath,
  [string]$ProgressPath
)
$root = [System.IO.Path]::GetDirectoryName($ProgressPath)
$startedPath = Join-Path $root 'helper-started.signal'
[System.IO.File]::WriteAllText($startedPath, 'started')
exit 7
`);
    let verified = false;
    try {
      const result = await runBootstrapUntilExit(fixture);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'EKY_ROLLBACK_HELPER_STARTED\r\n');
      assert.equal(await waitForFile(fixture.startedPath), true);
      assert.equal(await waitForFile(fixture.progressPath, 500), false);
      verified = true;
    } finally {
      if (verified) removeFixture(fixture.root);
    }
  },
);

function createFixture(helperSource) {
  const root = mkdtempSync(
    join(realpathSync.native(tmpdir()), 'eky rollback launch '),
  );
  const failedPackagePath = join(root, 'failed package.msi');
  const helperPath = join(root, 'rollback helper.ps1');
  const releasePath = join(root, 'helper-release.signal');
  const startedPath = join(root, 'helper-started.signal');
  const progressPath = join(root, 'rollback progress.jsonl');
  const rollbackPackagePath = join(root, 'rollback package.msi');
  writeFileSync(failedPackagePath, 'failed fixture', 'utf8');
  writeFileSync(helperPath, helperSource, 'utf8');
  writeFileSync(rollbackPackagePath, 'rollback fixture', 'utf8');
  return {
    failedPackagePath,
    helperPath,
    progressPath,
    releasePath,
    rollbackPackagePath,
    root,
    startedPath,
  };
}

function runBootstrapUntilExit(fixture, {
  startProcess = (value) => spawn('powershell.exe', createBootstrapArguments(value), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const processHandle = startProcess(fixture);
  let stderr = '';
  let stdout = '';
  let exitOutcome;
  let settled = false;
  let timeout;
  const settleIfComplete = (resolvePromise) => {
    if (
      settled
      || exitOutcome === undefined
      || (exitOutcome.status === 0 && exitOutcome.signal === null
        && stdout !== 'EKY_ROLLBACK_HELPER_STARTED\r\n')
    ) {
      return;
    }
    settled = true;
    clearTimer(timeout);
    resolvePromise({ ...exitOutcome, stderr, stdout });
  };
  processHandle.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolvePromise, rejectPromise) => {
    processHandle.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      settleIfComplete(resolvePromise);
    });
    timeout = setTimer(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (exitOutcome === undefined) processHandle.kill();
      rejectPromise(new Error(exitOutcome === undefined
        ? 'ROLLBACK_BOOTSTRAP_EXIT_TIMEOUT'
        : 'ROLLBACK_BOOTSTRAP_ACKNOWLEDGEMENT_INVALID'));
    }, 5_000);
    processHandle.once('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timeout);
      rejectPromise(new Error('ROLLBACK_BOOTSTRAP_START_FAILED'));
    });
    processHandle.once('exit', (status, signal) => {
      exitOutcome = { signal, status };
      settleIfComplete(resolvePromise);
    });
  });
}

test('rollback bootstrap reader preserves a non-zero exit without waiting for success acknowledgement', async () => {
  const fixture = createBootstrapEventFixture();
  const completion = runBootstrapUntilExit({}, fixture.dependencies);
  fixture.child.emit('exit', 30, null);
  assert.deepEqual(await completion, { status: 30, signal: null, stdout: '', stderr: '' });
  assert.equal(fixture.timerPending(), false);
  assert.equal(fixture.killRequested(), false);
});

test('rollback bootstrap reader accepts acknowledgement delivered after process exit', async () => {
  const fixture = createBootstrapEventFixture();
  const completion = runBootstrapUntilExit({}, fixture.dependencies);
  let returned = false;
  completion.then(() => { returned = true; });
  fixture.child.emit('exit', 0, null);
  await Promise.resolve();
  assert.equal(returned, false);
  fixture.child.stdout.emit('data', Buffer.from('EKY_ROLLBACK_'));
  await Promise.resolve();
  assert.equal(returned, false);
  fixture.child.stdout.emit('data', Buffer.from('HELPER_STARTED\r\n'));
  assert.equal((await completion).status, 0);
  assert.equal(fixture.timerPending(), false);
  assert.equal(fixture.killRequested(), false);
});

test('rollback bootstrap reader distinguishes missing acknowledgement from a live-process timeout', async () => {
  for (const exited of [false, true]) {
    const fixture = createBootstrapEventFixture();
    const completion = runBootstrapUntilExit({}, fixture.dependencies);
    const rejected = assert.rejects(completion, { message: exited
      ? 'ROLLBACK_BOOTSTRAP_ACKNOWLEDGEMENT_INVALID' : 'ROLLBACK_BOOTSTRAP_EXIT_TIMEOUT' });
    if (exited) fixture.child.emit('exit', 0, null);
    fixture.expire();
    await rejected;
    assert.equal(fixture.killRequested(), !exited);
  }
});

function createBootstrapEventFixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let timer;
  let killed = false;
  child.kill = () => { killed = true; return true; };
  return {
    child,
    dependencies: {
      startProcess: () => child,
      setTimer(callback, milliseconds) {
        assert.equal(milliseconds, 5_000);
        timer = callback;
        return callback;
      },
      clearTimer() { timer = undefined; },
    },
    expire() { const callback = timer; timer = undefined; callback(); },
    timerPending: () => timer !== undefined,
    killRequested: () => killed,
  };
}

function createBootstrapArguments(fixture) {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    launchScriptPath,
    '-MsiExecPath',
    join(process.env.SystemRoot, 'System32', 'msiexec.exe'),
    '-FailedProductCode',
    '{22222222-2222-4222-8222-222222222222}',
    '-LauncherProcessId',
    String(process.pid),
    '-FailedPackagePath',
    fixture.failedPackagePath,
    '-RollbackPackagePath',
    fixture.rollbackPackagePath,
    '-RollbackScriptPath',
    fixture.helperPath,
    '-ProgressPath',
    fixture.progressPath,
  ];
}

function removeFixture(root) {
  rmSync(root, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}

async function waitForFile(path, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return existsSync(path);
}
