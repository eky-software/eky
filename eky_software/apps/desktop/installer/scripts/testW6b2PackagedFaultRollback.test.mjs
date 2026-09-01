import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harness = read('testW6b2PackagedFaultRollback.ps1');
const evidence = read(join('w6b2Fault', 'evidence.ps1'));
const progress = read(join('w6b2Fault', 'progress.ps1'));
const rollbackProgress = read(join('w6b2Fault', 'rollbackProgress.ps1'));
const applicationProcess = read(
  join('w6b2Fault', 'applicationProcess.ps1'),
);
const scenarioOperations = read(
  join('w6b2Fault', 'scenarioOperations.ps1'),
);
const progressTestPath = join(
  scriptDirectory,
  'w6b2FaultProgress.test.ps1',
);

const scenarios = Object.freeze([
  'preUpdateRecoveryPointFailure',
  'activeWorkspaceFirstStartFailure',
  'acceptanceInterruption',
  'passiveWorkspaceMigrationFailure',
  'binaryRollbackFailure',
]);

test('fault harness composes only named packaged proof responsibilities', () => {
  for (const responsibility of [
    'evidence.ps1',
    'progress.ps1',
    'rollbackProgress.ps1',
    'applicationProcess.ps1',
    'scenarioOperations.ps1',
  ]) {
    assert.match(harness, new RegExp(`w6b2Fault\\\\${responsibility}`, 'u'));
  }
  assert.match(harness, /Invoke-W6b2FaultScenarioFlow/u);
  assert.match(harness, /Start-W6b2FaultScenario/u);
  assert.match(harness, /Complete-W6b2FaultScenario/u);
  assert.match(harness, /Fail-W6b2FaultScenario/u);
});

test('five closed scenarios dispatch to separate orchestration functions', () => {
  for (const scenario of scenarios) {
    assert.match(evidence, new RegExp(`'${scenario}'`, 'u'));
    assert.match(scenarioOperations, new RegExp(`'${scenario}'`, 'u'));
  }
  for (const responsibility of [
    'PreUpdateRecoveryPointFailure',
    'ActiveWorkspaceFirstStartFailure',
    'AcceptanceInterruption',
    'PassiveWorkspaceMigrationFailure',
    'BinaryRollbackFailure',
  ]) {
    assert.match(
      scenarioOperations,
      new RegExp(`function Invoke-W6b2Fault${responsibility}`, 'u'),
    );
  }
  assert.match(scenarioOperations, /default \{ throw 'W6B2_FAULT_SCENARIO_INVALID' \}/u);
  assert.doesNotMatch(
    `${harness}\n${evidence}\n${scenarioOperations}`,
    /FaultMode|GenericFault|environmentFault/u,
  );
});

test('fault phase contract is scenario-specific and strict', () => {
  assert.match(evidence, /function Assert-W6b2FaultScenarioPhase/u);
  assert.match(evidence, /W6B2_FAULT_PHASE_INVALID/u);
  assert.match(evidence, /faultScenario = \$FaultScenario/u);
  assert.match(evidence, /formatVersion = 2/u);
  assert.match(evidence, /phase = \$Phase/u);
  assert.match(
    evidence,
    /\[IO\.File\]::Replace\(\$nextPath, \$phasePath, \$previousPath\)/u,
  );
  assert.doesNotMatch(evidence, /Error\.message|stack|commandLine|processId/u);
});

test('progress is closed safe JSONL with terminal stage and scenario events', () => {
  for (const status of [
    'started',
    'observed',
    'completed',
    'failed',
    'heartbeat',
  ]) {
    assert.match(progress, new RegExp(`'${status}'`, 'u'));
  }
  for (const resultCode of [
    'scenarioStarted',
    'scenarioCompleted',
    'scenarioFailed',
    'stageFailed',
    'cleanupOwnedProcessesStarted',
    'cleanupOwnedProcessesCompleted',
    'cleanupTargetPackageStarted',
    'cleanupTargetPackageCompleted',
    'cleanupSourcePackageStarted',
    'cleanupSourcePackageCompleted',
    'cleanupPostconditionsStarted',
    'cleanupPostconditionsCompleted',
    'productStateVerified',
    'payloadVerified',
    'registrationVerified',
    'packageHashesVerified',
    'packageVerified',
  ]) {
    assert.match(progress, new RegExp(`'${resultCode}'`, 'u'));
  }
  assert.match(progress, /ConvertTo-Json -InputObject \$line -Compress/u);
  assert.match(progress, /\[Console\]::Out\.WriteLine/u);
  assert.match(progress, /Resolve-W6b2FaultSafeErrorCode/u);
  assert.match(progress, /primaryFailure/u);
  assert.match(progress, /secondaryFailure/u);
  assert.doesNotMatch(progress, /Write-Host|Write-Error|Write-Warning/u);
  assert.doesNotMatch(
    progress,
    /rawPath|commandLine|processId|pid|stack|ErrorRecord\.ToString|ScriptStackTrace/iu,
  );
});

test('fault progress preserves the primary failure beside cleanup failure', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      progressTestPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const events = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  assert.deepEqual(events.at(-1), {
    scenario: 'binaryRollbackFailure',
    stage: 'scenario',
    status: 'failed',
    resultCode: 'scenarioFailed',
    durationMs: events.at(-1).durationMs,
    elapsedMs: events.at(-1).elapsedMs,
    primaryFailure: 'W6B2_FAULT_OWNED_UNCLASSIFIED_REMAINS',
    secondaryFailure: 'W6B2_FAULT_CLEANUP_OWNERSHIP_FAILED',
  });
  assert.equal(
    events.some((event) =>
      Object.values(event).some(
        (value) =>
          typeof value === 'string' &&
          /raw fixture|stack|[A-Z]:\\/iu.test(value),
      ),
    ),
    false,
  );
});

test('detached rollback progress exposes only closed helper phases', () => {
  for (const phase of [
    'inputValidation',
    'launcherExitWait',
    'failedPackageUninstall',
    'rollbackPackageInstall',
    'failedPackageRepair',
  ]) {
    assert.match(rollbackProgress, new RegExp(`'${phase}'`, 'u'));
  }
  for (const event of ['started', 'completed', 'failed']) {
    assert.match(rollbackProgress, new RegExp(`'${event}'`, 'u'));
  }
  assert.match(
    scenarioOperations,
    /Publish-W6b2FaultRollbackProgress -Context \$Context/u,
  );
  assert.match(rollbackProgress, /16 \* 1024/u);
  assert.match(rollbackProgress, /W6B2_FAULT_ROLLBACK_PROGRESS_INVALID/u);
  assert.doesNotMatch(
    rollbackProgress,
    /commandLine|processId|pid|stack|ErrorRecord\.ToString|ScriptStackTrace/iu,
  );
});

test('application phases own and close only their exact process trees', () => {
  assert.match(applicationProcess, /New-W6b2SuccessProcessObservation/u);
  assert.match(applicationProcess, /Stop-W6b2SuccessOwnedProcesses/u);
  assert.match(applicationProcess, /Wait-W6b2SuccessOwnedProcessesAbsent/u);
  assert.match(applicationProcess, /Close-W6b2SuccessProcess/u);
  assert.doesNotMatch(
    `${applicationProcess}\n${scenarioOperations}\n${harness}`,
    /taskkill|Stop-Process\s+-Name|Get-Process[^\n]+\|[^\n]+Stop-Process/iu,
  );
});

test('active rollback uses one state-driven business rollback launch', () => {
  const activeRollback = readFunction(
    scenarioOperations,
    'Invoke-W6b2FaultActiveWorkspaceFirstStartFailure',
    'Invoke-W6b2FaultAcceptanceInterruption',
  );
  assert.equal(
    activeRollback.match(
      /Invoke-W6b2FaultApplicationHandoffPhase[\s\S]{0,400}-Phase businessRollback\b/gu,
    )?.length,
    1,
  );
  assert.doesNotMatch(activeRollback, /businessRollbackPreparation/u);
  assert.match(activeRollback, /Wait-W6b2FaultSourceInstallation/u);

  const binaryRollback = readFunction(
    scenarioOperations,
    'Invoke-W6b2FaultBinaryRollbackFailure',
    'Invoke-W6b2FaultTargetUpdate',
  );
  assert.doesNotMatch(binaryRollback, /-Phase businessRollback\b/u);
  assert.match(binaryRollback, /-Phase binaryRollbackFailure\b/u);
});

test('every successful flow ends in package and profile terminal verification', () => {
  assert.match(
    scenarioOperations,
    /Invoke-W6b2FaultTerminalVerification/u,
  );
  for (const operation of [
    'verifyPreUpdateFailure',
    'verifyActiveRollback',
    'verifyAcceptanceRecovery',
    'verifyPassiveRecovery',
    'verifyBinaryFailedSafe',
  ]) {
    assert.match(scenarioOperations, new RegExp(`-Operation ${operation}`, 'u'));
    assert.match(evidence, new RegExp(`'${operation}'`, 'u'));
  }
  assert.match(
    scenarioOperations,
    /Invoke-W6b2FaultPackageVerification/u,
  );
  assert.match(
    scenarioOperations,
    /Assert-W6b2FaultTerminalPackageState/u,
  );
  assert.match(
    scenarioOperations,
    /function Assert-W6b2FaultProductRegistrationAbsent/u,
  );
  assert.match(
    scenarioOperations,
    /Get-EkyProductRegistrations -ProductCodes @\(\$ProductCode\)/u,
  );
  assert.doesNotMatch(
    scenarioOperations,
    /Assert-EkyInstallerRegistrationAbsent -ProductCodes @\(\$absentCode\)/u,
  );
});

test('cleanup preserves the normal profile and proves all owned state absent', () => {
  assert.match(harness, /\$normalProfileExisted/u);
  assert.match(harness, /Get-W6b2SuccessDirectoryInventory/u);
  assert.match(harness, /Assert-W6b2SuccessInventoryEqual/u);
  assert.match(harness, /Assert-W6b2SuccessNoApplicationOrMsiProcesses/u);
  assert.match(harness, /Assert-EkyInstallerRegistrationAbsent/u);
  assert.match(harness, /Assert-EkyPathEventuallyAbsent/u);
  assert.doesNotMatch(
    harness,
    /(?:New-Item|Remove-Item|Move-Item|Copy-Item)[^\n]+\$normalProfileRoot/iu,
  );
});

function read(relativePath) {
  return readFileSync(join(scriptDirectory, relativePath), 'utf8');
}

function readFunction(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}
