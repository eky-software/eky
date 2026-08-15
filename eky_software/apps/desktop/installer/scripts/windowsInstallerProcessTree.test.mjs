import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const powershellTestPath = join(
  scriptDirectory,
  'windowsInstallerProcessTree.test.ps1',
);
const processTreeHelperPath = join(
  scriptDirectory,
  'windowsInstallerProcessTree.ps1',
);
const upgradeTestPath = join(
  scriptDirectory,
  'testWindowsInstallerUpgrade.ps1',
);

test('installer cleanup remains scoped to an exact process identity', () => {
  const helperSource = readFileSync(processTreeHelperPath, 'utf8');
  const upgradeTestSource = readFileSync(upgradeTestPath, 'utf8');

  assert.match(helperSource, /taskkill\.exe \/PID/);
  assert.doesNotMatch(helperSource, /Get-Process\s+-Name/);
  assert.doesNotMatch(helperSource, /Stop-Process\s+-Name/);
  assert.match(
    upgradeTestSource,
    /windowsInstallerProcessTree\.ps1/,
  );
});

test(
  'installer cleanup verifies the exact owned process tree postcondition',
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

    assert.equal(result.error, undefined, 'INSTALLER_PROCESS_TREE_TEST_START_FAILED');
    assert.equal(result.status, 0, 'INSTALLER_PROCESS_TREE_TEST_FAILED');
    assert.match(result.stdout, /"exactIdentity":true/);
    assert.match(result.stdout, /"postcondition":true/);
    assert.match(result.stdout, /"unrelatedProcessUntouched":true/);
    assert.match(result.stdout, /"orphanProcessCount":0/);
  },
);
