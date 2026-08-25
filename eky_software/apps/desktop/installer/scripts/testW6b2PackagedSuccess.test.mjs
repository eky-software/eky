import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const harness = read('testW6b2PackagedSuccess.ps1');
const progress = read(join('w6b2Success', 'progress.ps1'));
const evidence = read(join('w6b2Success', 'evidence.ps1'));
const applicationProcess = read(
  join('w6b2Success', 'applicationProcess.ps1'),
);
const installerLifecycle = read(
  join('w6b2Success', 'installerLifecycle.ps1'),
);

test('packaged success harness keeps orchestration in named responsibilities', () => {
  for (const responsibility of [
    'progress.ps1',
    'evidence.ps1',
    'applicationProcess.ps1',
    'installerLifecycle.ps1',
  ]) {
    assert.match(harness, new RegExp(`w6b2Success\\\\${responsibility}`));
  }
  assert.match(harness, /Start-W6b2SuccessScenario/u);
  assert.match(harness, /Complete-W6b2SuccessScenario/u);
  assert.match(harness, /Fail-W6b2SuccessScenario/u);
});

test('only source MSI has a direct install path', () => {
  assert.match(installerLifecycle, /Install-W6b2SuccessSourcePackage/u);
  assert.match(installerLifecycle, /'\/i'[\s\S]*\$MsiPath/u);
  assert.doesNotMatch(
    installerLifecycle,
    /Install-W6b2SuccessTargetPackage/u,
  );
  assert.doesNotMatch(harness, /'\/i'[\s\S]*\$targetMsi/u);
  assert.match(harness, /Wait-W6b2SuccessTargetInstallation/u);
});

test('progress output is closed JSONL without raw diagnostic fields', () => {
  for (const stage of [
    'sourceHandoff',
    'targetInstall',
    'targetFirstStart',
    'switchToB',
    'verifyBRestart',
    'switchToA',
    'rejectC',
    'cleanup',
  ]) {
    assert.match(progress, new RegExp(`'${stage}'`, 'u'));
  }
  assert.match(progress, /ConvertTo-Json -InputObject \$line -Compress/u);
  assert.doesNotMatch(progress, /errorMessage|stack|path|commandLine|processId/u);
  assert.doesNotMatch(progress, /Write-Host|Write-Error|Write-Warning/u);
});

test('invalid evidence fails immediately instead of becoming a timeout', () => {
  assert.match(applicationProcess, /W6B2_SUCCESS_RESULT_PENDING/u);
  assert.doesNotMatch(
    applicationProcess,
    /'W6B2_SUCCESS_RESULT_PENDING',\s*'W6B2_SUCCESS_RESULT_INVALID'/u,
  );
  assert.match(
    applicationProcess,
    /W6B2_SUCCESS_PROCESS_EXITED_BEFORE_RESULT/u,
  );
  assert.match(evidence, /W6B2_SUCCESS_RESULT_INVALID/u);
});

test('cleanup uses exact owned identities and never broad process termination', () => {
  assert.match(applicationProcess, /creationToken/u);
  assert.match(applicationProcess, /Get-Process -Id/u);
  assert.doesNotMatch(
    `${harness}\n${applicationProcess}\n${installerLifecycle}`,
    /taskkill|Stop-Process\s+-Name|Get-Process[^\n]+\|[^\n]+Stop-Process/iu,
  );
});

test('child processes inherit no ambient Eky or Node execution controls', () => {
  assert.match(applicationProcess, /\^EKY_/u);
  for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH']) {
    assert.match(applicationProcess, new RegExp(`'${name}'`, 'u'));
  }
  assert.match(applicationProcess, /EnvironmentVariables\.Remove/u);
});

test('normal profile is read-only evidence including root existence', () => {
  assert.match(harness, /\$normalProfileExisted/u);
  assert.match(harness, /Get-W6b2SuccessDirectoryInventory/u);
  assert.match(harness, /W6B2_SUCCESS_INVENTORY_CHANGED/u);
  assert.doesNotMatch(
    harness,
    /(?:New-Item|Remove-Item|Move-Item|Copy-Item)[^\n]+\$normalProfileRoot/iu,
  );
});

function read(relativePath) {
  return readFileSync(join(scriptDirectory, relativePath), 'utf8');
}
