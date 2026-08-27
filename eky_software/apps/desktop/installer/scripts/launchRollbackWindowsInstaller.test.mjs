import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
    } finally {
      if (!existsSync(fixture.releasePath)) {
        writeFileSync(fixture.releasePath, 'release', 'utf8');
        await waitForFile(fixture.progressPath);
      }
      removeFixture(fixture.root);
    }
  },
);

test(
  'rollback bootstrap rejects a missing helper before handoff',
  { skip: process.platform !== 'win32' },
  () => {
    const fixture = createFixture('exit 0');
    try {
      unlinkSync(fixture.helperPath);
      const result = runBootstrap(fixture);
      assert.equal(result.status, 30);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, '');
      assert.equal(existsSync(fixture.progressPath), false);
    } finally {
      removeFixture(fixture.root);
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
    try {
      const result = await runBootstrapUntilExit(fixture);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'EKY_ROLLBACK_HELPER_STARTED\r\n');
      assert.equal(await waitForFile(fixture.startedPath), true);
      assert.equal(await waitForFile(fixture.progressPath, 500), false);
    } finally {
      removeFixture(fixture.root);
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

function runBootstrap(fixture) {
  return spawnSync(
    'powershell.exe',
    createBootstrapArguments(fixture),
    { encoding: 'utf8', timeout: 5_000, windowsHide: true },
  );
}

function runBootstrapUntilExit(fixture) {
  const processHandle = spawn(
    'powershell.exe',
    createBootstrapArguments(fixture),
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let stderr = '';
  let stdout = '';
  let exitOutcome;
  let settled = false;
  let timeout;
  const settleIfComplete = (resolvePromise) => {
    if (
      settled
      || exitOutcome === undefined
      || stdout !== 'EKY_ROLLBACK_HELPER_STARTED\r\n'
    ) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
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
    timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      processHandle.kill();
      rejectPromise(new Error('ROLLBACK_BOOTSTRAP_EXIT_TIMEOUT'));
    }, 5_000);
    processHandle.once('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      rejectPromise(new Error('ROLLBACK_BOOTSTRAP_START_FAILED'));
    });
    processHandle.once('exit', (status, signal) => {
      exitOutcome = { signal, status };
      settleIfComplete(resolvePromise);
    });
  });
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
