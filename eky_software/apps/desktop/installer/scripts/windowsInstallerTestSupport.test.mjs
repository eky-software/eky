import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const helperPath = join(scriptDirectory, 'windowsInstallerTestSupport.ps1');
const testPath = join(scriptDirectory, 'windowsInstallerTestSupport.test.ps1');

test('MSI test runner has bounded waits and exact-process cleanup', () => {
  const source = readFileSync(helperPath, 'utf8');

  assert.match(source, /function Get-EkyMsiExecPolicy/u);
  assert.match(source, /function Wait-EkyOwnedMsiProcess/u);
  assert.match(source, /function Stop-EkyOwnedMsiProcess/u);
  assert.match(source, /WaitForExit\(\$TimeoutMilliseconds\)/u);
  assert.match(source, /\$Process\.Kill\(\)/u);
  assert.doesNotMatch(
    source,
    /Start-Process\s+-FilePath 'msiexec\.exe'[\s\S]{0,180}-Wait/iu,
  );
  assert.doesNotMatch(source, /(?:taskkill|Stop-Process)\s+-Name\s+msiexec/iu);
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
    timeoutValidated: true,
    exactOwnedCleanup: true,
    foreignSentinelUntouched: true,
    orphanProcessCount: 0,
  });
});
