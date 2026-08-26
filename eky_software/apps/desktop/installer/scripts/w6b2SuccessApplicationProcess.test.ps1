Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot 'w6b2Success\evidence.ps1')

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
$reusedIdentityProcess = $null
$observations = [Collections.Generic.List[object]]::new()
$activationPhaseCalls = [Collections.Generic.List[object]]::new()
$milestones = [Collections.Generic.List[string]]::new()
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

  $reusedIdentityProcess = Start-W6b2ProcessFixture `
    -Command 'Start-Sleep -Seconds 30'
  $reusedIdentityOwnedObservation = New-W6b2SuccessProcessObservation `
    -Process $reusedIdentityProcess
  $observations.Add($reusedIdentityOwnedObservation)
  $reusedIdentity = New-EkyProcessIdentity `
    -ProcessId ([int]$reusedIdentityOwnedObservation.root.processId) `
    -CreationToken ((
      [long]$reusedIdentityOwnedObservation.root.creationToken + 1
    ).ToString([Globalization.CultureInfo]::InvariantCulture))
  $reusedIdentityObservation = [pscustomobject]@{
    root = $reusedIdentity
    owned = @{
      "$($reusedIdentity.processId):$($reusedIdentity.creationToken)" = `
        $reusedIdentity
    }
  }
  Stop-W6b2SuccessRecordedOwnedProcesses `
    -Observation $reusedIdentityObservation
  $reusedIdentityProcess.Refresh()
  Assert-W6b2ProcessEqual $reusedIdentityProcess.HasExited $false `
    'W6B2_PROCESS_TEST_REUSED_IDENTITY_TERMINATED'

  $missingIdentity = New-EkyProcessIdentity -ProcessId ([int]::MaxValue) `
    -CreationToken '1'
  Stop-W6b2SuccessRecordedOwnedProcesses -Observation ([pscustomobject]@{
    root = $missingIdentity
    owned = @{
      "$($missingIdentity.processId):$($missingIdentity.creationToken)" = `
        $missingIdentity
    }
  })

  function Invoke-W6b2SuccessApplicationPhase {
    param(
      [string]$ExecutablePath,
      [string]$ProofToken,
      [string]$ProofRoot,
      [string]$Phase,
      [string]$ExpectedStatus,
      [string]$ObservationMode,
      [scriptblock]$Observe
    )
    $call = [pscustomobject]@{
      executablePath = $ExecutablePath
      proofToken = $ProofToken
      proofRoot = $ProofRoot
      phase = $Phase
      expectedStatus = $ExpectedStatus
      observationMode = $ObservationMode
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
  Assert-W6b2ProcessEqual $activationPhaseCalls[0].observationMode `
    'migration' 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_MODE_INVALID'
  Assert-W6b2ProcessEqual $activationPhaseCalls[1].observationMode `
    'validation' 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_MODE_INVALID'
  Assert-W6b2ProcessEqual $activation.migrationObservation `
    $activationPhaseCalls[0] 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_INVALID'
  Assert-W6b2ProcessEqual $activation.validationObservation `
    $activationPhaseCalls[1] 'W6B2_PROCESS_TEST_ACTIVATION_OBSERVATION_INVALID'

  Invoke-W6b2SuccessProcessMilestone -ObservationMode migration `
    -Milestone launchStarted -Observe {
      param([string]$ResultCode)
      $script:milestones.Add($ResultCode)
    }
  Invoke-W6b2SuccessProcessMilestone -ObservationMode validation `
    -Milestone outputDrainCompleted -Observe {
      param([string]$ResultCode)
      $script:milestones.Add($ResultCode)
    }
  Invoke-W6b2SuccessProcessMilestone -ObservationMode migration `
    -Milestone rootExited -Observe { throw 'raw logger failure' }
  Assert-W6b2ProcessEqual ($milestones -join ',') `
    'migrationLaunchStarted,validationOutputDrainCompleted' `
    'W6B2_PROCESS_TEST_MILESTONE_INVALID'

  $pendingOutput = [Threading.Tasks.TaskCompletionSource[bool]]::new()
  $fakeProcess = [pscustomobject]@{
    HasExited = $true
    W6b2StandardOutputTask = $pendingOutput.Task
    W6b2StandardErrorTask = [Threading.Tasks.Task]::CompletedTask
  }
  $fakeProcess | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  $fakeProcess | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
  Assert-W6b2ProcessThrows {
    Close-W6b2SuccessProcess -Process $fakeProcess -TimeoutMilliseconds 10
  } 'W6B2_SUCCESS_PROCESS_OUTPUT_TIMEOUT'

  $roleFixtures = @(
    @('--type=crashpad-handler', 'crashpad'),
    @('--type=gpu-process', 'gpu'),
    @('--type=renderer', 'renderer'),
    @('--type=utility --utility-sub-type=node.mojom.NodeService', `
      'backendUtility'),
    @('--type=utility --utility-sub-type=audio.mojom.AudioService', 'utility'),
    @('--fixture-argument', 'unclassified')
  )
  foreach ($roleFixture in $roleFixtures) {
    Assert-W6b2ProcessEqual `
      (Get-W6b2SuccessOwnedProcessRole -Process ([pscustomobject]@{
        CommandLine = [string]$roleFixture[0]
      })) ([string]$roleFixture[1]) 'W6B2_PROCESS_TEST_ROLE_INVALID'
  }

  $roleObservation = [pscustomobject]@{
    root = New-EkyProcessIdentity -ProcessId 100 -CreationToken '1000'
  }
  $roleRemaining = @(
    New-EkyProcessIdentity -ProcessId 101 -CreationToken '1001'
  )
  Assert-W6b2ProcessEqual `
    (Get-W6b2SuccessOwnedProcessFailureCode `
      -Observation $roleObservation -Remaining $roleRemaining -ReadProcess {
        return [pscustomobject]@{
          CommandLine = '--type=utility --utility-sub-type=node.mojom.NodeService'
        }
      }) 'W6B2_SUCCESS_OWNED_BACKEND_UTILITY_REMAINS' `
    'W6B2_PROCESS_TEST_FAILURE_ROLE_INVALID'

  $proofResultRoot = Join-Path $testRoot 'proof-result'
  [void](New-Item -ItemType Directory `
    -Path (Join-Path $proofResultRoot 'result'))
  $proofResultPath = Join-Path $proofResultRoot `
    'result\w6b2-proof-result.json'
  [IO.File]::WriteAllText(
    $proofResultPath,
    '{"formatVersion":1,"phase":"sourceHandoff","status":"completed"}',
    [Text.UTF8Encoding]::new($false)
  )
  $proofResult = Read-W6b2SuccessProofResult -ProofRoot $proofResultRoot `
    -ExpectedPhase sourceHandoff -ExpectedStatus completed
  Assert-W6b2ProcessEqual $proofResult.status 'completed' `
    'W6B2_PROCESS_TEST_PROOF_SUCCESS_INVALID'
  $proofFailures = [ordered]@{
    W6B2_PROOF_SOURCE_STAGE_FAILED = `
      'W6B2_SUCCESS_PROOF_SOURCE_STAGE_FAILED'
    W6B2_PROOF_CANDIDATE_STAGE_FAILED = `
      'W6B2_SUCCESS_PROOF_CANDIDATE_STAGE_FAILED'
    W6B2_PROOF_PREPARATION_FAILED = `
      'W6B2_SUCCESS_PROOF_PREPARATION_FAILED'
    W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED = `
      'W6B2_SUCCESS_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED'
    W6B2_PROOF_INSTALLER_HANDOFF_FAILED = `
      'W6B2_SUCCESS_PROOF_INSTALLER_HANDOFF_FAILED'
    W6B2_PROOF_QUIT_REQUEST_MISSING = `
      'W6B2_SUCCESS_PROOF_QUIT_REQUEST_MISSING'
    W6B2_PROOF_HANDOFF_FAILED = 'W6B2_SUCCESS_PROOF_HANDOFF_FAILED'
  }
  foreach ($proofFailure in $proofFailures.GetEnumerator()) {
    $proofFailurePayload = [ordered]@{
      errorCode = $proofFailure.Key
      formatVersion = 1
      phase = 'sourceHandoff'
      status = 'failed'
    } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText(
      $proofResultPath,
      $proofFailurePayload,
      [Text.UTF8Encoding]::new($false)
    )
    Assert-W6b2ProcessThrows {
      Read-W6b2SuccessProofResult -ProofRoot $proofResultRoot `
        -ExpectedPhase sourceHandoff -ExpectedStatus completed
    } $proofFailure.Value
  }
  [IO.File]::WriteAllText(
    $proofResultPath,
    '{"errorCode":"RAW_ERROR","formatVersion":1,"phase":"sourceHandoff","status":"failed"}',
    [Text.UTF8Encoding]::new($false)
  )
  Assert-W6b2ProcessThrows {
    Read-W6b2SuccessProofResult -ProofRoot $proofResultRoot `
      -ExpectedPhase sourceHandoff -ExpectedStatus completed
  } 'W6B2_SUCCESS_PROOF_RESULT_INVALID'

  $successResult = [ordered]@{
    status = 'succeeded'
    handoffReturnsOnProof = $true
    strictPhaseRequiresZeroExit = $true
    earlyExitRejected = $true
    activationMigrationUsesExactRelaunch = $true
    boundedOutputDrain = $true
    safeMilestones = $true
    proofFailureIsSafelyClassified = $true
    exactOwnedCleanup = $true
    reusedProcessIdentityPreserved = $true
    missingProcessIdentityIgnored = $true
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
  foreach ($process in @(
    $handoffProcess,
    $strictProcess,
    $earlyExitProcess,
    $reusedIdentityProcess
  )) {
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
