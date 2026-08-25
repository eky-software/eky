Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')

function Write-W6b2SuccessHeartbeat {}

. (Join-Path $PSScriptRoot 'w6b2Success\applicationProcess.ps1')

function Assert-W6b2ProcessEqual {
  param($Actual, $Expected, [string]$Code)
  if ($Actual -ne $Expected) {
    throw $Code
  }
}

function Assert-W6b2ProcessThrows {
  param([scriptblock]$Action, [string]$ExpectedCode)
  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -ne $ExpectedCode) {
      throw 'W6B2_PROCESS_TEST_UNEXPECTED_ERROR'
    }
    return
  }
  throw 'W6B2_PROCESS_TEST_EXPECTED_ERROR_MISSING'
}

function ConvertTo-W6b2EncodedCommand {
  param([Parameter(Mandatory = $true)][string]$Command)
  return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

function Start-W6b2ProcessFixture {
  param([Parameter(Mandatory = $true)][string]$Command)
  return Start-W6b2SuccessProcess -ExecutablePath 'powershell.exe' `
    -Arguments @(
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      (ConvertTo-W6b2EncodedCommand -Command $Command)
    ) -EnvironmentOverrides @{}
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) `
  ('eky-w6b2-process-' + [Guid]::NewGuid().ToString('N'))
$handoffProcess = $null
$strictProcess = $null
$earlyExitProcess = $null
$observations = [Collections.Generic.List[object]]::new()
$activationPhaseCalls = [Collections.Generic.List[object]]::new()
$failureCode = $null
$successResult = $null
try {
  [void](New-Item -ItemType Directory -Path $testRoot)
  $handoffMarker = Join-Path $testRoot 'handoff.ready'
  $handoffCommand = @"
[IO.File]::WriteAllText('$($handoffMarker.Replace("'", "''"))', 'ready')
Start-Sleep -Seconds 5
exit 7
"@
  $handoffProcess = Start-W6b2ProcessFixture -Command $handoffCommand
  $handoffObservation = New-W6b2SuccessProcessObservation `
    -Process $handoffProcess
  $observations.Add($handoffObservation)
  $handoffResult = Wait-W6b2SuccessHandoffResult -Process $handoffProcess `
    -Observation $handoffObservation -TimeoutMilliseconds 5000 -ReadResult {
      if (!(Test-Path -LiteralPath $handoffMarker -PathType Leaf)) {
        throw 'W6B2_SUCCESS_RESULT_PENDING'
      }
      return 'handoffReady'
    }
  $handoffProcess.Refresh()
  Assert-W6b2ProcessEqual $handoffResult 'handoffReady' `
    'W6B2_PROCESS_TEST_HANDOFF_RESULT_INVALID'
  Assert-W6b2ProcessEqual $handoffProcess.HasExited $false `
    'W6B2_PROCESS_TEST_HANDOFF_WAITED_FOR_EXIT'
  Stop-W6b2SuccessOwnedProcesses -Observation $handoffObservation
  Wait-W6b2SuccessOwnedProcessesAbsent -Observation $handoffObservation `
    -TimeoutMilliseconds 5000
  Close-W6b2SuccessProcess -Process $handoffProcess
  $handoffProcess = $null

  $strictMarker = Join-Path $testRoot 'strict.ready'
  $strictCommand = @"
[IO.File]::WriteAllText('$($strictMarker.Replace("'", "''"))', 'ready')
exit 7
"@
  $strictProcess = Start-W6b2ProcessFixture -Command $strictCommand
  $strictObservation = New-W6b2SuccessProcessObservation -Process $strictProcess
  $observations.Add($strictObservation)
  Assert-W6b2ProcessThrows {
    Wait-W6b2SuccessResultProcess -Process $strictProcess `
      -Observation $strictObservation -TimeoutMilliseconds 5000 -ReadResult {
        if (!(Test-Path -LiteralPath $strictMarker -PathType Leaf)) {
          throw 'W6B2_SUCCESS_RESULT_PENDING'
        }
        return 'strictReady'
      }
  } 'W6B2_SUCCESS_PROCESS_EXIT_FAILED'

  $earlyExitProcess = Start-W6b2ProcessFixture -Command 'exit 0'
  $earlyExitObservation = New-W6b2SuccessProcessObservation `
    -Process $earlyExitProcess
  $observations.Add($earlyExitObservation)
  Assert-W6b2ProcessThrows {
    Wait-W6b2SuccessHandoffResult -Process $earlyExitProcess `
      -Observation $earlyExitObservation -TimeoutMilliseconds 5000 `
      -ReadResult { throw 'W6B2_SUCCESS_RESULT_PENDING' }
  } 'W6B2_SUCCESS_PROCESS_EXITED_BEFORE_RESULT'

  function Invoke-W6b2SuccessApplicationPhase {
    param(
      [string]$ExecutablePath,
      [string]$ProofToken,
      [string]$ProofRoot,
      [string]$Phase,
      [string]$ExpectedStatus
    )
    $call = [pscustomobject]@{
      executablePath = $ExecutablePath
      proofToken = $ProofToken
      proofRoot = $ProofRoot
      phase = $Phase
      expectedStatus = $ExpectedStatus
    }
    $script:activationPhaseCalls.Add($call)
    return [pscustomobject]@{ observation = $call }
  }

  $activation = Invoke-W6b2SuccessWorkspaceActivationMigrationPhase `
    -ExecutablePath 'fixture.exe' -ProofToken 'a' -ProofRoot 'fixture-root' `
    -Phase verifyBRestart
  Assert-W6b2ProcessEqual $activationPhaseCalls.Count 2 `
    'W6B2_PROCESS_TEST_ACTIVATION_CALL_COUNT_INVALID'
  Assert-W6b2ProcessEqual $activationPhaseCalls[0].expectedStatus `
    'relaunching' 'W6B2_PROCESS_TEST_ACTIVATION_MIGRATION_INVALID'
  Assert-W6b2ProcessEqual $activationPhaseCalls[1].expectedStatus `
    'completed' 'W6B2_PROCESS_TEST_ACTIVATION_VALIDATION_INVALID'
  Assert-W6b2ProcessEqual $activation.migrationObservation `
    $activationPhaseCalls[0] 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_INVALID'
  Assert-W6b2ProcessEqual $activation.validationObservation `
    $activationPhaseCalls[1] 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_INVALID'

  $successResult = [ordered]@{
    status = 'succeeded'
    handoffReturnsOnProof = $true
    strictPhaseRequiresZeroExit = $true
    earlyExitRejected = $true
    activationMigrationUsesExactRelaunch = $true
    exactOwnedCleanup = $true
    orphanProcessCount = 0
  }
}
catch {
  $candidate = [string]$_.Exception.Message
  $failureCode = if ($candidate -cmatch '^W6B2_[A-Z0-9_]+$') {
    $candidate
  }
  else {
    'W6B2_PROCESS_TEST_UNEXPECTED_ERROR'
  }
}
finally {
  foreach ($observation in $observations) {
    try {
      Stop-W6b2SuccessOwnedProcesses -Observation $observation
    }
    catch {
      $failureCode = 'W6B2_PROCESS_TEST_CLEANUP_FAILED'
    }
  }
  foreach ($process in @($handoffProcess, $strictProcess, $earlyExitProcess)) {
    if ($null -ne $process) {
      try {
        Close-W6b2SuccessProcess -Process $process
      }
      catch {
        $failureCode = 'W6B2_PROCESS_TEST_CLEANUP_FAILED'
      }
    }
  }
  Remove-Item -LiteralPath $testRoot -Force -Recurse -ErrorAction SilentlyContinue
}

if ($null -ne $failureCode) {
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([ordered]@{
    status = 'failed'
    errorCode = $failureCode
  }) -Compress))
  exit 1
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $successResult -Compress))
exit 0
