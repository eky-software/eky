import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = join(scriptDirectory, 'windowsInstallerTestSupport.ps1');
const hostPath = join(scriptDirectory, 'windowsInstallerMsiExecHost.ps1');
const testPath = join(scriptDirectory, 'windowsInstallerTestSupport.test.ps1');

test('MSI test runner has bounded waits and exact-process cleanup', () => {
  const source = readFileSync(helperPath, 'utf8');
  const hostSource = readFileSync(hostPath, 'utf8');

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
  assert.match(source, /function Stop-EkyOwnedMsiProcess/u);
  assert.match(source, /function Remove-EkyInstallerTestDirectory/u);
  assert.match(source, /EKY_INSTALLER_TEST_DELETE_ROOT/u);
  assert.match(
    source,
    /Wait-EkyOwnedMsiProcess -Process \$cleanupProcess/u,
  );
  assert.match(source, /WaitForExit\(\$TimeoutMilliseconds\)/u);
  assert.match(source, /Stop-EkyProcessTree -Process \$Process/u);
  assert.doesNotMatch(
    source,
    /Start-Process\s+-FilePath 'msiexec\.exe'[\s\S]{0,180}-Wait/iu,
  );
  assert.doesNotMatch(source, /(?:taskkill|Stop-Process)\s+-Name\s+msiexec/iu);
  assert.match(hostSource, /System32\\msiexec\.exe/u);
  assert.match(hostSource, /-Wait\s+`\s+-PassThru/u);
  assert.doesNotMatch(hostSource, /(?:taskkill|Stop-Process)/iu);
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
    longPathCleanupValidated: true,
    timeoutValidated: true,
    ownedTreeWaitValidated: true,
    exactOwnedCleanup: true,
    foreignSentinelUntouched: true,
    orphanProcessCount: 0,
  });
});
