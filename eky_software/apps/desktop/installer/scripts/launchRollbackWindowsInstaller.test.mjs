import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
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
      const result = runBootstrap(fixture);
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

function createFixture(helperSource) {
  const root = mkdtempSync(join(tmpdir(), 'eky rollback launch '));
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
    [
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
    ],
    { encoding: 'utf8', timeout: 5_000, windowsHide: true },
  );
}

function removeFixture(root) {
  rmSync(root, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}

async function waitForFile(path) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}
