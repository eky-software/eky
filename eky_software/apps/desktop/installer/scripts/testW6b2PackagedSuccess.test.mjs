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
const runFixture = read('w6b2PackagedSuccessRunFixture.mjs');
const mainProof = read(
  join('..', '..', 'src', 'main', 'w6b2PackagedProof.ts'),
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
  assert.match(progress, /\[Console\]::Out\.WriteLine/u);
  assert.doesNotMatch(progress, /Write-Output/u);
  assert.doesNotMatch(progress, /errorMessage|stack|path|commandLine|processId/u);
  assert.doesNotMatch(progress, /Write-Host|Write-Error|Write-Warning/u);
  assert.match(progress, /Resolve-W6b2SuccessSafeErrorCode/u);
  assert.match(progress, /W6B2_SUCCESS_UNCLASSIFIED_FAILURE/u);
  assert.match(progress, /\$line\['errorCode'\] = \$ErrorCode/u);
  assert.doesNotMatch(progress, /ErrorRecord\.ToString|ScriptStackTrace/u);
  assert.match(
    progress,
    /W6B2_SUCCESS_SOURCE_INSTALL_FAILED:\(\?<exitCode>\[0-9\]\+\)/u,
  );
  for (const safeInstallerFailure of [
    'W6B2_SUCCESS_SOURCE_INSTALL_CANCELLED',
    'W6B2_SUCCESS_SOURCE_INSTALL_FAILED',
    'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_BUSY',
    'W6B2_SUCCESS_SOURCE_INSTALL_INSTALLER_SERVICE_UNAVAILABLE',
    'W6B2_SUCCESS_SOURCE_INSTALL_REBOOT_REQUIRED',
    'W6B2_SUCCESS_SOURCE_INSTALL_RELATED_PRODUCT_PRESENT',
  ]) {
    assert.match(progress, new RegExp(`'${safeInstallerFailure}'`, 'u'));
  }
  for (const activationFailure of [
    'W6B2_SUCCESS_MIGRATION_PHASE_FAILED',
    'W6B2_SUCCESS_VALIDATION_PHASE_FAILED',
  ]) {
    assert.match(progress, new RegExp(`'${activationFailure}'`, 'u'));
  }
  assert.doesNotMatch(
    progress,
    /\$line\['errorCode'\]\s*=\s*\$Matches\.exitCode/iu,
  );
  for (const sourceValidationFailure of [
    'W6B2_SUCCESS_SOURCE_PAYLOAD_MISMATCH',
    'W6B2_SUCCESS_SOURCE_REGISTRATION_MISSING',
    'W6B2_SUCCESS_SOURCE_SHORTCUT_MISSING',
  ]) {
    assert.match(progress, new RegExp(`'${sourceValidationFailure}'`, 'u'));
  }
  for (const profileFailure of [
    'W6B2_SUCCESS_PROFILE_BUILD_IDENTITY_INVALID',
    'W6B2_SUCCESS_PROFILE_CONFIGURATION_INVALID',
    'W6B2_SUCCESS_PROFILE_ELECTRON_READY_FAILED',
    'W6B2_SUCCESS_PROFILE_INPUT_INVALID',
    'W6B2_SUCCESS_PROFILE_INSTALLATION_INVALID',
    'W6B2_SUCCESS_PROFILE_RUNTIME_PATHS_INVALID',
    'W6B2_SUCCESS_PROFILE_FIXTURE_A_FAILED',
    'W6B2_SUCCESS_PROFILE_FIXTURE_B_FAILED',
    'W6B2_SUCCESS_PROFILE_FIXTURE_C_FAILED',
    'W6B2_SUCCESS_PROFILE_MIGRATION_HISTORY_FAILED',
    'W6B2_SUCCESS_PROFILE_REGISTRY_WRITE_FAILED',
    'W6B2_SUCCESS_PROFILE_ACCEPTED_BUILD_WRITE_FAILED',
    'W6B2_SUCCESS_PROFILE_EVIDENCE_SNAPSHOT_FAILED',
    'W6B2_SUCCESS_PROFILE_STATE_WRITE_FAILED',
    'W6B2_SUCCESS_PROFILE_OPERATION_FAILED',
  ]) {
    assert.match(progress, new RegExp(`'${profileFailure}'`, 'u'));
  }
  for (const resultCode of [
    'buildRevisionValidated',
    'proofRootResolved',
    'sourcePackageFileResolved',
    'targetPackageFileResolved',
    'payloadRootsResolved',
    'runtimePathsResolved',
    'packageHashesVerified',
    'productCodesValidated',
    'processBoundaryVerified',
    'installationPathsVerified',
    'installerServiceAvailable',
    'productStateVerified',
    'registrationStateVerified',
    'payloadInventoriesVerified',
    'normalProfileInventoried',
    'privateLogsPrepared',
    'sourceMsiCompleted',
    'sourceProductStateValidated',
    'targetProductStateValidated',
    'sourcePayloadValidated',
    'sourceRegistrationValidated',
    'migrationLaunchStarted',
    'migrationProcessStarted',
    'migrationResultObserved',
    'migrationRootExited',
    'migrationOwnedTreeAbsent',
    'migrationOutputDrainStarted',
    'migrationOutputDrainCompleted',
    'validationLaunchStarted',
    'validationProcessStarted',
    'validationResultObserved',
    'validationRootExited',
    'validationOwnedTreeAbsent',
    'validationOutputDrainStarted',
    'validationOutputDrainCompleted',
    'profileVerificationStarted',
    'profileVerificationCompleted',
  ]) {
    assert.match(progress, new RegExp(`'${resultCode}'`, 'u'));
  }
  for (const harnessResultCode of [
    'buildRevisionValidated',
    'proofRootResolved',
    'sourcePackageFileResolved',
    'targetPackageFileResolved',
    'payloadRootsResolved',
    'runtimePathsResolved',
    'packageHashesVerified',
    'productCodesValidated',
    'processBoundaryVerified',
    'installationPathsVerified',
    'installerServiceAvailable',
    'productStateVerified',
    'registrationStateVerified',
    'payloadInventoriesVerified',
    'normalProfileInventoried',
    'privateLogsPrepared',
    'sourceMsiCompleted',
    'sourceProductStateValidated',
    'targetProductStateValidated',
    'sourcePayloadValidated',
    'sourceRegistrationValidated',
    'profileVerificationStarted',
    'profileVerificationCompleted',
  ]) {
    assert.match(
      harness,
      new RegExp(
        `Write-W6b2SuccessObservation -ResultCode ${harnessResultCode}`,
        'u',
      ),
    );
  }
  assert.equal(
    (harness.match(/Fail-W6b2SuccessStage -ErrorRecord \$_/gmu) ?? [])
      .length,
    2,
  );
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
  assert.match(evidence, /W6B2_SUCCESS_PROOF_HANDOFF_FAILED/u);
  assert.match(evidence, /W6B2_PROOF_HANDOFF_FAILED/u);
  assert.match(evidence, /W6B2_SUCCESS_PROOF_SOURCE_STAGE_FAILED/u);
  assert.match(evidence, /W6B2_SUCCESS_PROOF_CANDIDATE_STAGE_FAILED/u);
  assert.match(evidence, /W6B2_SUCCESS_PROOF_PREPARATION_FAILED/u);
  for (const preparationFailure of [
    'W6B2_SUCCESS_PROOF_PREPARATION_CONCURRENCY_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_JOURNAL_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_PACKAGE_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_PROFILE_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_PROTECTION_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_SOURCE_FAILED',
    'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED',
  ]) {
    assert.match(progress, new RegExp(preparationFailure, 'u'));
    assert.match(evidence, new RegExp(preparationFailure, 'u'));
  }
  assert.match(evidence, /W6B2_SUCCESS_PROOF_INSTALLER_HANDOFF_FAILED/u);
  assert.match(evidence, /W6B2_SUCCESS_PROOF_QUIT_REQUEST_MISSING/u);
  assert.match(evidence, /\$failedKeys/u);
  assert.match(evidence, /electronReady/u);
  assert.match(evidence, /installedApplication/u);
  assert.match(evidence, /proofConfiguration/u);
  assert.match(evidence, /buildIdentity/u);
  assert.match(evidence, /profileInput/u);
  assert.match(evidence, /runtimePaths/u);
  assert.match(evidence, /fixtureA/u);
  assert.match(evidence, /fixtureB/u);
  assert.match(evidence, /fixtureC/u);
  assert.match(evidence, /migrationHistory/u);
  assert.match(evidence, /registry/u);
  assert.match(evidence, /acceptedBuild/u);
  assert.match(evidence, /evidence/u);
  assert.match(evidence, /profileState/u);
  assert.match(evidence, /profileOperation/u);
  assert.doesNotMatch(evidence, /Error\.message|stack|commandLine|processId/u);
});

test('source handoff transfers proof before target installation owns process completion', () => {
  assert.match(
    applicationProcess,
    /function Wait-W6b2SuccessHandoffResult/u,
  );
  assert.match(
    applicationProcess,
    /function Invoke-W6b2SuccessApplicationHandoffPhase/u,
  );
  assert.match(
    applicationProcess,
    /function Release-W6b2SuccessInstallerHandoffOwnership/u,
  );
  assert.match(
    applicationProcess,
    /Release-W6b2SuccessInstallerHandoffOwnership[\s\S]*return \[pscustomobject\]/u,
  );
  assert.match(
    harness,
    /Invoke-W6b2SuccessApplicationHandoffPhase[\s\S]*\$sourceProcess = \$sourceRun\.process[\s\S]*Complete-W6b2SuccessStage -ResultCode handoffCompleted[\s\S]*Wait-W6b2SuccessTargetInstallation[\s\S]*Wait-W6b2SuccessOwnedProcessesAbsent[\s\S]*Close-W6b2SuccessProcess -Process \$sourceProcess/u,
  );
  assert.match(applicationProcess, /ReadToEndAsync/u);
  assert.match(applicationProcess, /W6B2_SUCCESS_PROCESS_OUTPUT_TIMEOUT/u);
  assert.match(applicationProcess, /Threading\.Tasks\.Task\]::WaitAll/u);
  assert.doesNotMatch(applicationProcess, /\.WaitForExit\(\)/u);
  assert.doesNotMatch(
    applicationProcess,
    /BeginOutputReadLine|BeginErrorReadLine|CancelOutputRead|CancelErrorRead/u,
  );
  assert.doesNotMatch(
    `${applicationProcess}\n${harness}`,
    /AllowOwnedDescendantsAfterExit/u,
  );
});

test('passive compatible workspace activation proves one migration relaunch before validation', () => {
  assert.match(
    applicationProcess,
    /function Invoke-W6b2SuccessWorkspaceActivationMigrationPhase/u,
  );
  assert.match(
    applicationProcess,
    /-Phase \$Phase -ExpectedStatus relaunching[\s\S]*-Phase \$Phase -ExpectedStatus completed/u,
  );
  assert.match(applicationProcess, /-ObservationMode migration/u);
  assert.match(applicationProcess, /-ObservationMode validation/u);
  assert.match(applicationProcess, /\[void\]\(& \$Observe \$resultCode\)/u);
  assert.match(applicationProcess, /W6B2_SUCCESS_MIGRATION_PHASE_FAILED/u);
  assert.match(applicationProcess, /W6B2_SUCCESS_VALIDATION_PHASE_FAILED/u);
  assert.match(harness, /profileVerificationStarted/u);
  assert.match(harness, /profileVerificationCompleted/u);
  assert.match(
    harness,
    /Invoke-W6b2SuccessWorkspaceActivationMigrationPhase[\s\S]*\$ownedObservations\.Add\(\$verifyB\.migrationObservation\)[\s\S]*\$ownedObservations\.Add\(\$verifyB\.validationObservation\)/u,
  );
  assert.equal(
    (
      applicationProcess.match(
        /function Invoke-W6b2SuccessWorkspaceActivationMigrationPhase/gmu,
      ) ?? []
    ).length,
    1,
  );
});

test('proof root resolution emits exactly one canonical path value', () => {
  assert.match(
    evidence,
    /\[void\]\(Assert-W6b2SuccessCanonicalDirectory -Path \$root\)\s+return \$root/u,
  );
  assert.doesNotMatch(
    evidence,
    /(?<!\[void\]\()Assert-W6b2SuccessCanonicalDirectory -Path \$root/u,
  );
});

test('all packaged proof boundaries use the compact path-budgeted root', () => {
  for (const source of [evidence, runFixture, mainProof]) {
    assert.match(source, /eky-w6b2/u);
    assert.doesNotMatch(source, /eky-w6b2-packaged-proof/u);
  }
  assert.match(evidence, /\$ProofToken\.Substring\(0, 32\)/u);
  assert.match(
    runFixture,
    /token\.slice\(0, w6b2PackagedProofPathTokenLength\)/u,
  );
  assert.match(
    mainProof,
    /tokenValue\.slice\(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH\)/u,
  );
});

test('phase replacement uses a named private backup slot', () => {
  assert.match(evidence, /phase\.previous\.json/u);
  assert.match(
    evidence,
    /\[IO\.File\]::Replace\(\$nextPath, \$phasePath, \$previousPath\)/u,
  );
  assert.doesNotMatch(
    evidence,
    /\[IO\.File\]::Replace\(\$nextPath, \$phasePath, \$null\)/u,
  );
  assert.equal(
    (evidence.match(/Remove-Item -LiteralPath \$nextPath,\$previousPath/gmu) ?? [])
      .length,
    2,
  );
});

test('hardened inventory preserves the shared installer ordering contract', () => {
  assert.match(evidence, /\$files \+= \$item/u);
  assert.match(
    evidence,
    /\$files \|\s+Sort-Object FullName \|\s+ForEach-Object/um,
  );
  assert.doesNotMatch(evidence, /\$inventory \| Sort-Object/u);
});

test('cleanup uses exact owned identities and never broad process termination', () => {
  const cleanupStart = applicationProcess.indexOf(
    'function Stop-W6b2SuccessRecordedOwnedProcesses',
  );
  const cleanupEnd = applicationProcess.indexOf(
    '\nfunction Invoke-W6b2SuccessApplicationPhase',
    cleanupStart,
  );
  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);
  const cleanupFunction = applicationProcess.slice(cleanupStart, cleanupEnd);

  assert.match(
    harness,
    /Stop-W6b2SuccessRecordedOwnedProcesses -Observation \$observation/u,
  );
  assert.match(applicationProcess, /creationToken/u);
  assert.match(
    applicationProcess,
    /\[Diagnostics\.Process\]::GetProcessById/u,
  );
  assert.doesNotMatch(cleanupFunction, /Get-EkyProcessSnapshot/u);
  assert.doesNotMatch(
    `${harness}\n${applicationProcess}\n${installerLifecycle}`,
    /taskkill|Stop-Process\s+-Name|Get-Process[^\n]+\|[^\n]+Stop-Process/iu,
  );
  for (const cleanupResultCode of [
    'cleanupOwnedProcessesStarted',
    'cleanupOwnedProcessesCompleted',
    'cleanupSourceProcessStarted',
    'cleanupSourceProcessCompleted',
    'cleanupTargetPackageStarted',
    'cleanupTargetPackageCompleted',
    'cleanupSourcePackageStarted',
    'cleanupSourcePackageCompleted',
    'cleanupPostconditionsStarted',
    'cleanupPostconditionsCompleted',
  ]) {
    assert.match(progress, new RegExp(`'${cleanupResultCode}'`, 'u'));
    assert.match(harness, new RegExp(cleanupResultCode, 'u'));
  }
  const packageCleanupStart = harness.indexOf(
    "if ($null -ne $installer) {",
  );
  const packageCleanupEnd = harness.indexOf(
    'Write-W6b2SuccessObservation -ResultCode cleanupPostconditionsStarted',
    packageCleanupStart,
  );
  const packageCleanup = harness.slice(packageCleanupStart, packageCleanupEnd);
  assert.doesNotMatch(packageCleanup, /Get-EkyProductState/u);
  assert.match(installerLifecycle, /Invoke-EkyMsiExec/u);
  assert.match(installerLifecycle, /-EmitSafeProgress \$true/u);
  assert.match(installerLifecycle, /-AllowedExitCodes @\(0, 1605\)/u);
  assert.doesNotMatch(installerLifecycle, /Start-EkyOwnedMsiExecHost/u);
});

test('Windows Installer service processes do not block the current test session', () => {
  assert.match(
    installerLifecycle,
    /function Get-W6b2SuccessCurrentSessionMsiProcesses/u,
  );
  assert.match(
    installerLifecycle,
    /Get-Process -Id \$PID -ErrorAction Stop\)\.SessionId/u,
  );
  assert.match(
    installerLifecycle,
    /Where-Object \{ \$_\.SessionId -eq \$currentSessionId \}/u,
  );
  assert.equal(
    (
      installerLifecycle.match(
        /Get-W6b2SuccessCurrentSessionMsiProcesses/gmu,
      ) ?? []
    ).length,
    3,
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
