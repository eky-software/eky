import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = join(scriptDirectory, 'windowsInstallerUpgradeAttempt.ps1');
const harnessPath = join(scriptDirectory, 'testWindowsInstallerUpgrade.ps1');
const powershellTestPath = join(
  scriptDirectory,
  'windowsInstallerUpgradeAttempt.test.ps1',
);

test('running upgrade uses a bounded asynchronous MSI attempt', async () => {
  const [helperSource, harnessSource] = await Promise.all([
    readFile(helperPath, 'utf8'),
    readFile(harnessPath, 'utf8'),
  ]);

  assert.match(helperSource, /function Start-EkyUpgradeAttempt/);
  assert.match(helperSource, /function Wait-EkyUpgradeAttempt/);
  assert.match(helperSource, /function Get-EkyUpgradeAttemptOutcome/);
  assert.doesNotMatch(
    helperSource.match(/function Start-EkyUpgradeAttempt[\s\S]*?^}/m)?.[0] ?? '',
    /-Wait\b/,
  );
  assert.match(harnessSource, /runningUpgradeWaitingForApplicationExit/);
  assert.match(harnessSource, /INSTALLER_UPGRADE_MSI_EXIT_TIMEOUT/);
  assert.match(
    harnessSource,
    /\$runningEkyProcessId = \[int\]\$runningEkyProcess\.Id/,
  );
  assert.match(
    harnessSource,
    /\[Parameter\(Mandatory = \$true\)\]\[int\]\$LauncherProcessId/,
  );
  assert.match(harnessSource, /'-LauncherProcessId'/);
  assert.equal(
    [...harnessSource.matchAll(/-LauncherProcessId \$runningEkyProcessId/g)]
      .length,
    2,
  );
  assert.doesNotMatch(harnessSource, /function Invoke-EkyUpgradeAttempt/);
});

test('safe progress has a closed field and value contract', async () => {
  const helperSource = await readFile(helperPath, 'utf8');

  for (const stage of [
    'runningApplicationStarted',
    'runningUpgradeStarted',
    'runningUpgradeCompletedWhileRunning',
    'runningUpgradeWaitingForApplicationExit',
    'testApplicationShutdownStarted',
    'testApplicationShutdownCompleted',
    'runningUpgradeExitWaitStarted',
    'runningUpgradeExitWaitCompleted',
    'runningUpgradeOutcomeVerified',
  ]) {
    assert.match(helperSource, new RegExp(`'${stage}'`));
  }
  assert.doesNotMatch(
    helperSource.match(/function Write-EkyUpgradeProgress[\s\S]*?^}/m)?.[0] ?? '',
    /path|pid|hash|stack|command|errorMessage/i,
  );
});

test(
  'PowerShell behavior rejects unsafe outcomes and terminates owned processes',
  { skip: process.platform !== 'win32' },
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        powershellTestPath,
      ],
      { encoding: 'utf8', windowsHide: true },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"boundedWait":true/);
    assert.match(result.stdout, /"progressContract":true/);
    assert.match(result.stdout, /"resultClassification":true/);
  },
);
