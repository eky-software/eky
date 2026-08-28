import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = join(scriptDirectory, 'windowsInstallerTestSupport.ps1');
const hostPath = join(scriptDirectory, 'windowsInstallerMsiExecHost.ps1');
const observationPath = join(
  scriptDirectory,
  'windowsInstallerMsiProcessObservation.ps1',
);
const testPath = join(scriptDirectory, 'windowsInstallerTestSupport.test.ps1');

test('MSI test runner has bounded waits and exact-process cleanup', () => {
  const source = readFileSync(helperPath, 'utf8');
  const hostSource = readFileSync(hostPath, 'utf8');
  const observationSource = readFileSync(observationPath, 'utf8');

  assert.match(source, /function Get-EkyMsiExecPolicy/u);
  assert.match(
    source,
    /'w6b2_source_install'\s*\{\s*@\('W6B2_SUCCESS_SOURCE_INSTALL', 300000\)\s*\}/u,
  );
  assert.match(
    source,
    /'w6b2_uninstall'\s*\{\s*@\('W6B2_SUCCESS_UNINSTALL', 180000\)\s*\}/u,
  );
  assert.match(source, /function Start-EkyOwnedMsiExecHost/u);
  assert.match(source, /function Wait-EkyOwnedMsiProcess/u);
  assert.match(source, /function Wait-EkyObservedOwnedMsiProcess/u);
  assert.match(source, /function Invoke-EkyOwnedMsiProcessLifecycle/u);
  assert.match(source, /function Invoke-EkyOwnedMsiProcessCleanup/u);
  assert.match(source, /function Stop-EkyOwnedMsiProcess/u);
  assert.match(source, /function Remove-EkyInstallerTestDirectory/u);
  assert.match(source, /EKY_INSTALLER_TEST_DELETE_ROOT/u);
  assert.match(
    source,
    /Wait-EkyOwnedMsiProcess -Process \$cleanupProcess/u,
  );
  assert.match(source, /WaitForExit\(\$TimeoutMilliseconds\)/u);
  const observedWait = source.match(
    /function Wait-EkyObservedOwnedMsiProcess[\s\S]*?\n\}\n\nfunction Invoke-EkyOwnedMsiProcessCleanup/u,
  )?.[0];
  assert.ok(observedWait);
  assert.match(observedWait, /ManualResetEventSlim/u);
  assert.match(observedWait, /\$Process\.Refresh\(\)/u);
  assert.match(observedWait, /\$Process\.HasExited/u);
  assert.doesNotMatch(observedWait, /WaitForExit\([^0]/u);
  assert.match(
    source,
    /if \(\$EmitSafeProgress\) \{[\s\S]*Invoke-EkyOwnedMsiProcessLifecycle/u,
  );
  assert.match(
    source,
    /\$result = Wait-EkyOwnedMsiProcess -Process \$process/u,
  );
  assert.match(source, /Stop-EkyProcessTree -Process \$Process/u);
  assert.doesNotMatch(
    source,
    /Start-Process\s+-FilePath 'msiexec\.exe'[\s\S]{0,180}-Wait/iu,
  );
  assert.doesNotMatch(source, /(?:taskkill|Stop-Process)\s+-Name\s+msiexec/iu);
  assert.match(hostSource, /System32\\msiexec\.exe/u);
  assert.match(hostSource, /-Wait\s+`\s+-PassThru/u);
  assert.doesNotMatch(hostSource, /(?:taskkill|Stop-Process)/iu);
  assert.match(observationSource, /phaseStartedAt/u);
  assert.match(observationSource, /ConvertTo-Json -Compress/u);
  assert.doesNotMatch(
    observationSource,
    /(?:processId|path|commandLine|stdout|stderr|stack)/iu,
  );
});

test('bounded MSI runner exits safely and leaves a foreign sentinel running', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      testPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');
  const terminal = lines.length === 1 ? JSON.parse(lines[0]) : null;

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.deepEqual(terminal, {
    status: 'succeeded',
    boundedInstallPolicy: true,
    boundedUninstallPolicy: true,
    fastExitValidated: true,
    hostArgumentRoundTripValidated: true,
    hostExitBeforeCleanupValidated: true,
    longPathCleanupValidated: true,
    nonzeroExitPreserved: true,
    safeProcessObservability: true,
    timeoutValidated: true,
    timeoutCleanupFailurePreserved: true,
    ownedTreeWaitValidated: true,
    exactOwnedCleanup: true,
    foreignSentinelUntouched: true,
    orphanProcessCount: 0,
  });
});
