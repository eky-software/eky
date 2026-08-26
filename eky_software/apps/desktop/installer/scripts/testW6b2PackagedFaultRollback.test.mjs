import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harness = read('testW6b2PackagedFaultRollback.ps1');
const evidence = read(join('w6b2Fault', 'evidence.ps1'));
const progress = read(join('w6b2Fault', 'progress.ps1'));
const applicationProcess = read(
  join('w6b2Fault', 'applicationProcess.ps1'),
);
const scenarioOperations = read(
  join('w6b2Fault', 'scenarioOperations.ps1'),
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
  ]) {
    assert.match(progress, new RegExp(`'${resultCode}'`, 'u'));
  }
  assert.match(progress, /ConvertTo-Json -InputObject \$line -Compress/u);
  assert.match(progress, /\[Console\]::Out\.WriteLine/u);
  assert.match(progress, /Resolve-W6b2FaultSafeErrorCode/u);
  assert.doesNotMatch(progress, /Write-Host|Write-Error|Write-Warning/u);
  assert.doesNotMatch(
    progress,
    /rawPath|commandLine|processId|pid|stack|ErrorRecord\.ToString|ScriptStackTrace/iu,
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
    /Assert-W6b2FaultTerminalPackageState/u,
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
