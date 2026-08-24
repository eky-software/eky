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
const allowedResultStages = new Set([
  'initialization',
  'ownershipRules',
  'outcomeRules',
  'pidReuseRules',
  'alreadyExitedProcess',
  'fixtureStartup',
  'fixtureReadiness',
  'ownedTreeSnapshot',
  'ownedTreeStop',
  'postcondition',
  'cleanup',
  'completed',
]);
const allowedResultErrorCodes = new Set([
  'none',
  'INSTALLER_PROCESS_TREE_OWNERSHIP_INVALID',
  'INSTALLER_PROCESS_TREE_UNRELATED_INCLUDED',
  'INSTALLER_PROCESS_TREE_EXIT_ZERO_INVALID',
  'INSTALLER_PROCESS_TREE_NONZERO_GONE_INVALID',
  'INSTALLER_PROCESS_TREE_ROOT_WAIT_INVALID',
  'INSTALLER_PROCESS_TREE_CHILD_EXIT_WAIT_INVALID',
  'INSTALLER_PROCESS_TREE_CHILD_EXIT_STOP_INVALID',
  'INSTALLER_PROCESS_TREE_EXPECTED_ERROR_MISSING',
  'INSTALLER_PROCESS_TREE_REUSED_ROOT_INCLUDED',
  'INSTALLER_PROCESS_TREE_REUSED_PID_REMAINS',
  'INSTALLER_PROCESS_TREE_FIXTURE_ROOT_EXITED',
  'INSTALLER_PROCESS_TREE_READINESS_TIMEOUT',
  'INSTALLER_PROCESS_TREE_CHILD_MISSING',
  'INSTALLER_PROCESS_TREE_ROOT_REMAINS',
  'INSTALLER_PROCESS_TREE_UNRELATED_STOPPED',
  'INSTALLER_PROCESS_TREE_CLEANUP_FAILED',
  'INSTALLER_PROCESS_TREE_UNEXPECTED_ERROR',
  'INSTALLER_UPGRADE_PROCESS_IDENTITY_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_WAIT_INVALID',
  'INSTALLER_UPGRADE_PROCESS_TREE_REMAINS',
  'INSTALLER_UPGRADE_PROCESS_TREE_STOP_TIMEOUT',
  'INSTALLER_UPGRADE_PROCESS_TREE_STOP_FAILED',
]);
const allowedTaskkillExitClasses = new Set(['notStarted', 'zero', 'nonzero']);

function parseClosedProcessTreeResult(stdout) {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
  if (lines.length !== 1) {
    return null;
  }

  let value;
  try {
    value = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const boundedCount = (candidate) => (
    Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= 10_000
  );
  if (
    !['succeeded', 'failed'].includes(value.status)
    || !allowedResultStages.has(value.stage)
    || !allowedResultErrorCodes.has(value.errorCode)
    || !boundedCount(value.trackedCount)
    || !boundedCount(value.remainingCount)
    || typeof value.deadlineReached !== 'boolean'
    || !allowedTaskkillExitClasses.has(value.taskkillExitClass)
    || typeof value.exactIdentity !== 'boolean'
    || typeof value.postcondition !== 'boolean'
    || typeof value.unrelatedProcessUntouched !== 'boolean'
    || !boundedCount(value.orphanProcessCount)
  ) {
    return null;
  }

  return {
    status: value.status,
    stage: value.stage,
    errorCode: value.errorCode,
    trackedCount: value.trackedCount,
    remainingCount: value.remainingCount,
    deadlineReached: value.deadlineReached,
    taskkillExitClass: value.taskkillExitClass,
    exactIdentity: value.exactIdentity,
    postcondition: value.postcondition,
    unrelatedProcessUntouched: value.unrelatedProcessUntouched,
    orphanProcessCount: value.orphanProcessCount,
  };
}

function formatSafeProcessTreeFailure(result) {
  if (result === null) {
    return 'INSTALLER_PROCESS_TREE_TEST_RESULT_INVALID';
  }
  return [
    'INSTALLER_PROCESS_TREE_TEST_FAILED',
    `stage=${result.stage}`,
    `errorCode=${result.errorCode}`,
    `trackedCount=${result.trackedCount}`,
    `remainingCount=${result.remainingCount}`,
    `deadlineReached=${result.deadlineReached}`,
    `taskkillExitClass=${result.taskkillExitClass}`,
  ].join(' ');
}

test('installer cleanup remains scoped to an exact process identity', () => {
  const helperSource = readFileSync(processTreeHelperPath, 'utf8');
  const upgradeTestSource = readFileSync(upgradeTestPath, 'utf8');

  assert.match(helperSource, /Start-Process/);
  assert.match(helperSource, /System32\\taskkill\.exe/);
  assert.match(helperSource, /'\/PID'/);
  assert.match(helperSource, /-PassThru/);
  assert.match(helperSource, /WaitForExit\(\$TimeoutMilliseconds\)/);
  assert.doesNotMatch(
    helperSource,
    /System32\\taskkill\.exe[\s\S]{0,260}-Wait/,
  );
  assert.match(helperSource, /Observation/);
  assert.doesNotMatch(helperSource, /&\s+taskkill\.exe/);
  assert.doesNotMatch(helperSource, /Get-Process\s+-Name/);
  assert.doesNotMatch(helperSource, /Stop-Process\s+-Name/);
  assert.match(
    upgradeTestSource,
    /windowsInstallerProcessTree\.ps1/,
  );
});

test('installer process tree result reporting remains closed and safe', () => {
  const unsafeResult = parseClosedProcessTreeResult(JSON.stringify({
    status: 'failed',
    stage: 'C:\\private\\path',
    errorCode: 'raw error with stack',
    trackedCount: 2,
    remainingCount: 1,
    deadlineReached: true,
    taskkillExitClass: 'nonzero',
    exactIdentity: false,
    postcondition: false,
    unrelatedProcessUntouched: false,
    orphanProcessCount: 1,
  }));

  assert.equal(unsafeResult, null);
  assert.equal(
    formatSafeProcessTreeFailure(unsafeResult),
    'INSTALLER_PROCESS_TREE_TEST_RESULT_INVALID',
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

    if (result.error !== undefined) {
      assert.fail('INSTALLER_PROCESS_TREE_TEST_START_FAILED');
    }
    const closedResult = parseClosedProcessTreeResult(result.stdout);
    if (
      result.status !== 0
      || closedResult === null
      || closedResult.status !== 'succeeded'
    ) {
      assert.fail(formatSafeProcessTreeFailure(closedResult));
    }
    assert.equal(closedResult.exactIdentity, true);
    assert.equal(closedResult.postcondition, true);
    assert.equal(closedResult.unrelatedProcessUntouched, true);
    assert.equal(closedResult.orphanProcessCount, 0);
  },
);
